import type { Cp2Store } from "./store.js";

/**
 * Frees retired sokoIds once their post-rename cooldown elapses
 * (docs/architecture/soko-id-slug-system.md). Mirrors the existing runner pattern exactly
 * (services/api/src/cp2/notification-delivery-runner.ts) - a plain `setInterval`, no new
 * scheduler infrastructure, matching "check what exists before adding new infra."
 */
const defaultIntervalMs = 60 * 60_000; // hourly - a 30-day cooldown does not need minute-level polling
const defaultCooldownMs = 30 * 24 * 60 * 60_000; // 30 days, per the phase brief's proposed default

export interface SokoIdCooldownRunner {
  runNow: () => Promise<number | null>;
  stop: () => Promise<void>;
}

export function startSokoIdCooldownRunner(options: {
  store: Pick<Cp2Store, "releaseExpiredSokoIds">;
  intervalMs?: number;
  cooldownMs?: number;
  runOnStart?: boolean;
  onResult?: (releasedCount: number) => void;
  onError?: (error: unknown) => void;
}): SokoIdCooldownRunner {
  const intervalMs = normalizePositive(options.intervalMs, defaultIntervalMs, "interval");
  const cooldownMs = normalizePositive(options.cooldownMs, defaultCooldownMs, "cooldown");
  let stopped = false;
  let inFlight: Promise<number | null> | null = null;

  const runNow = () => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;
    inFlight = Promise.resolve()
      .then(() => options.store.releaseExpiredSokoIds({ cooldownMs }))
      .then((released) => {
        options.onResult?.(released);
        return released;
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

function normalizePositive(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`SokoId cooldown runner ${label} must be a positive integer.`);
  }
  return value;
}
