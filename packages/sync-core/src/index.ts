import type { BusinessEvent } from "@soko/event-core";

export type SyncQueueStatus = "queued" | "syncing" | "synced" | "failed";

export interface SyncQueueItem {
  event: BusinessEvent;
  status: SyncQueueStatus;
  attempts: number;
  nextAttemptAt: string | null;
}

export function enqueueEvent(event: BusinessEvent): SyncQueueItem {
  return {
    event,
    status: "queued",
    attempts: 0,
    nextAttemptAt: null
  };
}
