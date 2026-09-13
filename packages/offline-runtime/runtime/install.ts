import type { LocalDatabase } from "../db/client.js";
import { migrateLocalDatabase } from "../db/migrations/index.js";
import { validateBinding } from "./pin.js";
import {
  OfflineError,
  type Entity,
  type Collection,
  type RuntimeBinding,
  type Scope
} from "../types.js";
export interface InstallSnapshot {
  accountId: string;
  storeId: string;
  cursor: string;
  collections: Partial<Record<Collection, Entity[]>>;
}
export interface InstalledRuntimeAdapter {
  supports(binding: RuntimeBinding): Promise<boolean>;
  install(
    binding: RuntimeBinding,
    progress: (downloaded: number, total: number) => void
  ): Promise<void>;
  infer(binding: RuntimeBinding, args: unknown): Promise<unknown>;
}
export type InstallStep = "storage" | "database" | "snapshot" | "shell" | "runtime" | "complete";
export async function installOfflineRuntime(input: {
  db: LocalDatabase;
  scope: Scope;
  estimate: () => Promise<{ quota?: number; usage?: number }>;
  snapshot: () => Promise<InstallSnapshot>;
  binding: RuntimeBinding | null;
  adapter?: InstalledRuntimeAdapter;
  businessDataOnly: boolean;
  /** Handoff callers activate routing only after the destination acknowledges resume. */
  activate?: boolean;
  prepareShell?: (progress: (completed: number, total: number) => void) => Promise<void>;
  progress: (step: InstallStep, completed: number, total: number) => void;
}): Promise<void> {
  const previous = await input.db.read(input.scope);
  if (previous.operations.some((operation) => operation.syncStatus !== "ACKED"))
    throw new Error("Sync or resolve your pending changes before reinstalling.");
  const binding = previous.pin ?? input.binding;
  if (!input.businessDataOnly) {
    if (!binding || !input.adapter || !(await input.adapter.supports(binding)))
      throw new OfflineError(
        "DEVICE_NOT_SUPPORTED",
        "This device has no compatible local AI runtime. You can install business data only."
      );
    validateBinding(binding);
  }
  input.progress("storage", 0, 1);
  const storage = await input.estimate();
  const artifactBytes = input.businessDataOnly
    ? 0
    : binding!.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  assertStorage(storage, artifactBytes + 16 * 1024 * 1024);
  input.progress("storage", 1, 1);
  input.progress("database", 0, 1);
  await migrateLocalDatabase(input.db, input.scope);
  input.progress("database", 1, 1);
  input.progress("snapshot", 0, 1);
  const snapshot = await input.snapshot();
  if (snapshot.accountId !== input.scope.accountId || snapshot.storeId !== input.scope.storeId)
    throw new Error("The business snapshot belongs to another account or store.");
  assertStorage(
    storage,
    artifactBytes + new TextEncoder().encode(JSON.stringify(snapshot)).byteLength * 3
  );
  input.progress("snapshot", 1, 1);
  await input.prepareShell?.((completed, total) => input.progress("shell", completed, total));
  if (!input.businessDataOnly) {
    input.progress("runtime", 0, artifactBytes);
    await input.adapter!.install(binding!, (completed, total) =>
      input.progress("runtime", completed, total)
    );
  }
  // Activate only after all downloads succeed. Failed installs never replace an active snapshot.
  await input.db.transaction(input.scope, (state) => {
    if (state.operations.some((operation) => operation.syncStatus !== "ACKED"))
      throw new Error("Another tab created a pending change during installation.");
    const now = new Date().toISOString();
    state.rows = [];
    for (const [collection, entities] of Object.entries(snapshot.collections)) {
      if (!["products", "customers", "invoices", "orders", "productFields"].includes(collection))
        throw new Error("Unsupported snapshot collection.");
      for (const entity of entities) {
        if (entity.businessId !== input.scope.storeId || !entity.id)
          throw new Error("Invalid snapshot entity.");
        state.rows.push({
          local_id: entity.id,
          cloud_id: entity.id,
          store_id: input.scope.storeId,
          collection: collection as Collection,
          payload: entity,
          dirty: false,
          synced_at: now,
          updated_at_local: now
        });
      }
    }
    if (!input.businessDataOnly && !state.pin)
      state.pin = { ...binding!, ...input.scope, pinnedAt: now, active: true, explicitSwap: false };
    state.pullCursor = snapshot.cursor;
    state.installed = true;
    state.offlineModeActive = input.activate ?? true;
    state.installedAt = now;
  });
  input.progress("complete", 1, 1);
}
export function assertStorage(estimate: { quota?: number; usage?: number }, bytes: number): void {
  if (
    estimate.quota === undefined ||
    estimate.usage === undefined ||
    !Number.isFinite(estimate.quota) ||
    !Number.isFinite(estimate.usage) ||
    !Number.isFinite(bytes) ||
    bytes < 0
  )
    throw new OfflineError(
      "STORAGE_UNKNOWN",
      "Storage availability could not be checked on this device."
    );
  const headroom = Math.max(256 * 1024 * 1024, estimate.quota * 0.2);
  if (estimate.quota - estimate.usage < bytes + headroom)
    throw new OfflineError(
      "NOT_ENOUGH_STORAGE",
      "There is not enough space to install safely. Free some storage and try again."
    );
}
