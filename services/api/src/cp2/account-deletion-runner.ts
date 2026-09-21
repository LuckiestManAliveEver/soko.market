import type { AccountDeletionPurgeRunSummary, Cp2Store } from "./store.js";
import { createIntervalRunner } from "./interval-runner.js";

const defaultIntervalMs = 24 * 60 * 60 * 1000;

export interface AccountDeletionRunnerOptions {
  store: Pick<Cp2Store, "purgeExpiredAccountDeletions" | "purgeExpiredShopDeletions">;
  intervalMs?: number;
  runOnStart?: boolean;
  now?: () => Date;
  onResult?: (result: DeletionPurgeRunSummary) => void;
  onError?: (error: unknown) => void;
  timeScheduledJob?: <R>(job: string, fn: () => Promise<R>) => Promise<R>;
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
  return createIntervalRunner({
    job: "account_deletion_purge",
    intervalMs: normalizeInterval(options.intervalMs),
    run: async () => {
      const now = options.now?.() ?? new Date();
      const result: DeletionPurgeRunSummary = {
        shopsPurged: options.store.purgeExpiredShopDeletions(now),
        accounts: await options.store.purgeExpiredAccountDeletions(now)
      };
      return result;
    },
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
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Account deletion runner interval must be a positive integer.");
  }
  return value;
}
