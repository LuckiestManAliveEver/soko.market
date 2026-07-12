create table if not exists mcp_access_tokens (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  session_id uuid not null references sessions (id) on delete cascade,
  token_hash character(64) not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  name text not null check (char_length(name) between 3 and 80),
  scopes text[] not null check (
    cardinality(scopes) > 0
    and scopes <@ array['mcp:read', 'mcp:act']::text[]
  ),
  shop_id uuid references businesses (id) on delete cascade,
  created_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  check (expires_at > created_at)
);

create index if not exists mcp_access_tokens_account_updated_idx
  on mcp_access_tokens (account_id, created_at desc);

create index if not exists mcp_access_tokens_expiry_idx
  on mcp_access_tokens (expires_at)
  where revoked_at is null;
