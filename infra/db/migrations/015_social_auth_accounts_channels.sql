create table if not exists auth_accounts (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  provider_id text not null references identity_providers(id),
  provider_subject text not null,
  email text,
  display_name text,
  linked_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  constraint auth_accounts_provider_subject_unique unique (provider_id, provider_subject),
  constraint auth_accounts_account_provider_unique unique (account_id, provider_id, provider_subject),
  constraint auth_accounts_provider_subject_nonempty_check check (btrim(provider_subject) <> '')
);

create index if not exists auth_accounts_account_idx
  on auth_accounts (account_id, linked_at desc);

create index if not exists auth_accounts_user_idx
  on auth_accounts (user_id, linked_at desc);

create table if not exists verification_challenges (
  id uuid primary key,
  account_id uuid references accounts(id) on delete set null,
  channel text not null,
  destination text not null,
  purpose text not null default 'login',
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  status text not null default 'pending',
  expires_at timestamp with time zone not null,
  verified_at timestamp with time zone,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  constraint verification_challenges_channel_check check (channel in ('phone', 'email')),
  constraint verification_challenges_status_check check (status in ('pending', 'verified', 'expired', 'locked')),
  constraint verification_challenges_destination_nonempty_check check (btrim(destination) <> ''),
  constraint verification_challenges_code_hash_nonempty_check check (btrim(code_hash) <> '')
);

create index if not exists verification_challenges_destination_idx
  on verification_challenges (channel, destination, status, expires_at desc);

create index if not exists verification_challenges_account_idx
  on verification_challenges (account_id, created_at desc)
  where account_id is not null;

create table if not exists connected_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  provider_id text not null references identity_providers(id),
  channel_type text not null,
  provider_subject text,
  display_name text,
  status text not null default 'connected',
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint connected_channels_scope_check check (business_id is not null or account_id is not null),
  constraint connected_channels_type_check check (channel_type in ('login', 'business_channel')),
  constraint connected_channels_status_check check (status in ('connected', 'disconnected', 'expired', 'revoked'))
);

create unique index if not exists connected_channels_business_provider_unique
  on connected_channels (business_id, provider_id, coalesce(provider_subject, ''))
  where business_id is not null;

create unique index if not exists connected_channels_account_provider_unique
  on connected_channels (account_id, provider_id, coalesce(provider_subject, ''))
  where account_id is not null;

create table if not exists auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  provider_id text references identity_providers(id),
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint auth_audit_events_event_type_nonempty_check check (btrim(event_type) <> '')
);

create index if not exists auth_audit_events_account_idx
  on auth_audit_events (account_id, created_at desc)
  where account_id is not null;

insert into auth_accounts (
  id, account_id, user_id, provider_id, provider_subject, email, display_name, linked_at, updated_at
)
select
  id,
  account_id,
  user_id,
  provider_id,
  provider_subject,
  email,
  display_name,
  linked_at,
  updated_at
from user_identities
on conflict (id) do update set
  account_id = excluded.account_id,
  user_id = excluded.user_id,
  provider_id = excluded.provider_id,
  provider_subject = excluded.provider_subject,
  email = excluded.email,
  display_name = excluded.display_name,
  updated_at = excluded.updated_at;

insert into verification_challenges (
  id, channel, destination, purpose, code_hash, attempts, max_attempts,
  status, expires_at, verified_at, created_at, updated_at
)
select
  id,
  channel,
  destination,
  'login',
  code_hash,
  attempts,
  max_attempts,
  case
    when verified_at is not null then 'verified'
    when expires_at <= now() then 'expired'
    when attempts >= max_attempts then 'locked'
    else 'pending'
  end,
  expires_at,
  verified_at,
  created_at,
  coalesce(verified_at, created_at)
from otp_challenges
on conflict (id) do update set
  channel = excluded.channel,
  destination = excluded.destination,
  code_hash = excluded.code_hash,
  attempts = excluded.attempts,
  max_attempts = excluded.max_attempts,
  status = excluded.status,
  expires_at = excluded.expires_at,
  verified_at = excluded.verified_at,
  updated_at = excluded.updated_at;
