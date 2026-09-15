import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  openLocalDatabase,
  recordPendingOfflineOrder,
  pushOfflineOrderIntents,
  type LocalDatabase,
  type OfflineOrderIntent,
  type OfflineOrderIntentOutcome,
  type Scope
} from "../packages/offline-runtime/index";

const scope: Scope = { accountId: "account", storeId: "shop", deviceId: "device" };
const databases: LocalDatabase[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
async function database() {
  const db = await openLocalDatabase(new IDBFactory());
  databases.push(db);
  return db;
}
function intent(overrides: Partial<OfflineOrderIntent> = {}): OfflineOrderIntent {
  return {
    id: overrides.id ?? "intent-1",
    accountId: scope.accountId,
    storeId: scope.storeId,
    transport: overrides.transport ?? "ble",
    customerClaim: overrides.customerClaim ?? {
      type: "account",
      accountId: "buyer-account",
      displayName: "Buyer"
    },
    items: overrides.items ?? [{ productCloudId: "product-1", name: "Sugar 1kg", quantity: 2, quotedUnitPrice: 100 }],
    paymentMethod: null,
    paymentReference: null,
    note: null,
    receivedAtLocal: "2024-01-01T00:00:00.000Z",
    rawText: null,
    ...overrides
  };
}

describe("recordPendingOfflineOrder", () => {
  it("stages an intent locally without touching product rows", async () => {
    const db = await database();
    await recordPendingOfflineOrder(db, scope, intent());
    const state = await db.read(scope);
    expect(state.pendingOfflineOrders).toHaveLength(1);
    expect(state.pendingOfflineOrders?.[0]).toMatchObject({ status: "pending_sync", outcome: null });
    expect(state.rows).toEqual([]);
  });

  it("is idempotent on a repeated intent id", async () => {
    const db = await database();
    await recordPendingOfflineOrder(db, scope, intent());
    await recordPendingOfflineOrder(db, scope, intent());
    const state = await db.read(scope);
    expect(state.pendingOfflineOrders).toHaveLength(1);
  });

  it("rejects an intent with no real customer claim", async () => {
    const db = await database();
    await expect(
      recordPendingOfflineOrder(
        db,
        scope,
        // @ts-expect-error deliberately invalid claim for the test
        intent({ customerClaim: { type: "device", deviceId: "peer-device" } })
      )
    ).rejects.toThrow();
  });

  it("rejects an intent with zero items", async () => {
    const db = await database();
    await expect(recordPendingOfflineOrder(db, scope, intent({ items: [] }))).rejects.toThrow();
  });
});

describe("pushOfflineOrderIntents", () => {
  it("pushes only pending_sync intents and applies outcomes back locally", async () => {
    const db = await database();
    await recordPendingOfflineOrder(db, scope, intent({ id: "a" }));
    await recordPendingOfflineOrder(db, scope, intent({ id: "b" }));
    const pushed: OfflineOrderIntent[][] = [];
    await pushOfflineOrderIntents(db, scope, {
      pushOrderIntents: async (intents) => {
        pushed.push(intents);
        const outcomes: OfflineOrderIntentOutcome[] = intents.map((entry) => ({
          id: entry.id,
          status: entry.id === "a" ? "confirmed" : "rejected",
          invoiceId: entry.id === "a" ? "invoice-a" : null,
          confirmedItems: [],
          rejectedItems: [],
          message: ""
        }));
        return { outcomes };
      }
    });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
    const state = await db.read(scope);
    const byId = Object.fromEntries((state.pendingOfflineOrders ?? []).map((entry) => [entry.intent.id, entry]));
    expect(byId.a?.status).toBe("confirmed");
    expect(byId.a?.outcome?.invoiceId).toBe("invoice-a");
    expect(byId.b?.status).toBe("rejected");
    expect(byId.a?.syncedAt).toBeTruthy();
  });

  it("leaves already-synced intents alone on a later call", async () => {
    const db = await database();
    await recordPendingOfflineOrder(db, scope, intent({ id: "a" }));
    let calls = 0;
    await pushOfflineOrderIntents(db, scope, {
      pushOrderIntents: async (intents) => {
        calls++;
        return {
          outcomes: intents.map((entry) => ({
            id: entry.id,
            status: "confirmed",
            invoiceId: "invoice",
            confirmedItems: [],
            rejectedItems: [],
            message: ""
          }))
        };
      }
    });
    await pushOfflineOrderIntents(db, scope, {
      pushOrderIntents: async () => {
        calls++;
        return { outcomes: [] };
      }
    });
    expect(calls).toBe(1);
  });

  it("throws rather than silently dropping intents when the server returns the wrong count", async () => {
    const db = await database();
    await recordPendingOfflineOrder(db, scope, intent({ id: "a" }));
    await expect(
      pushOfflineOrderIntents(db, scope, {
        pushOrderIntents: async () => ({ outcomes: [] })
      })
    ).rejects.toThrow();
  });
});
