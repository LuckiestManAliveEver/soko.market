CREATE TABLE IF NOT EXISTS offline_sync_queue (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL,
  business_id uuid NOT NULL REFERENCES businesses (id),
  actor_id uuid NOT NULL REFERENCES users (id),
  mutation_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  client_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  next_attempt_at timestamptz,
  result jsonb,
  conflict jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS offline_sync_queue_business_idempotency_idx
  ON offline_sync_queue (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS offline_sync_queue_business_status_idx
  ON offline_sync_queue (business_id, status, created_at);

CREATE TABLE IF NOT EXISTS offline_cache_snapshots (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  captured_at timestamptz NOT NULL,
  source text NOT NULL
);

CREATE INDEX IF NOT EXISTS offline_cache_snapshots_business_captured_idx
  ON offline_cache_snapshots (business_id, captured_at);
