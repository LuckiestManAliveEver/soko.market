-- ComputerRuntime: an isolated-browser computer-use execution capability
-- (docs/architecture/computer-runtime.md, docs/architecture/computer-runtime-audit.md).
--
-- Three tables:
--   cp2_computer_sessions   - one row per live/suspended computer session; generic CP2
--                             entity_id/record envelope (011_cp2_normalized_store.sql), same shape
--                             as cp2_runtime_transfers (085_runtime_transfers.sql), because session
--                             state (status, controlMode, currentUrl, lastCheckpointId) evolves the
--                             same way transfer progress does.
--   cp2_computer_profiles   - persistent, per-account, per-site authenticated browser profiles.
--                             Modeled on cp2_external_registry_connections
--                             (073_external_registry_connections.sql): a real encrypted-secret
--                             column, not a JSONB blob, because it holds actual secret material
--                             (encrypted provider storage-state) rather than evolving business
--                             state. account-scoped, not business-scoped - a profile is the user's
--                             own authenticated identity on a site, reusable across that account's
--                             businesses, exactly like an external registry connection.
--   cp2_computer_approvals  - one row per consequential-action approval, generic CP2 envelope like
--                             cp2_runtime_transfers. Deliberately separate from the audit-event log
--                             (services/api/src/cp2/store.ts's in-process BusinessEvent[] array,
--                             computer-runtime-audit.md §8) because an approval needs independent,
--                             queryable, replay-protected persistence (status transitions,
--                             expiry), the same reason cp2_runtime_transfers is not folded into the
--                             audit log either.

create table if not exists cp2_computer_sessions (
  entity_id text primary key,
  business_id text not null references cp2_businesses (entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  profile_id text generated always as (record ->> 'profileId') stored,
  status text generated always as (record ->> 'status') stored not null,
  control_mode text generated always as (record ->> 'controlMode') stored not null,
  last_checkpoint_id text generated always as (record ->> 'lastCheckpointId') stored,
  constraint cp2_computer_sessions_status_check check (status in (
    'CREATING', 'READY', 'NAVIGATING', 'AWAITING_APPROVAL', 'HUMAN_CONTROLLED', 'SUSPENDED',
    'RESUMING', 'CLOSED', 'FAILED')),
  constraint cp2_computer_sessions_control_mode_check check (control_mode in (
    'AGENT', 'HUMAN', 'SUSPENDED')),
  constraint cp2_computer_sessions_record_check check (
    char_length(record ->> 'accountId') between 1 and 200
  )
);

create index if not exists cp2_computer_sessions_business_idx
  on cp2_computer_sessions (business_id);

create table if not exists cp2_computer_profiles (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  label text not null,
  site text not null,
  status text not null check (status in ('connected', 'disconnected', 'needs_reauth')),
  -- AES-256-GCM ciphertext of the provider's opaque resumable state (e.g. a Playwright
  -- storageState JSON blob: cookies + localStorage), encrypted with the same
  -- encryptOAuthToken/decryptOAuthToken helpers services/api/src/cp2/oauth.ts already provides
  -- (docs/architecture/computer-runtime-audit.md §"Corrections" - no second crypto primitive).
  -- Never decrypted in services/api beyond the one call that hands it to the isolated computer
  -- worker over the private network; never logged; never returned to the model.
  encrypted_state text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create unique index if not exists cp2_computer_profiles_account_site_idx
  on cp2_computer_profiles (account_id, site);

create table if not exists cp2_computer_approvals (
  entity_id text primary key,
  business_id text not null references cp2_businesses (entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  session_id text generated always as (record ->> 'sessionId') stored not null,
  status text generated always as (record ->> 'status') stored not null,
  action_hash text generated always as (record ->> 'actionHash') stored not null,
  -- Kept as text (not cast to timestamptz): casting text to timestamptz is not an immutable
  -- expression in Postgres (it depends on the session TimeZone setting), so it cannot appear in a
  -- generated column. Expiry comparisons cast at query time instead (`expires_at::timestamptz`),
  -- which is fine - only the generated-column expression itself must be immutable. Application
  -- code always writes ISO 8601 with an explicit offset (Date#toISOString()).
  expires_at text generated always as (record ->> 'expiresAt') stored not null,
  constraint cp2_computer_approvals_status_check check (status in (
    'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED')),
  constraint cp2_computer_approvals_session_fk
    foreign key (session_id) references cp2_computer_sessions (entity_id) on delete cascade
);

-- At most one PENDING approval per session at a time - the agent must wait for a decision before
-- proposing another consequential action, mirroring cp2_runtime_transfers'
-- "one nonterminal transfer per task" invariant (085_runtime_transfers.sql).
create unique index if not exists cp2_computer_approvals_session_pending_idx
  on cp2_computer_approvals (session_id)
  where status = 'PENDING';

create index if not exists cp2_computer_approvals_business_idx
  on cp2_computer_approvals (business_id);
