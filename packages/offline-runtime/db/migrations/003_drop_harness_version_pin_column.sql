-- Harness stops being an independently pinned runtime dimension: engine choice is now implied by
-- which agent definition a device is pinned to (agent_id/agent_version), not a separate version.
-- Executed on every openSqliteLocalDatabase() call, same as 001/002, so it is safe for both a
-- fresh install (where the column never existed) and an existing device upgrading in place.
ALTER TABLE device_runtime_pins DROP COLUMN harness_version;
INSERT OR IGNORE INTO local_migrations VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
