import type { AccountDeletionPurgeRunSummary, Cp2Store } from "./store.js";

const defaultIntervalMs = 24 * 60 * 60 * 1000;

export interface AccountDeletionRunnerOptions {
  store: Pick<Cp2Store, "purgeExpiredAccountDeletions">;
  intervalMs?: number;
  runOnStart?: boolean;
  now?: () => Date;
  onResult?: (result: AccountDeletionPurgeRunSummary) => void;
  onError?: (error: unknown) => void;
}

export interface AccountDeletionRunner {
  runNow: () => Promise<AccountDeletionPurgeRunSummary | null>;
  stop: () => Promise<void>;
}

export function startAccountDeletionRunner(
  options: AccountDeletionRunnerOptions
): AccountDeletionRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let inFlight: Promise<AccountDeletionPurgeRunSummary | null> | null = null;

  const runNow = (): Promise<AccountDeletionPurgeRunSummary | null> => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;

    inFlight = (async () => {
      try {
        const result = await options.store.purgeExpiredAccountDeletions(
          options.now?.() ?? new Date()
        );
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
