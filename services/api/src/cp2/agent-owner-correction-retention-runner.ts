import type { Cp2Store } from "./store.js";

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
}

export interface AgentOwnerCorrectionRetentionRunner {
  runNow: () => Promise<number | null>;
  stop: () => Promise<void>;
}

export function startAgentOwnerCorrectionRetentionRunner(
  options: AgentOwnerCorrectionRetentionRunnerOptions
): AgentOwnerCorrectionRetentionRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let inFlight: Promise<number | null> | null = null;

  const runNow = (): Promise<number | null> => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;

    inFlight = (async () => {
      try {
        const now = options.now?.() ?? new Date();
        const disabled = options.store.purgeExpiredAgentOwnerCorrections(now);
        options.onResult?.(disabled);
        return disabled;
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
    throw new Error("Agent owner correction retention runner interval must be a positive integer.");
  }
  return value;
}
