import type { Cp2Store, MessageNotificationDeliveryRunSummary } from "./store.js";

const defaultIntervalMs = 60_000;

export interface NotificationDeliveryRunner {
  runNow: () => Promise<MessageNotificationDeliveryRunSummary | null>;
  stop: () => Promise<void>;
}

export function startNotificationDeliveryRunner(options: {
  store: Pick<Cp2Store, "deliverPendingMessageNotifications">;
  intervalMs?: number;
  runOnStart?: boolean;
  onResult?: (result: MessageNotificationDeliveryRunSummary) => void;
  onError?: (error: unknown) => void;
}): NotificationDeliveryRunner {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let inFlight: Promise<MessageNotificationDeliveryRunSummary | null> | null = null;

  const runNow = () => {
    if (stopped) return Promise.resolve(null);
    if (inFlight !== null) return inFlight;
    inFlight = options.store
      .deliverPendingMessageNotifications()
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
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Notification delivery interval must be a positive integer.");
  }
  return value;
}
