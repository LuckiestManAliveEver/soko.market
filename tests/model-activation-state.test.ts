import { describe, expect, it, vi } from "vitest";
import {
  ModelActivationCoordinator,
  withActivationTimeout
} from "../apps/web/src/model-activation-state";

describe("model activation request lifecycle", () => {
  it("deduplicates a double click for the same model", () => {
    const coordinator = new ModelActivationCoordinator();
    expect(coordinator.begin("model-a")).not.toBeNull();
    expect(coordinator.begin("model-a")).toBeNull();
  });

  it("aborts the old request and prevents its stale response from winning", () => {
    const coordinator = new ModelActivationCoordinator();
    const first = coordinator.begin("model-a")!;
    const second = coordinator.begin("model-b")!;

    expect(first.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it("times out unbounded work and clears its timer", async () => {
    vi.useFakeTimers();
    const result = withActivationTimeout(() => new Promise<never>(() => undefined), 1_000);
    const rejected = expect(result).rejects.toMatchObject({ code: "ACTIVATION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("propagates cancellation used by component unmount", async () => {
    const parent = new AbortController();
    const result = withActivationTimeout(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        }),
      10_000,
      parent.signal
    );
    parent.abort();
    await expect(result).rejects.toMatchObject({ code: "ACTIVATION_ABORTED" });
  });
});
