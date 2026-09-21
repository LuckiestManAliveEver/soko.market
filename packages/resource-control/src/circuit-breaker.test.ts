import { describe, expect, it, vi } from "vitest";
import {
  type CircuitBreakerEvent,
  CircuitOpenError,
  createCircuitBreaker
} from "./circuit-breaker.js";

describe("createCircuitBreaker", () => {
  it("rejects a non-positive failureThreshold at construction", () => {
    expect(() =>
      createCircuitBreaker({ name: "x", failureThreshold: 0, resetTimeoutMs: 1000 })
    ).toThrow(/failureThreshold/);
  });

  it("rejects a non-positive resetTimeoutMs at construction", () => {
    expect(() =>
      createCircuitBreaker({ name: "x", failureThreshold: 1, resetTimeoutMs: 0 })
    ).toThrow(/resetTimeoutMs/);
  });

  it("stays closed and passes results through while calls succeed", async () => {
    const breaker = createCircuitBreaker({ name: "x", failureThreshold: 3, resetTimeoutMs: 1000 });
    await expect(breaker.run(async () => 42)).resolves.toBe(42);
    expect(breaker.state()).toBe("closed");
  });

  it("opens after failureThreshold consecutive failures and fails fast", async () => {
    const events: CircuitBreakerEvent[] = [];
    const breaker = createCircuitBreaker({
      name: "inference",
      failureThreshold: 2,
      resetTimeoutMs: 60_000,
      onEvent: (event) => events.push(event)
    });
    const failing = () => Promise.reject(new Error("dependency down"));

    await expect(breaker.run(failing)).rejects.toThrow("dependency down");
    expect(breaker.state()).toBe("closed");
    await expect(breaker.run(failing)).rejects.toThrow("dependency down");
    expect(breaker.state()).toBe("open");

    const calls = vi.fn(failing);
    await expect(breaker.run(calls)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "opened", name: "inference", consecutiveFailures: 2 })
    );
  });

  it("does not count a mid-window success toward the failure threshold", async () => {
    const breaker = createCircuitBreaker({ name: "x", failureThreshold: 2, resetTimeoutMs: 1000 });
    await expect(breaker.run(() => Promise.reject(new Error("1")))).rejects.toThrow();
    await expect(breaker.run(async () => "ok")).resolves.toBe("ok");
    expect(breaker.state()).toBe("closed");
    await expect(breaker.run(() => Promise.reject(new Error("2")))).rejects.toThrow();
    expect(breaker.state()).toBe("closed");
  });

  it("moves to half_open after resetTimeoutMs and closes again on a successful probe", async () => {
    vi.useFakeTimers();
    try {
      const breaker = createCircuitBreaker({
        name: "x",
        failureThreshold: 1,
        resetTimeoutMs: 1000
      });
      await expect(breaker.run(() => Promise.reject(new Error("down")))).rejects.toThrow();
      expect(breaker.state()).toBe("open");

      await vi.advanceTimersByTimeAsync(1001);
      expect(breaker.state()).toBe("half_open");

      await expect(breaker.run(async () => "recovered")).resolves.toBe("recovered");
      expect(breaker.state()).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reopens immediately when the half_open probe itself fails", async () => {
    vi.useFakeTimers();
    try {
      const breaker = createCircuitBreaker({
        name: "x",
        failureThreshold: 1,
        resetTimeoutMs: 1000
      });
      await expect(breaker.run(() => Promise.reject(new Error("down")))).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(1001);
      expect(breaker.state()).toBe("half_open");

      await expect(breaker.run(() => Promise.reject(new Error("still down")))).rejects.toThrow(
        "still down"
      );
      expect(breaker.state()).toBe("open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("limits concurrent half_open probes to halfOpenMaxAttempts", async () => {
    vi.useFakeTimers();
    try {
      const breaker = createCircuitBreaker({
        name: "x",
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxAttempts: 1
      });
      await expect(breaker.run(() => Promise.reject(new Error("down")))).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(1001);

      let releaseProbe!: () => void;
      const probe = new Promise<string>((resolve) => {
        releaseProbe = () => resolve("ok");
      });
      const first = breaker.run(() => probe);
      await Promise.resolve();
      await expect(breaker.run(async () => "second")).rejects.toBeInstanceOf(CircuitOpenError);
      releaseProbe();
      await expect(first).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
