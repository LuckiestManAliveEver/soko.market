import { describe, expect, it } from "vitest";
import {
  allocateAutomatically,
  computePoolReadiness,
  nextCutoff,
  percentOfTarget,
  zonedWallTimeToUtc
} from "../packages/business-core/src";

const kg = (value: number) => BigInt(value) * 1000n;
const TARGET = kg(6000);

describe("A13 readiness", () => {
  it("with a NULL minimum", () => {
    expect(computePoolReadiness(TARGET - 1n, TARGET, null)).toBe("ACCUMULATING");
    expect(computePoolReadiness(TARGET, TARGET, null)).toBe("DISPATCH_READY");
    expect(computePoolReadiness(TARGET + 1n, TARGET, null)).toBe("DISPATCH_READY");
  });

  it("with a configured minimum", () => {
    const MIN = kg(4000);
    expect(computePoolReadiness(MIN - 1n, TARGET, MIN)).toBe("ACCUMULATING");
    expect(computePoolReadiness(MIN, TARGET, MIN)).toBe("DISPATCHABLE");
    expect(computePoolReadiness(TARGET - 1n, TARGET, MIN)).toBe("DISPATCHABLE");
    expect(computePoolReadiness(TARGET, TARGET, MIN)).toBe("DISPATCH_READY");
  });

  it("computes percent filled exactly in integer space", () => {
    expect(percentOfTarget(kg(3000), TARGET)).toBe(50);
    expect(percentOfTarget(TARGET - 1n, TARGET)).toBe(99.99);
    expect(percentOfTarget(kg(9000), TARGET)).toBe(150);
  });
});

describe("A21 automatic allocation", () => {
  const order = (id: string, weightKg: number, confirmedAt: string) => ({
    id,
    weightGrams: kg(weightKg),
    confirmedAt
  });

  it("5,900 kg + 900 kg into 7,000 kg: both allocated", () => {
    const result = allocateAutomatically(
      [order("a", 5900, "2026-09-01T08:00:00Z"), order("b", 900, "2026-09-01T09:00:00Z")],
      kg(7000)
    );
    expect(result.allocated.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.totalWeightGrams).toBe(kg(6800));
  });

  it("6,500 kg + 900 kg into 7,000 kg: the second stays pooled", () => {
    const result = allocateAutomatically(
      [order("a", 6500, "2026-09-01T08:00:00Z"), order("b", 900, "2026-09-01T09:00:00Z")],
      kg(7000)
    );
    expect(result.allocated.map((entry) => entry.id)).toEqual(["a"]);
    expect(result.skipped.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("skips an older order that does not fit and allocates a newer one that does", () => {
    const result = allocateAutomatically(
      [
        order("base", 6300, "2026-09-01T07:00:00Z"),
        order("old-900", 900, "2026-09-01T08:00:00Z"),
        order("new-400", 400, "2026-09-01T09:00:00Z")
      ],
      kg(7000)
    );
    expect(result.allocated.map((entry) => entry.id)).toEqual(["base", "new-400"]);
    expect(result.skipped.map((entry) => entry.id)).toEqual(["old-900"]);
  });

  it("flags an order heavier than the vehicle as REQUIRES_PLANNING", () => {
    const result = allocateAutomatically([order("huge", 7500, "2026-09-01T08:00:00Z")], kg(7000));
    expect(result.allocated).toEqual([]);
    expect(result.requiresPlanning.map((entry) => entry.id)).toEqual(["huge"]);
  });

  it("orders by confirmation time, then id", () => {
    const result = allocateAutomatically(
      [
        order("b", 1, "2026-09-01T08:00:00Z"),
        order("a", 1, "2026-09-01T08:00:00Z"),
        order("c", 1, "2026-09-01T07:00:00Z")
      ],
      kg(7000)
    );
    expect(result.allocated.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });
});

describe("A11 cutoff in the business timezone", () => {
  it("before, exactly at and after an 18:00 Nairobi cutoff", () => {
    // Nairobi is UTC+3 with no DST: 18:00 local = 15:00Z.
    expect(nextCutoff(new Date("2026-09-23T14:00:00Z"), "Africa/Nairobi", "18:00")).toEqual({
      at: new Date("2026-09-23T15:00:00Z"),
      millisecondsUntil: 3_600_000
    });
    expect(nextCutoff(new Date("2026-09-23T15:00:00Z"), "Africa/Nairobi", "18:00").at).toEqual(
      new Date("2026-09-24T15:00:00Z")
    );
    expect(nextCutoff(new Date("2026-09-23T15:00:01Z"), "Africa/Nairobi", "18:00").at).toEqual(
      new Date("2026-09-24T15:00:00Z")
    );
  });

  it("uses the business's own local date, not UTC's", () => {
    // 22:30Z on the 23rd is already 01:30 on the 24th in Nairobi.
    expect(nextCutoff(new Date("2026-09-23T22:30:00Z"), "Africa/Nairobi", "18:00").at).toEqual(
      new Date("2026-09-24T15:00:00Z")
    );
  });

  it("works in a non-Nairobi timezone", () => {
    // Lagos is UTC+1.
    expect(nextCutoff(new Date("2026-09-23T10:00:00Z"), "Africa/Lagos", "18:00").at).toEqual(
      new Date("2026-09-23T17:00:00Z")
    );
  });

  it("handles DST transitions (America/New_York)", () => {
    // Summer (EDT, UTC-4) vs winter (EST, UTC-5).
    expect(nextCutoff(new Date("2026-07-01T12:00:00Z"), "America/New_York", "18:00").at).toEqual(
      new Date("2026-07-01T22:00:00Z")
    );
    expect(nextCutoff(new Date("2026-12-01T12:00:00Z"), "America/New_York", "18:00").at).toEqual(
      new Date("2026-12-01T23:00:00Z")
    );
    // The day clocks spring forward (2026-03-08): 18:00 is EDT.
    expect(nextCutoff(new Date("2026-03-08T12:00:00Z"), "America/New_York", "18:00").at).toEqual(
      new Date("2026-03-08T22:00:00Z")
    );
    // A cutoff inside the spring-forward gap (02:30 does not exist) shifts forward by the gap.
    expect(
      zonedWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York")
    ).toEqual(new Date("2026-03-08T07:30:00Z"));
    // In the fall-back overlap (01:30 happens twice), the earlier instant (EDT).
    expect(
      zonedWallTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York")
    ).toEqual(new Date("2026-11-01T05:30:00Z"));
  });
});
