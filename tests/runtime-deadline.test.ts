import { afterEach, describe, expect, it, vi } from "vitest";
import { withRuntimeDeadline } from "../services/api/src/cp2/runtime-deadline";

afterEach(() => vi.useRealTimers());
describe("runtime readiness deadline", () => {
  it("aborts a hung probe with an explicit runtime reason before the browser timeout", async () => {
    vi.useFakeTimers();
    let probeSignal: AbortSignal | undefined;
    const pending = withRuntimeDeadline((signal) => {
      probeSignal = signal;
      return new Promise<void>(() => undefined);
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TARGET_ACTIVATION_TIMEOUT",
      statusCode: 503
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(probeSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans up a successful probe deadline", async () => {
    vi.useFakeTimers();
    expect(await withRuntimeDeadline(async () => "ready")).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });
});
