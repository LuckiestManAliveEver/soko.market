import type { BusinessEvent } from "@soko/event-core";
import type {
  SyncConflict,
  SyncMutationPayload,
  SyncMutationType,
  SyncQueueItem,
  SyncQueueStatus,
  SyncQueueSummary
} from "@soko/shared-types";

export const syncQueueStatuses: SyncQueueStatus[] = [
  "pending",
  "processing",
  "synced",
  "failed",
  "conflict"
];

export const syncMutationTypes: SyncMutationType[] = [
  "product.create",
  "customer.create",
  "supplier.create",
  "inventory.adjust",
  "invoice.create",
  "invoice.confirm",
  "payment.record",
  "logistics.create",
  "logistics.update_status"
];

export type LegacySyncQueueStatus = "queued" | "syncing" | "synced" | "failed";

export interface LegacySyncQueueItem {
  event: BusinessEvent;
  status: LegacySyncQueueStatus;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface CreateSyncQueueItemInput {
  id: string;
  idempotencyKey: string;
  businessId: string;
  actorId: string;
  mutationType: SyncMutationType;
  payload: SyncMutationPayload;
  clientCreatedAt: string;
  now: string;
}

export interface ReplayFailureInput {
  code: string;
  message: string;
  statusCode: number;
  now: string;
}

export function enqueueEvent(event: BusinessEvent): LegacySyncQueueItem {
  return {
    event,
    status: "queued",
    attempts: 0,
    nextAttemptAt: null
  };
}

export function isSyncMutationType(value: string): value is SyncMutationType {
  return syncMutationTypes.includes(value as SyncMutationType);
}

export function createSyncQueueItem(input: CreateSyncQueueItemInput): SyncQueueItem {
  return {
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    businessId: input.businessId,
    actorId: input.actorId,
    mutationType: input.mutationType,
    payload: input.payload,
    status: "pending",
    attempts: 0,
    clientCreatedAt: input.clientCreatedAt,
    createdAt: input.now,
    updatedAt: input.now,
    nextAttemptAt: null,
    result: null,
    conflict: null
  };
}

export function markSyncProcessing(item: SyncQueueItem, now: string): SyncQueueItem {
  return {
    ...item,
    status: "processing",
    attempts: item.attempts + 1,
    updatedAt: now,
    nextAttemptAt: null,
    conflict: null
  };
}

export function markSyncSynced(item: SyncQueueItem, result: unknown, now: string): SyncQueueItem {
  return {
    ...item,
    status: "synced",
    updatedAt: now,
    nextAttemptAt: null,
    result,
    conflict: null
  };
}

export function markSyncRejected(item: SyncQueueItem, failure: ReplayFailureInput): SyncQueueItem {
  const conflict = classifySyncConflict(failure);

  return {
    ...item,
    status: conflict.retryable ? "failed" : "conflict",
    updatedAt: failure.now,
    nextAttemptAt: conflict.retryable ? nextRetryAt(failure.now, item.attempts) : null,
    conflict,
    result: null
  };
}

export function summarizeSyncQueue(
  businessId: string,
  items: readonly SyncQueueItem[]
): SyncQueueSummary {
  const summary: SyncQueueSummary = {
    businessId,
    pending: 0,
    processing: 0,
    synced: 0,
    failed: 0,
    conflict: 0,
    total: 0
  };

  for (const item of items) {
    if (item.businessId !== businessId) {
      continue;
    }

    summary[item.status] += 1;
    summary.total += 1;
  }

  return summary;
}

export function classifySyncConflict(input: Omit<ReplayFailureInput, "now">): SyncConflict {
  const retryable = input.statusCode >= 500 || input.statusCode === 429;

  return {
    code: input.code,
    message: input.message,
    statusCode: input.statusCode,
    retryable
  };
}

function nextRetryAt(now: string, attempts: number): string {
  const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.parse(now) + delayMs).toISOString();
}
