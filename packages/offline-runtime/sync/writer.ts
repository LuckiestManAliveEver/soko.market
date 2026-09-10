import type { LocalDatabase } from "../db/client.js";
import {
  OfflineError,
  type Entity,
  type LocalState,
  type Mutation,
  type Collection,
  type Scope,
  type Operation
} from "../types.js";

export function recordOperation(
  db: LocalDatabase,
  scope: Scope,
  input: {
    opType: Mutation;
    collection: Collection;
    entityLocalId: string;
    payload: Record<string, unknown>;
  },
  apply: (state: LocalState, operation: Operation) => Entity
): Promise<Entity> {
  return db.transaction(scope, (state) => {
    if (!state.installed || !state.offlineModeActive)
      throw new OfflineError("OFFLINE_NOT_ACTIVE", "Choose Go Offline in Settings first.");
    const existing = state.rows.find(
      (row) =>
        row.collection === input.collection &&
        (row.local_id === input.entityLocalId || row.cloud_id === input.entityLocalId)
    );
    const operation: Operation = {
      ...scope,
      ...input,
      id: crypto.randomUUID(),
      localSeq: state.nextLocalSeq++,
      entityLocalId: existing?.local_id ?? input.entityLocalId,
      entityCloudId: existing?.cloud_id ?? null,
      base: existing ? structuredClone(existing.payload) : null,
      payload: structuredClone(input.payload),
      createdAtLocal: new Date().toISOString(),
      syncStatus: "PENDING",
      attempts: 0,
      nextAttemptAt: 0,
      serverOpId: null,
      conflictInfo: null
    };
    state.operations.push(operation);
    const entity = apply(state, operation);
    const row = {
      local_id: operation.entityLocalId,
      cloud_id: operation.entityCloudId,
      store_id: scope.storeId,
      updated_at_local: operation.createdAtLocal,
      synced_at: null,
      dirty: true,
      collection: input.collection,
      payload: entity
    };
    if (existing) Object.assign(existing, row);
    else state.rows.push(row);
    return entity;
  });
}
