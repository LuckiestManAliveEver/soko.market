import { describe, expect, it, vi } from "vitest";
import { type BulkheadEvent, BulkheadRejectedError, createBulkhead } from "./bulkhead.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createBulkhead", () => {
  it("rejects a non-positive maxConcurrency at construction", () => {
    expect(() =>
      createBulkhead({ name: "x", workloadClass: "background", maxConcurrency: 0, maxQueue: 0 })
    ).toThrow(/maxConcurrency/);
  });

  it("rejects a negative maxQueue at construction", () => {
    expect(() =>
      createBulkhead({ name: "x", workloadClass: "background", maxConcurrency: 1, maxQueue: -1 })
    ).toThrow(/maxQueue/);
  });

  it("runs up to maxConcurrency operations concurrently", async () => {
    const bulkhead = createBulkhead({
      name: "x",
      workloadClass: "important",
      maxConcurrency: 2,
      maxQueue: 5
    });
    const gate1 = deferred<void>();
    const gate2 = deferred<void>();
    const p1 = bulkhead.run(async () => {
      await gate1.promise;
      return "one";
    });
    const p2 = bulkhead.run(async () => {
      await gate2.promise;
      return "two";
    });
    expect(bulkhead.stats().active).toBe(2);
    gate1.resolve();
    gate2.resolve();
    await expect(p1).resolves.toBe("one");
    await expect(p2).resolves.toBe("two");
    expect(bulkhead.stats().active).toBe(0);
  });

  it("queues an operation beyond maxConcurrency and runs it once a slot frees", async () => {
    const bulkhead = createBulkhead({
      name: "x",
      workloadClass: "important",
      maxConcurrency: 1,
      maxQueue: 1
    });
    const gate1 = deferred<void>();
    const order: string[] = [];
    const p1 = bulkhead.run(async () => {
      order.push("start-1");
      await gate1.promise;
      order.push("end-1");
    });
    // Give the first run a tick to actually acquire its slot.
    await Promise.resolve();
    const p2 = bulkhead.run(async () => {
      order.push("start-2");
    });
    await Promise.resolve();
    expect(bulkhead.stats()).toMatchObject({ active: 1, queued: 1 });
    gate1.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["start-1", "end-1", "start-2"]);
  });

  it("rejects with BulkheadRejectedError('queue_full') once the queue is also saturated", async () => {
    const bulkhead = createBulkhead({
      name: "cap",
      workloadClass: "background",
      maxConcurrency: 1,
      maxQueue: 1
    });
    const gate = deferred<void>();
    void bulkhead.run(() => gate.promise); // holds the one concurrency slot
    await Promise.resolve();
    void bulkhead.run(() => gate.promise).catch(() => undefined); // fills the one queue slot
    await Promise.resolve();

    await expect(bulkhead.run(async () => "never")).rejects.toBeInstanceOf(BulkheadRejectedError);
    gate.resolve();
  });

  it("releases the slot even when the operation throws", async () => {
    const bulkhead = createBulkhead({
      name: "x",
      workloadClass: "important",
      maxConcurrency: 1,
      maxQueue: 0
    });
    await expect(
      bulkhead.run(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(bulkhead.stats().active).toBe(0);
    await expect(bulkhead.run(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects a queued operation that waits past queueTimeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const bulkhead = createBulkhead({
        name: "x",
        workloadClass: "background",
        maxConcurrency: 1,
        maxQueue: 1,
        queueTimeoutMs: 50
      });
      const gate = deferred<void>();
      void bulkhead.run(() => gate.promise);
      await vi.advanceTimersByTimeAsync(0);

      const queuedResult = bulkhead.run(async () => "should not run");
      const assertion = expect(queuedResult).rejects.toBeInstanceOf(BulkheadRejectedError);
      await vi.advanceTimersByTimeAsync(51);
      await assertion;
      gate.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits capacity_reached and operation_rejected events with the workload class", async () => {
    const events: BulkheadEvent[] = [];
    const bulkhead = createBulkhead({
      name: "ocr",
      workloadClass: "background",
      maxConcurrency: 1,
      maxQueue: 0,
      onEvent: (event) => events.push(event)
    });
    const gate = deferred<void>();
    void bulkhead.run(() => gate.promise);
    await Promise.resolve();

    await expect(bulkhead.run(async () => "x")).rejects.toBeInstanceOf(BulkheadRejectedError);
    gate.resolve();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "capacity_reached",
        name: "ocr",
        workloadClass: "background"
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "operation_rejected",
        name: "ocr",
        reason: "queue_full",
        workloadClass: "background"
      })
    );
  });
});
