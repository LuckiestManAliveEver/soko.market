import type { ConnectedMailboxBackgroundSyncSummary, Cp2Store } from "./store.js";

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
}): ConnectedMailboxSyncRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let inFlight: Promise<ConnectedMailboxBackgroundSyncSummary | null> | null = null;

  const runNow = () => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;
    inFlight = options.store
      .syncDueConnectedMailboxes({ staleAfterMs: intervalMs })
      .then((result) => {
        options.onResult?.(result);
        return result;
      })
      .catch((error: unknown) => {
        options.onError?.(error);
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const timer = setInterval(() => void runNow(), intervalMs);
  timer.unref();
  if (options.runOnStart !== false) void runNow();

  return {
    runNow,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    }
  };
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return defaultIntervalMs;
  if (!Number.isSafeInteger(value) || value < 60_000) {
    throw new Error("Connected mailbox sync interval must be at least 60000 milliseconds.");
  }
  return value;
}
