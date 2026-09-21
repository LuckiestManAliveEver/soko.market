import type { Cp2Store, MessageNotificationDeliveryRunSummary } from "./store.js";
import { createIntervalRunner } from "./interval-runner.js";

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
  timeScheduledJob?: <R>(job: string, fn: () => Promise<R>) => Promise<R>;
}): NotificationDeliveryRunner {
  return createIntervalRunner({
    job: "notification_delivery",
    intervalMs: normalizeInterval(options.intervalMs),
    run: () => options.store.deliverPendingMessageNotifications(),
    ...(options.runOnStart === undefined ? {} : { runOnStart: options.runOnStart }),
    ...(options.onResult === undefined ? {} : { onResult: options.onResult }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.timeScheduledJob === undefined ? {} : { timeScheduledJob: options.timeScheduledJob })
  });
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return defaultIntervalMs;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Notification delivery interval must be a positive integer.");
  }
  return value;
}
