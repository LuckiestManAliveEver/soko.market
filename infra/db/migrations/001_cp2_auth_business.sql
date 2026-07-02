CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  primary_auth_channel text NOT NULL,
  primary_auth_destination text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT accounts_primary_auth_unique UNIQUE (primary_auth_channel, primary_auth_destination)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  display_name text NOT NULL,
  language text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  language text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS business_memberships (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT business_memberships_user_business_unique UNIQUE (business_id, user_id)
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY,
  channel text NOT NULL,
  destination text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  user_id uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS users_account_idx
  ON users (account_id);

CREATE INDEX IF NOT EXISTS business_memberships_user_idx
  ON business_memberships (user_id);

CREATE INDEX IF NOT EXISTS otp_challenges_destination_idx
  ON otp_challenges (channel, destination, created_at);

CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON sessions (user_id, expires_at, revoked_at);
