-- Real (not generic cp2_* entity_id/record) table for GitHub/Hugging Face personal access token
-- connections, modeled on user_identities (008_social_auth_oauth.sql) and mcp_access_tokens
-- (019_cp23_mcp_access_tokens.sql): a real encrypted-secret column belongs in typed columns, not
-- a JSONB blob. One connection per (account_id, provider); reconnecting the same provider upserts
-- via the unique index below rather than creating a duplicate row.

create table if not exists cp2_external_registry_connections (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  provider text not null check (provider in ('github', 'huggingface')),
  external_account_id text,
  external_username text,
  status text not null check (status in ('connected', 'expired', 'revoked', 'error')),
  scopes text[] not null default '{}'::text[],
  encrypted_token text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create unique index if not exists cp2_external_registry_connections_account_provider_idx
  on cp2_external_registry_connections (account_id, provider);
