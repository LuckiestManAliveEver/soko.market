-- Migration only; do not apply to a shared environment without an explicit deployment action.
-- Uses the existing Cp2Snapshot normalized record format, not Prisma.
CREATE TABLE IF NOT EXISTS cp2_offline_receipts (
 entity_id text PRIMARY KEY,
 business_id text NOT NULL REFERENCES cp2_businesses(entity_id) ON DELETE CASCADE,
 account_id text NOT NULL, user_id text, parent_id text,
 record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (record->>'businessId' = business_id),
 CHECK (record->>'accountId' = account_id),
 CHECK ((record->>'localSeq')::bigint > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS cp2_offline_device_sequence
 ON cp2_offline_receipts(account_id, business_id, (record->>'deviceId'), ((record->>'localSeq')::bigint));
CREATE TABLE IF NOT EXISTS cp2_offline_changes (
 entity_id text PRIMARY KEY,
 business_id text NOT NULL REFERENCES cp2_businesses(entity_id) ON DELETE CASCADE,
 account_id text, user_id text, parent_id text,
 record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (record->>'businessId' = business_id),
 CHECK ((record->>'sequence')::bigint > 0)
);
CREATE INDEX IF NOT EXISTS cp2_offline_changes_cursor ON cp2_offline_changes(business_id, ((record->>'sequence')::bigint));
CREATE UNIQUE INDEX IF NOT EXISTS cp2_offline_changes_sequence ON cp2_offline_changes(((record->>'sequence')::bigint));
CREATE TABLE IF NOT EXISTS cp2_offline_metadata (
 entity_id text PRIMARY KEY, business_id text, account_id text, user_id text, parent_id text,
 record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((record->>'sequence')::bigint >= 0)
);
