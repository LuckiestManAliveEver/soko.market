create table if not exists identity_providers (
  id text primary key,
  display_name text not null,
  authorization_url text not null,
  token_url text not null,
  user_info_url text,
  scopes jsonb not null,
  pkce boolean not null,
  created_at timestamp with time zone not null
);

create table if not exists user_identities (
  id uuid primary key,
  account_id uuid not null references accounts(id),
  user_id uuid not null references users(id),
  provider_id text not null references identity_providers(id),
  provider_subject text not null,
  email text,
  display_name text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  encrypted_id_token text,
  token_type text,
  token_expires_at timestamp with time zone,
  scope text,
  linked_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create unique index if not exists user_identities_provider_subject_idx
  on user_identities(provider_id, provider_subject);

create index if not exists user_identities_email_idx
  on user_identities(provider_id, email);

create table if not exists oauth_sessions (
  id uuid primary key,
  provider_id text not null references identity_providers(id),
  account_id uuid references accounts(id),
  state_hash text not null,
  csrf_hash text not null,
  code_challenge text not null,
  encrypted_code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamp with time zone not null,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null
);

create unique index if not exists oauth_sessions_state_hash_idx
  on oauth_sessions(state_hash);

create index if not exists oauth_sessions_provider_pending_idx
  on oauth_sessions(provider_id, completed_at, expires_at);
