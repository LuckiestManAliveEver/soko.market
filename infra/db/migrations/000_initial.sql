CREATE TABLE IF NOT EXISTS business_events (
  id uuid PRIMARY KEY,
  aggregate_id text NOT NULL,
  aggregate_type text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  risk text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES business_events (id),
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz
);

CREATE INDEX IF NOT EXISTS business_events_aggregate_idx
  ON business_events (aggregate_type, aggregate_id, occurred_at);

CREATE INDEX IF NOT EXISTS sync_queue_status_idx
  ON sync_queue (status, next_attempt_at);
