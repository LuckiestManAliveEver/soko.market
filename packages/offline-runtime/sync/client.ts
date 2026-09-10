import type { LocalDatabase } from "../db/client.js";
import {
  OfflineError,
  type Scope,
  type Ack,
  type PullPage,
  type LocalState,
  type Entity
} from "../types.js";
export interface SyncTransport {
  push(operations: LocalState["operations"]): Promise<{ results: Ack[] }>;
  pull(cursor: string | null): Promise<PullPage>;
}
export class SyncClient {
  private running: Promise<void> | null = null;
  constructor(
    private db: LocalDatabase,
    private scope: Scope,
    private transport: SyncTransport
  ) {}
  sync(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async run(): Promise<void> {
    await this.push();
    await this.pull();
  }
  async push(): Promise<void> {
    // Serialize per device. Later operations may depend on an earlier create's assigned ID.
    for (let count = 0; count < 10_000; count++) {
      const state = await this.db.read(this.scope);
      const operation = state.operations.find((op) => op.syncStatus !== "ACKED");
      if (!operation || operation.syncStatus === "CONFLICT") return;
      if (operation.nextAttemptAt > Date.now())
        throw new OfflineError("SYNC_BACKOFF", "Please wait before retrying sync.");
      const claimed = await this.db.transaction(this.scope, (current) => {
        const item = current.operations.find((op) => op.id === operation.id)!;
        if (item.syncStatus === "ACKED" || item.syncStatus === "CONFLICT") return false;
        item.syncStatus = "PUSHED";
        return true;
      });
      if (!claimed) continue;
      let results: Ack[];
      try {
        ({ results } = await this.transport.push([operation]));
      } catch (error) {
        await this.db.transaction(this.scope, (current) => {
          const item = current.operations.find((op) => op.id === operation.id)!;
          if (item.syncStatus === "ACKED" || item.syncStatus === "CONFLICT") return;
          item.syncStatus = "PENDING";
          item.attempts++;
          item.nextAttemptAt =
            Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(item.attempts - 1, 6));
        });
        throw error;
      }
      const ack = results[0];
      if (
        results.length !== 1 ||
        !ack ||
        ack.id !== operation.id ||
        ack.localSeq !== operation.localSeq ||
        !["ACKED", "CONFLICT", "REJECTED"].includes(ack.status)
      )
        throw new Error("Invalid sync acknowledgement.");
      await this.db.transaction(this.scope, (current) => {
        const item = current.operations.find((op) => op.id === operation.id)!;
        if (item.syncStatus === "ACKED" || item.syncStatus === "CONFLICT") return;
        const row = current.rows.find(
          (candidate) =>
            candidate.local_id === item.entityLocalId && candidate.collection === item.collection
        );
        item.serverOpId = ack.serverOpId;
        item.conflictInfo = ack.message;
        if (ack.status === "ACKED") {
          if (ack.entity?.businessId !== this.scope.storeId)
            throw new Error("Acknowledgement belongs to another store.");
          item.syncStatus = "ACKED";
          current.lastPushedLocalSeq = item.localSeq;
          const later = current.operations.filter(
            (op) =>
              op.entityLocalId === item.entityLocalId &&
              op.collection === item.collection &&
              op.localSeq > item.localSeq &&
              op.syncStatus !== "ACKED"
          );
          for (const op of later) {
            op.entityCloudId = ack.entity.id;
            // Rebase only the immediate successor: subsequent bases include earlier local edits.
          }
          if (later[0]) later[0].base = structuredClone(ack.entity);
          if (row) {
            row.cloud_id = ack.entity.id;
            row.payload.id = ack.entity.id;
            row.synced_at = new Date().toISOString();
            row.dirty = later.length > 0;
            if (!row.dirty) row.payload = ack.entity;
          }
        } else {
          item.attempts++;
          item.syncStatus =
            ack.status === "CONFLICT" || item.attempts >= 3 ? "CONFLICT" : "REJECTED";
          item.nextAttemptAt = Date.now() + 1_000 * 2 ** Math.min(item.attempts, 6);
          if (item.syncStatus === "CONFLICT")
            current.conflicts.push({
              id: item.id,
              operationId: item.id,
              collection: item.collection,
              entityLocalId: item.entityLocalId,
              message: ack.message ?? "Review this change before syncing.",
              local: row?.payload ?? null,
              server: ack.entity
            });
        }
      });
      if (ack.status !== "ACKED") return;
    }
    throw new Error("Sync exceeded its operation limit; pending operations were retained.");
  }
  async pull(): Promise<void> {
    for (let index = 0; index < 1_000; index++) {
      const before = await this.db.read(this.scope);
      const page = await this.transport.pull(before.pullCursor);
      if (
        page.accountId !== this.scope.accountId ||
        page.storeId !== this.scope.storeId ||
        page.fromCursor !== before.pullCursor
      )
        throw new Error("Sync scope or cursor mismatch.");
      await this.db.transaction(this.scope, (state) => {
        if (state.pullCursor !== before.pullCursor)
          throw new Error("Another tab already advanced this sync cursor.");
        let sequence = Number(state.pullCursor ?? "0");
        for (const change of page.changes) {
          if (
            change.businessId !== this.scope.storeId ||
            !Number.isSafeInteger(change.sequence) ||
            change.sequence <= sequence
          )
            throw new Error("Invalid ordered sync change.");
          sequence = change.sequence;
          // Runtime pins and all unknown domains are excluded even if sent by the server.
          if (
            !["products", "customers", "invoices", "orders", "productFields"].includes(
              change.collection
            )
          )
            continue;
          const row = state.rows.find(
            (entry) => entry.collection === change.collection && entry.cloud_id === change.entityId
          );
          if (row?.dirty) continue;
          if (change.entity === null) {
            state.rows = state.rows.filter((entry) => entry !== row);
            continue;
          }
          if (
            change.entity.id !== change.entityId ||
            change.entity.businessId !== this.scope.storeId
          )
            throw new Error("Invalid sync entity.");
          if (row) {
            row.payload = change.entity;
            row.synced_at = new Date().toISOString();
          } else
            state.rows.push({
              local_id: change.entityId,
              cloud_id: change.entityId,
              store_id: this.scope.storeId,
              collection: change.collection,
              payload: change.entity,
              dirty: false,
              synced_at: new Date().toISOString(),
              updated_at_local: new Date().toISOString()
            });
        }
        const next = Number(page.newCursor);
        if (
          !Number.isSafeInteger(next) ||
          next < sequence ||
          (page.hasMore && next <= Number(before.pullCursor ?? "0"))
        )
          throw new Error("Invalid next sync cursor.");
        state.pullCursor = page.newCursor;
      });
      if (!page.hasMore) return;
    }
    throw new Error("Sync exceeded its page limit.");
  }
  async resolveManual(operationId: string, choice: "server" | "retry"): Promise<void> {
    await this.db.transaction(this.scope, (state) => {
      const conflict = state.conflicts.find((entry) => entry.operationId === operationId);
      const operation = state.operations.find((entry) => entry.id === operationId);
      if (!conflict || !operation) throw new Error("Conflict no longer exists.");
      const dependents = state.operations.filter(
        (entry) =>
          entry.entityLocalId === operation.entityLocalId &&
          entry.collection === operation.collection &&
          entry.localSeq > operation.localSeq &&
          entry.syncStatus !== "ACKED"
      );
      operation.syncStatus = "ACKED";
      operation.conflictInfo = `User selected ${choice}.`;
      const row = state.rows.find((entry) => entry.local_id === operation.entityLocalId);
      for (const dependent of dependents) {
        dependent.syncStatus = "ACKED";
        dependent.conflictInfo = `Superseded by explicit ${choice} resolution of ${operation.id}.`;
      }
      if (choice === "server") {
        if (row && conflict.server) {
          row.payload = conflict.server;
          row.cloud_id = conflict.server.id;
          row.dirty = false;
        } else state.rows = state.rows.filter((entry) => entry !== row);
      } else {
        const last = dependents.at(-1) ?? operation;
        const payload =
          operation.opType === "catalogue.create" || operation.opType === "catalogue.update"
            ? (row?.payload ?? operation.payload)
            : operation.opType === "inventory.adjust"
              ? { ...last.payload, quantityAfter: row?.payload.quantity }
              : operation.payload;
        state.operations.push({
          ...operation,
          payload: structuredClone(payload),
          id: crypto.randomUUID(),
          localSeq: state.nextLocalSeq++,
          base: conflict.server as Entity | null,
          syncStatus: "PENDING",
          attempts: 0,
          nextAttemptAt: 0,
          serverOpId: null,
          conflictInfo: null
        });
      }
      state.conflicts = state.conflicts.filter((entry) => entry !== conflict);
    });
  }
}
