import type { AccountDeletionPurgeRunSummary, Cp2Store } from "./store.js";

const defaultIntervalMs = 24 * 60 * 60 * 1000;

export interface AccountDeletionRunnerOptions {
  store: Pick<Cp2Store, "purgeExpiredAccountDeletions" | "purgeExpiredShopDeletions">;
  intervalMs?: number;
  runOnStart?: boolean;
  now?: () => Date;
  onResult?: (result: DeletionPurgeRunSummary) => void;
  onError?: (error: unknown) => void;
}

export interface AccountDeletionRunner {
  runNow: () => Promise<DeletionPurgeRunSummary | null>;
  stop: () => Promise<void>;
}

export interface DeletionPurgeRunSummary {
  shopsPurged: number;
  accounts: AccountDeletionPurgeRunSummary;
}

export function startAccountDeletionRunner(
  options: AccountDeletionRunnerOptions
): AccountDeletionRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let inFlight: Promise<DeletionPurgeRunSummary | null> | null = null;

  const runNow = (): Promise<DeletionPurgeRunSummary | null> => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;

    inFlight = (async () => {
      try {
        const now = options.now?.() ?? new Date();
        const result: DeletionPurgeRunSummary = {
          shopsPurged: options.store.purgeExpiredShopDeletions(now),
          accounts: await options.store.purgeExpiredAccountDeletions(now)
        };
        options.onResult?.(result);
        return result;
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
    throw new Error("Account deletion runner interval must be a positive integer.");
  }
  return value;
}
