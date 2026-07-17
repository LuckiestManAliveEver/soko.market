import { describe, expect, it, vi } from "vitest";
import { startNotificationDeliveryRunner } from "../services/api/src/cp2/notification-delivery-runner";

describe("notification delivery runner", () => {
  it("runs durable deliveries on demand and stops cleanly", async () => {
    const summary = { checked: 2, sent: 1, failed: 1, deadLettered: 0 };
    const deliverPendingMessageNotifications = vi.fn().mockResolvedValue(summary);
    const onResult = vi.fn();
    const runner = startNotificationDeliveryRunner({
      store: { deliverPendingMessageNotifications },
      intervalMs: 60_000,
      runOnStart: false,
      onResult
    });

    await expect(runner.runNow()).resolves.toEqual(summary);
    expect(deliverPendingMessageNotifications).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(summary);

    await runner.stop();
    await expect(runner.runNow()).resolves.toBeNull();
  });

  it("contains provider failures so later runs can retry", async () => {
    const error = new Error("provider unavailable");
    const deliverPendingMessageNotifications = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const runner = startNotificationDeliveryRunner({
      store: { deliverPendingMessageNotifications },
      intervalMs: 60_000,
      runOnStart: false,
      onError
    });

    await expect(runner.runNow()).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(error);
    await runner.stop();
  });
});
