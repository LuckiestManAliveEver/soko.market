import { emptyState, scopeKey, type LocalState, type Scope } from "../types.js";
import type { LocalDatabase } from "./client.js";
import { initialSql } from "./migrations/sql.js";
/** Structural subset of better-sqlite3; native code stays out of the PWA bundle. */
export interface SqliteDriver {
  exec(sql: string): unknown;
  prepare(sql: string): { get(...params: unknown[]): unknown; run(...params: unknown[]): unknown };
  close(): void;
}
export function openSqliteLocalDatabase(driver: SqliteDriver): LocalDatabase {
  driver.exec(initialSql);
  function read(scope: Scope): LocalState {
    const result = driver
      .prepare("SELECT state_json FROM runtime_scopes WHERE scope_key = ?")
      .get(scopeKey(scope)) as { state_json: string } | undefined;
    return result ? (JSON.parse(result.state_json) as LocalState) : emptyState(scope);
  }
  return {
    read: async (scope) => read(scope),
    async transaction<T>(scope: Scope, change: (state: LocalState) => T): Promise<T> {
      driver.exec("BEGIN IMMEDIATE");
      try {
        const state = read(scope);
        const result = change(state);
        if (result instanceof Promise) throw new Error("SQLite transactions must be synchronous.");
        const key = scopeKey(scope);
        driver
          .prepare(
            "INSERT INTO runtime_scopes VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope_key) DO UPDATE SET state_json = excluded.state_json"
          )
          .run(key, scope.accountId, scope.storeId, scope.deviceId, JSON.stringify(state));
        for (const table of [
          "products",
          "customers",
          "invoices",
          "orders",
          "productFields"
        ] as const) {
          driver.prepare(`DELETE FROM ${table} WHERE scope_key = ?`).run(key);
          for (const row of state.rows.filter((entry) => entry.collection === table))
            driver
              .prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(
                row.local_id,
                row.cloud_id,
                row.store_id,
                key,
                row.updated_at_local,
                row.synced_at,
                Number(row.dirty),
                JSON.stringify(row.payload)
              );
        }
        driver.prepare("DELETE FROM pending_conflicts WHERE scope_key = ?").run(key);
        for (const operation of state.operations)
          driver
            .prepare(
              "INSERT INTO sync_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_key, local_id) DO UPDATE SET sync_status=excluded.sync_status, attempts=excluded.attempts, conflict_info=excluded.conflict_info, entity_cloud_id=excluded.entity_cloud_id, dirty=excluded.dirty"
            )
            .run(
              operation.id,
              key,
              operation.serverOpId,
              scope.storeId,
              scope.deviceId,
              operation.localSeq,
              operation.opType,
              operation.collection,
              operation.entityLocalId,
              operation.entityCloudId,
              JSON.stringify(operation.payload),
              operation.createdAtLocal,
              null,
              Number(operation.syncStatus !== "ACKED"),
              operation.syncStatus,
              operation.attempts,
              operation.conflictInfo
            );
        for (const conflict of state.conflicts)
          driver
            .prepare("INSERT INTO pending_conflicts VALUES (?, ?, ?)")
            .run(key, conflict.operationId, JSON.stringify(conflict));
        if (state.pin) {
          const pin = state.pin;
          driver
            .prepare(
              "INSERT OR REPLACE INTO device_runtime_pins VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
              key,
              key,
              null,
              scope.storeId,
              scope.deviceId,
              pin.pinnedAt,
              null,
              0,
              pin.agentId,
              pin.agentVersion,
              pin.harnessVersion,
              pin.modelId,
              pin.modelVersion,
              Number(pin.explicitSwap),
              Number(pin.active)
            );
        }
        driver.exec("COMMIT");
        return result;
      } catch (error) {
        driver.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => driver.close()
  };
}
