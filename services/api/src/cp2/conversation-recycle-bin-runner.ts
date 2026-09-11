import type { Cp2Store } from "./store.js";

// Once a day is plenty for a 14-day retention window - see RECYCLE_BIN_RETENTION_MS in
// domains/messaging/store.ts. Mirrors account-deletion-runner.ts's interval/shape.
const defaultIntervalMs = 24 * 60 * 60 * 1000;

export interface ConversationRecycleBinRunnerOptions {
  store: Pick<Cp2Store, "purgeExpiredRecycleBinConversations">;
  intervalMs?: number;
  runOnStart?: boolean;
  now?: () => Date;
  onResult?: (purged: number) => void;
  onError?: (error: unknown) => void;
}

export interface ConversationRecycleBinRunner {
  runNow: () => Promise<number | null>;
  stop: () => Promise<void>;
}

export function startConversationRecycleBinRunner(
  options: ConversationRecycleBinRunnerOptions
): ConversationRecycleBinRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let inFlight: Promise<number | null> | null = null;

  const runNow = (): Promise<number | null> => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;

    inFlight = (async () => {
      try {
        const now = options.now?.() ?? new Date();
        const purged = options.store.purgeExpiredRecycleBinConversations(now);
        options.onResult?.(purged);
        return purged;
      } catch (error) {
        options.onError?.(error);
        return null;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  timer.unref();

  if (options.runOnStart !== false) {
    void runNow();
  }

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
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Conversation recycle bin runner interval must be a positive integer.");
  }
  return value;
}
