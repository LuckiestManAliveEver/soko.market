import { describe, expect, it } from "vitest";
import type { Cp2Snapshot } from "../services/api/src/cp2/store";
import {
  baselineAfterFailedSave,
  receiptLineItemsToRewrite,
  recordsChangedSince
} from "../services/api/src/cp2/postgres-store";

describe("recordsChangedSince", () => {
  const a = { id: "a", name: "Maize", quantity: 1 };
  const b = { id: "b", name: "Beans", quantity: 2 };

  it("treats every record as changed when there is no previous save", () => {
    expect(recordsChangedSince([a, b], undefined)).toEqual([a, b]);
    expect(recordsChangedSince(undefined, undefined)).toEqual([]);
  });

  it("skips records identical to the last saved snapshot", () => {
    expect(recordsChangedSince([a, b], [structuredClone(a), structuredClone(b)])).toEqual([]);
  });

  it("returns added and modified records but never unchanged ones", () => {
    const modified = { ...b, quantity: 3 };
    const added = { id: "c", name: "Rice", quantity: 1 };
    expect(recordsChangedSince([a, modified, added], [a, b])).toEqual([modified, added]);
  });

  it("counts a newly added field as a change", () => {
    expect(recordsChangedSince<Record<string, unknown>>([{ ...a, revokedAt: null }], [a])).toEqual([
      { ...a, revokedAt: null }
    ]);
  });
});

describe("receiptLineItemsToRewrite", () => {
  const item = (id: string, receiptId: string, quantity: number) => ({
    id,
    receiptId,
    name: id,
    quantity,
    unitPrice: 10,
    total: 10 * quantity
  });
  const snapshotWith = (items: ReturnType<typeof item>[]) =>
    ({ receiptLineItems: items }) as unknown as Cp2Snapshot;

  it("rewrites every current item of a receipt with any changed item, and nothing else", () => {
    const previous = snapshotWith([item("1", "r1", 1), item("2", "r1", 1), item("3", "r2", 1)]);
    const current = snapshotWith([item("1", "r1", 5), item("2", "r1", 1), item("3", "r2", 1)]);
    // replaceReceiptLineItems deletes all items of r1 before re-inserting, so the unchanged
    // sibling "2" must be included or it would be lost.
    expect(receiptLineItemsToRewrite(current, previous).map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("writes nothing when no line item changed", () => {
    const items = [item("1", "r1", 1), item("2", "r2", 1)];
    expect(receiptLineItemsToRewrite(snapshotWith(items), snapshotWith(items))).toEqual([]);
  });

  it("writes all items on the first save", () => {
    const items = [item("1", "r1", 1), item("2", "r2", 1)];
    expect(receiptLineItemsToRewrite(snapshotWith(items), undefined)).toHaveLength(2);
  });
});

describe("store lock predicate", () => {
  it("is identical in the API and in scripts/store-lock-lib.mjs", async () => {
    const { storeLockPredicate } = await import("../services/api/src/cp2/postgres-store");
    const script = (await import("../services/api/scripts/store-lock-lib.mjs")) as {
      storeLockPredicate: string;
    };
    const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
    expect(normalize(storeLockPredicate)).toBe(normalize(script.storeLockPredicate));
  });
});

describe("baselineAfterFailedSave", () => {
  const snapshot = (records: Record<string, unknown>) => records as unknown as Cp2Snapshot;

  it("keeps only records the failed attempt left unchanged and forces their delete check", () => {
    const kept = { id: "a", name: "Same" };
    const before = { id: "b", name: "Before" };
    const deleted = { id: "c", name: "Deleted" };
    const { baseline, forcedRemovalChecks } = baselineAfterFailedSave(
      snapshot({ suppliers: [kept, before, deleted], products: [{ id: "p" }] }),
      snapshot({ suppliers: [kept, { id: "b", name: "After" }], products: [{ id: "p" }] })
    );
    expect(baseline.suppliers).toEqual([kept]);
    expect(baseline.products).toEqual([{ id: "p" }]);
    expect([...forcedRemovalChecks]).toEqual(["suppliers"]);
  });

  it("forces the delete check for an attempt that only added records", () => {
    const { baseline, forcedRemovalChecks } = baselineAfterFailedSave(
      snapshot({ suppliers: [{ id: "a" }] }),
      snapshot({ suppliers: [{ id: "a" }, { id: "added" }] })
    );
    expect(baseline.suppliers).toEqual([{ id: "a" }]);
    expect([...forcedRemovalChecks]).toEqual(["suppliers"]);
  });

  it("leaves an untouched collection alone", () => {
    const { forcedRemovalChecks } = baselineAfterFailedSave(
      snapshot({ suppliers: [{ id: "a" }] }),
      snapshot({ suppliers: [{ id: "a" }] })
    );
    expect(forcedRemovalChecks.size).toBe(0);
  });

  it("only touches the requested keys", () => {
    const { baseline, forcedRemovalChecks } = baselineAfterFailedSave(
      snapshot({ suppliers: [{ id: "a" }], syncChanges: [{ accountId: "x", sequence: 1 }] }),
      snapshot({ suppliers: [], syncChanges: [] }),
      ["syncChanges"]
    );
    expect(baseline.suppliers).toEqual([{ id: "a" }]);
    expect(baseline.syncChanges).toEqual([]);
    expect([...forcedRemovalChecks]).toEqual(["syncChanges"]);
  });
});
