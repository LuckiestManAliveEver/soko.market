PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS local_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runtime_scopes (
  scope_key TEXT PRIMARY KEY, account_id TEXT NOT NULL, store_id TEXT NOT NULL,
  device_id TEXT NOT NULL, state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  UNIQUE(scope_key, store_id)
);
CREATE TABLE IF NOT EXISTS products (
  local_id TEXT NOT NULL, cloud_id TEXT, store_id TEXT NOT NULL,
  scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  updated_at_local TEXT NOT NULL, synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(scope_key, local_id), UNIQUE(scope_key, cloud_id),
  FOREIGN KEY(scope_key, store_id) REFERENCES runtime_scopes(scope_key, store_id)
);
CREATE TABLE IF NOT EXISTS customers (
  local_id TEXT NOT NULL, cloud_id TEXT, store_id TEXT NOT NULL,
  scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  updated_at_local TEXT NOT NULL, synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(scope_key, local_id), UNIQUE(scope_key, cloud_id),
  FOREIGN KEY(scope_key, store_id) REFERENCES runtime_scopes(scope_key, store_id)
);
CREATE TABLE IF NOT EXISTS invoices (
  local_id TEXT NOT NULL, cloud_id TEXT, store_id TEXT NOT NULL,
  scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  updated_at_local TEXT NOT NULL, synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(scope_key, local_id), UNIQUE(scope_key, cloud_id),
  FOREIGN KEY(scope_key, store_id) REFERENCES runtime_scopes(scope_key, store_id)
);
CREATE TABLE IF NOT EXISTS orders (
  local_id TEXT NOT NULL, cloud_id TEXT, store_id TEXT NOT NULL,
  scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  updated_at_local TEXT NOT NULL, synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(scope_key, local_id), UNIQUE(scope_key, cloud_id),
  FOREIGN KEY(scope_key, store_id) REFERENCES runtime_scopes(scope_key, store_id)
);
CREATE TABLE IF NOT EXISTS productFields (
  local_id TEXT NOT NULL, cloud_id TEXT, store_id TEXT NOT NULL,
  scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  updated_at_local TEXT NOT NULL, synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(scope_key, local_id), UNIQUE(scope_key, cloud_id),
  FOREIGN KEY(scope_key, store_id) REFERENCES runtime_scopes(scope_key, store_id)
);
CREATE TABLE IF NOT EXISTS sync_operations (
  local_id TEXT NOT NULL, scope_key TEXT NOT NULL REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  cloud_id TEXT, store_id TEXT NOT NULL, device_id TEXT NOT NULL,
  local_seq INTEGER NOT NULL CHECK(local_seq > 0), op_type TEXT NOT NULL,
  entity_table TEXT NOT NULL CHECK(entity_table IN ('products','customers')),
  entity_local_id TEXT NOT NULL, entity_cloud_id TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)),
  updated_at_local TEXT NOT NULL, synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0,1)),
  sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(sync_status IN ('PENDING','PUSHED','ACKED','REJECTED','CONFLICT')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), conflict_info TEXT,
  PRIMARY KEY(scope_key, local_id), UNIQUE(scope_key, device_id, local_seq)
);
CREATE TABLE IF NOT EXISTS device_runtime_pins (
  scope_key TEXT PRIMARY KEY REFERENCES runtime_scopes(scope_key) ON DELETE CASCADE,
  local_id TEXT NOT NULL, cloud_id TEXT, store_id TEXT NOT NULL, device_id TEXT NOT NULL,
  updated_at_local TEXT NOT NULL, synced_at TEXT, dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  agent_id TEXT NOT NULL, agent_version TEXT NOT NULL, harness_version TEXT NOT NULL,
  model_id TEXT NOT NULL, model_version TEXT NOT NULL,
  explicit_swap INTEGER NOT NULL DEFAULT 0 CHECK(explicit_swap IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS pending_conflicts (
  scope_key TEXT NOT NULL, operation_id TEXT NOT NULL, details TEXT NOT NULL CHECK(json_valid(details)),
  PRIMARY KEY(scope_key, operation_id),
  FOREIGN KEY(scope_key, operation_id) REFERENCES sync_operations(scope_key, local_id)
);
INSERT OR IGNORE INTO local_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
