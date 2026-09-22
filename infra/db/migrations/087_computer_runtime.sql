-- Provider-neutral Computer Runtime state. Browser processes and plaintext profile material never
-- live in Postgres; profile `record` values contain only AES-256-GCM encrypted storage state.
create table if not exists cp2_computer_sessions (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  computer_session_id text generated always as (record #>> '{session,id}') stored not null,
  constraint cp2_computer_sessions_identity check (computer_session_id = entity_id)
);

create index if not exists cp2_computer_sessions_scope_idx
  on cp2_computer_sessions ((record #>> '{session,accountId}'), business_id);

create table if not exists cp2_computer_profiles (
  entity_id text primary key,
  business_id text,
  account_id text not null,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_computer_profiles_scope check (record ->> 'accountId' = account_id),
  constraint cp2_computer_profiles_status check (
    record ->> 'status' in ('connected', 'reauthorization_required', 'disconnected', 'error')
  )
);

create index if not exists cp2_computer_profiles_account_idx
  on cp2_computer_profiles (account_id, business_id);

create table if not exists cp2_computer_approvals (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  action_hash text generated always as (record ->> 'actionHash') stored not null,
  status text generated always as (record ->> 'status') stored not null,
  constraint cp2_computer_approvals_status check (
    status in ('pending', 'approved', 'rejected', 'used', 'expired')
  )
);

create index if not exists cp2_computer_approvals_action_idx
  on cp2_computer_approvals (action_hash, status);

create table if not exists cp2_computer_audits (
  entity_id text primary key,
  business_id text,
  account_id text not null,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  computer_session_id text generated always as (record ->> 'computerSessionId') stored not null
);

create index if not exists cp2_computer_audits_session_idx
  on cp2_computer_audits (computer_session_id, updated_at);
