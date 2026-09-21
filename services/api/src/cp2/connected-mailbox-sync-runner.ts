import type { ConnectedMailboxBackgroundSyncSummary, Cp2Store } from "./store.js";
import { createIntervalRunner } from "./interval-runner.js";

const defaultIntervalMs = 5 * 60_000;

export interface ConnectedMailboxSyncRunner {
  runNow: () => Promise<ConnectedMailboxBackgroundSyncSummary | null>;
  stop: () => Promise<void>;
}

export function startConnectedMailboxSyncRunner(options: {
  store: Pick<Cp2Store, "syncDueConnectedMailboxes">;
  intervalMs?: number;
  runOnStart?: boolean;
  onResult?: (result: ConnectedMailboxBackgroundSyncSummary) => void;
  onError?: (error: unknown) => void;
  timeScheduledJob?: <R>(job: string, fn: () => Promise<R>) => Promise<R>;
}): ConnectedMailboxSyncRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  return createIntervalRunner({
    job: "connected_mailbox_sync",
    intervalMs,
    run: () => options.store.syncDueConnectedMailboxes({ staleAfterMs: intervalMs }),
    ...(options.runOnStart === undefined ? {} : { runOnStart: options.runOnStart }),
    ...(options.onResult === undefined ? {} : { onResult: options.onResult }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.timeScheduledJob === undefined
      ? {}
      : { timeScheduledJob: options.timeScheduledJob })
  });
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return defaultIntervalMs;
  if (!Number.isSafeInteger(value) || value < 60_000) {
    throw new Error("Connected mailbox sync interval must be at least 60000 milliseconds.");
  }
  return value;
}
