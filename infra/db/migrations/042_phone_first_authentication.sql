-- Phone-first authentication rollout. Existing account/PIN and OAuth records remain readable
-- during the compatibility window; new credentials resolve through a canonical account UUID.

alter table accounts add column if not exists status text not null default 'active';
alter table accounts add column if not exists deleted_at timestamp with time zone;
alter table accounts drop constraint if exists accounts_status_check;
alter table accounts add constraint accounts_status_check
  check (status in ('active', 'locked', 'suspended', 'pending_deletion', 'deleted'));

alter table users drop constraint if exists users_phone_verification_status_check;
alter table users add constraint users_phone_verification_status_check
  check (phone_verification_status is null or phone_verification_status in ('unverified', 'verified'));

create table if not exists account_identities (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('phone', 'email')),
  normalized_value text not null,
  display_value text not null,
  is_primary boolean not null default false,
  verified_at timestamp with time zone,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  constraint account_identities_normalized_unique unique (type, normalized_value)
);
create unique index if not exists account_identities_primary_type_idx
  on account_identities(account_id, type) where is_primary;
create index if not exists account_identities_account_idx on account_identities(account_id, updated_at desc);

create table if not exists password_credentials (
  account_id uuid primary key references accounts(id) on delete cascade,
  password_hash text not null check (btrim(password_hash) <> ''),
  password_changed_at timestamp with time zone not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create table if not exists auth_transactions (
  id uuid primary key,
  purpose text not null check (purpose in ('signup', 'login_mfa', 'recovery', 'totp_setup')),
  account_id uuid references accounts(id) on delete cascade,
  identifier_type text check (identifier_type is null or identifier_type in ('phone', 'email')),
  identifier_hash text,
  provider_challenge_id text,
  verified_at timestamp with time zone,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null
);
create index if not exists auth_transactions_expiry_idx on auth_transactions(expires_at, consumed_at);
create index if not exists auth_transactions_account_idx on auth_transactions(account_id, created_at desc) where account_id is not null;

create table if not exists mfa_factors (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  factor_type text not null check (factor_type in ('totp')),
  secret_encrypted text not null,
  verified_at timestamp with time zone,
  last_used_step bigint,
  created_at timestamp with time zone not null,
  disabled_at timestamp with time zone
);
create index if not exists mfa_factors_account_active_idx on mfa_factors(account_id, created_at desc) where disabled_at is null;

create table if not exists recovery_codes (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  code_hash text not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone not null
);
create index if not exists recovery_codes_account_unused_idx on recovery_codes(account_id) where used_at is null;

-- Compatibility snapshot tables used by the current staged Postgres adapter.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cp2_account_identities', 'cp2_password_credentials', 'cp2_auth_transactions',
    'cp2_mfa_factors', 'cp2_recovery_codes'
  ] loop
    execute format('create table if not exists %I (
      entity_id text primary key, business_id text, account_id text, user_id text,
      parent_id text, record jsonb not null,
      updated_at timestamp with time zone not null default now()
    )', table_name);
    execute format('create index if not exists %I on %I (account_id) where account_id is not null', table_name || '_account_idx', table_name);
  end loop;
end $$;
