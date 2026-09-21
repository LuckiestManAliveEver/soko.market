import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry.js";

describe("retryWithBackoff", () => {
  it("returns the first successful attempt without sleeping", async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = vi.fn(async () => "ok");
    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 100, sleep })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries up to maxAttempts then throws the last error", async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });
    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 100, sleep })
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("succeeds on a later attempt after transient failures", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    });
    await expect(
      retryWithBackoff(fn, { maxAttempts: 5, initialDelayMs: 10, maxDelayMs: 100, sleep })
    ).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failure classified as non-retryable", async () => {
    const sleep = vi.fn(async () => undefined);
    const fn = vi.fn(async () => {
      throw new Error("auth failed");
    });
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        sleep,
        isRetryable: (error) => !(error instanceof Error && error.message === "auth failed")
      })
    ).rejects.toThrow("auth failed");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never sleeps longer than maxDelayMs, capping the exponential growth", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const fn = vi.fn(async () => {
      throw new Error("fails");
    });
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 6,
        initialDelayMs: 100,
        maxDelayMs: 300,
        jitterRatio: 0,
        sleep
      })
    ).rejects.toThrow();
    // attempts: 100, 200, 300(capped from 400), 300(capped from 800), 300(capped from 1600)
    expect(delays).toEqual([100, 200, 300, 300, 300]);
  });

  it("draws jitter from a deterministic injected random source", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const fn = vi.fn(async () => {
      throw new Error("fails");
    });
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        jitterRatio: 1,
        random: () => 0.5,
        sleep
      })
    ).rejects.toThrow();
    // full jitter: delay = cappedBase * random() = 100 * 0.5 = 50
    expect(delays).toEqual([50]);
  });
});
