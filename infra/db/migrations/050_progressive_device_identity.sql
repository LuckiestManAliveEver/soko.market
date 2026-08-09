alter table accounts
  add column if not exists identity_level text not null default 'strong';

alter table accounts
  drop constraint if exists accounts_identity_level_check,
  add constraint accounts_identity_level_check
    check (identity_level in ('device', 'verified_contact', 'strong'));

comment on column accounts.identity_level is
  'Authentication strength: device-only, verified contact, or strong credential.';

create table if not exists cp2_device_account_bootstraps (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists cp2_device_account_bootstraps_account_idx
  on cp2_device_account_bootstraps (account_id);

comment on table cp2_device_account_bootstraps is
  'Short-lived hashes used to make first-device account creation retry-safe; no raw credential is stored.';

create table if not exists cp2_device_recovery_credentials (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists cp2_device_recovery_credentials_account_idx
  on cp2_device_recovery_credentials (account_id);

comment on table cp2_device_recovery_credentials is
  'Device-bound public keys for restoring an account after session-cookie loss; private keys never leave the client.';
