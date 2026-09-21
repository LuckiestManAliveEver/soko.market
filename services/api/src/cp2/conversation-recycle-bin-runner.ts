import type { Cp2Store } from "./store.js";
import { createIntervalRunner } from "./interval-runner.js";

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
  timeScheduledJob?: <R>(job: string, fn: () => Promise<R>) => Promise<R>;
}

export interface ConversationRecycleBinRunner {
  runNow: () => Promise<number | null>;
  stop: () => Promise<void>;
}

export function startConversationRecycleBinRunner(
  options: ConversationRecycleBinRunnerOptions
): ConversationRecycleBinRunner {
  return createIntervalRunner({
    job: "conversation_recycle_bin_purge",
    intervalMs: normalizeInterval(options.intervalMs),
    run: async () => options.store.purgeExpiredRecycleBinConversations(options.now?.() ?? new Date()),
    ...(options.runOnStart === undefined ? {} : { runOnStart: options.runOnStart }),
    ...(options.onResult === undefined ? {} : { onResult: options.onResult }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.timeScheduledJob === undefined ? {} : { timeScheduledJob: options.timeScheduledJob })
  });
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return defaultIntervalMs;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Conversation recycle bin runner interval must be a positive integer.");
  }
  return value;
}
