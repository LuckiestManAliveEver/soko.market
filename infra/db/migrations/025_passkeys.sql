create table if not exists cp2_passkeys (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_passkeys_account_idx
  on cp2_passkeys (account_id)
  where account_id is not null;

create table if not exists cp2_passkey_ceremonies (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_passkey_ceremonies_expires_idx
  on cp2_passkey_ceremonies ((record->>'expiresAt'));
