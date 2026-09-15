-- Additive to 001_initial.sql - never edit that file's applied content, only add new
-- CREATE TABLE IF NOT EXISTS statements here. Executed on every openSqliteLocalDatabase() call,
-- same as 001, so it is safe for both a fresh install and an existing device upgrading in place.
CREATE TABLE IF NOT EXISTS pending_offline_orders (
  local_id TEXT NOT NULL, scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  store_id TEXT NOT NULL, transport TEXT NOT NULL CHECK(transport IN ('ble','sms')),
  status TEXT NOT NULL DEFAULT 'pending_sync' CHECK(status IN ('pending_sync','confirmed','rejected','partial')),
  created_at_local TEXT NOT NULL, synced_at TEXT,
  intent TEXT NOT NULL CHECK(json_valid(intent)), outcome TEXT CHECK(outcome IS NULL OR json_valid(outcome)),
  PRIMARY KEY(scope_key, local_id),
  FOREIGN KEY(scope_key, store_id) REFERENCES runtime_scopes(scope_key, store_id)
);
