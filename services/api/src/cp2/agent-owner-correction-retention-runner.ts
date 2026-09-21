import type { Cp2Store } from "./store.js";
import { createIntervalRunner } from "./interval-runner.js";

// Retention windows are configured in days (AgentMemoryPolicy.retentionDays), so a daily sweep is
// frequent enough that no correction outlives its business's configured window by more than a day.
// Mirrors conversation-recycle-bin-runner.ts's interval/shape.
const defaultIntervalMs = 24 * 60 * 60 * 1000;

export interface AgentOwnerCorrectionRetentionRunnerOptions {
  store: Pick<Cp2Store, "purgeExpiredAgentOwnerCorrections">;
  intervalMs?: number;
  runOnStart?: boolean;
  now?: () => Date;
  onResult?: (disabled: number) => void;
  onError?: (error: unknown) => void;
  timeScheduledJob?: <R>(job: string, fn: () => Promise<R>) => Promise<R>;
}

export interface AgentOwnerCorrectionRetentionRunner {
  runNow: () => Promise<number | null>;
  stop: () => Promise<void>;
}

export function startAgentOwnerCorrectionRetentionRunner(
  options: AgentOwnerCorrectionRetentionRunnerOptions
): AgentOwnerCorrectionRetentionRunner {
  return createIntervalRunner({
    job: "agent_owner_correction_retention",
    intervalMs: normalizeInterval(options.intervalMs),
    run: async () => options.store.purgeExpiredAgentOwnerCorrections(options.now?.() ?? new Date()),
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
    throw new Error("Agent owner correction retention runner interval must be a positive integer.");
  }
  return value;
}
