import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  openLocalDatabase,
  LocalProvider,
  SyncClient,
  installOfflineRuntime,
  pinCurrentRuntime,
  swapPinnedRuntime,
  getActivePin,
  resolveConflict,
  executeProviderCall,
  type LocalDatabase,
  type Scope,
  type RuntimeBinding,
  type Operation,
  type Entity,
  type InstallSnapshot,
  type SokoProvider
} from "../packages/offline-runtime/index";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

const scope: Scope = { accountId: "account", storeId: "shop", deviceId: "device" };
const databases: LocalDatabase[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.unstubAllEnvs();
});
async function database() {
  const db = await openLocalDatabase(new IDBFactory());
  databases.push(db);
  return db;
}
async function install(
  db: LocalDatabase,
  target = scope,
  collections: InstallSnapshot["collections"] = {}
) {
  await installOfflineRuntime({
    db,
    scope: target,
    businessDataOnly: true,
    binding: null,
    estimate: async () => ({ quota: 2 ** 30, usage: 0 }),
    snapshot: async () => ({
      accountId: target.accountId,
      storeId: target.storeId,
      cursor: "0",
      collections
    }),
    progress: () => undefined
  });
}
const binding: RuntimeBinding = {
  agentId: "agent-v1",
  agentVersion: "1.0",
  harnessVersion: "1.0",
  modelId: "model",
  modelVersion: "sha256:model-1",
  artifacts: [{ url: "https://example.test/model", sha256: "a".repeat(64), bytes: 10 }]
};

describe("Offline runtime local transactions and installation", () => {
  it("rolls back both the operation and entity on failure and allocates ordered sequences across concurrent writes", async () => {
    const db = await database();
    await install(db);
    const provider = new LocalProvider(db, scope);
    await expect(
      provider.call("catalogue.update", { id: "missing", body: { name: "Rice" } })
    ).rejects.toThrow("snapshot");
    expect((await db.read(scope)).operations).toHaveLength(0);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        provider.call("catalogue.create", { body: { name: `Product ${index}`, quantity: index } })
      )
    );
    const state = await db.read(scope);
    expect(state.operations.map((op) => op.localSeq)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
    expect(state.rows.every((row) => row.dirty && row.cloud_id === null)).toBe(true);
    expect((await db.read({ ...scope, accountId: "another" })).rows).toEqual([]);
  });
  it("blocks low or unknown storage and unsupported AI without activating a partial install", async () => {
    const db = await database();
    const snapshot = vi.fn();
    const input = { db, scope, businessDataOnly: true, binding: null, snapshot, progress: vi.fn() };
    await expect(
      installOfflineRuntime({ ...input, estimate: async () => ({ quota: 100, usage: 0 }) })
    ).rejects.toThrow("not enough space");
    await expect(installOfflineRuntime({ ...input, estimate: async () => ({}) })).rejects.toThrow(
      "could not be checked"
    );
    await expect(
      installOfflineRuntime({
        ...input,
        businessDataOnly: false,
        estimate: async () => ({ quota: 2 ** 30, usage: 0 })
      })
    ).rejects.toThrow("no compatible local AI");
    expect(snapshot).not.toHaveBeenCalled();
    expect((await db.read(scope)).offlineModeActive).toBe(false);
  });
  it("keeps the exact pinned runtime through default changes, reconnects and hostile business pull events", async () => {
    const db = await database();
    await install(db);
    await pinCurrentRuntime(db, scope, async () => binding);
    const changed = { ...binding, modelId: "new-model", modelVersion: "v2" };
    await pinCurrentRuntime(db, scope, async () => changed);
    const infer = vi.fn(async (pin) => pin.modelId);
    const provider = new LocalProvider(db, scope, infer);
    expect(await provider.call("agent.infer", {})).toBe("model");
    const sync = new SyncClient(db, scope, {
      push: vi.fn(),
      pull: async () => ({
        accountId: scope.accountId,
        storeId: scope.storeId,
        fromCursor: "0",
        newCursor: "1",
        hasMore: false,
        changes: [
          {
            id: "remote-pin",
            businessId: scope.storeId,
            sequence: 1,
            collection: "device_runtime_pins" as never,
            entityId: "pin",
            entity: { id: "pin", modelId: "malicious" }
          }
        ]
      })
    });
    await sync.pull();
    expect((await getActivePin(db, scope))?.modelId).toBe("model");
    await swapPinnedRuntime(db, scope, changed, async () => undefined);
    expect(await provider.call("agent.infer", {})).toBe("new-model");
    expect((await getActivePin(db, scope))?.explicitSwap).toBe(true);
  });
  it("requires deliberate offline consent and never retries ambiguous cloud mutations locally", async () => {
    const local: SokoProvider = {
      name: "local",
      supports: () => true,
      isAvailable: async () => true,
      call: vi.fn()
    };
    const cloud: SokoProvider = {
      name: "cloud",
      supports: () => true,
      isAvailable: async () => true,
      call: async () => {
        throw new TypeError("network failed after commit");
      }
    };
    await expect(
      executeProviderCall("catalogue.create", {}, [cloud, local], {
        online: false,
        offlineModeActive: false,
        localAuthorized: true
      })
    ).rejects.toThrow("unavailable offline");
    await expect(
      executeProviderCall("catalogue.create", {}, [cloud, local], {
        online: true,
        offlineModeActive: false,
        localAuthorized: true
      })
    ).rejects.toThrow("after commit");
    expect(local.call).not.toHaveBeenCalled();
    const db = await database();
    await install(db);
    expect(
      await executeProviderCall("catalogue.list", {}, [new LocalProvider(db, scope)], {
        online: false,
        offlineModeActive: true,
        localAuthorized: true
      })
    ).toEqual([]);
  });
});

describe("Offline runtime API integration", () => {
  it("pushes idempotently, persists receipts across restoration, maps IDs and pulls online changes", async () => {
    const fixture = await serverFixture();
    try {
      const db = await database();
      await install(db, fixture.scope);
      const local = new LocalProvider(db, fixture.scope);
      const created = await local.call<Entity>("catalogue.create", {
        body: { name: "Rice", quantity: 10 }
      });
      await local.call("catalogue.update", {
        id: created.id,
        body: { name: "Brown rice", quantity: 9 }
      });
      const original = structuredClone((await db.read(fixture.scope)).operations[0]!);
      const sync = new SyncClient(db, fixture.scope, fixture.transport);
      await sync.sync();
      expect((await db.read(fixture.scope)).operations.map((op) => op.syncStatus)).toEqual([
        "ACKED",
        "ACKED"
      ]);
      const products = await fixture.request(
        "GET",
        `/businesses/${fixture.scope.storeId}/products`
      );
      expect(products.json()).toMatchObject([{ name: "Brown rice", quantity: 9 }]);
      await fixture.transport.push([original]);
      expect(
        (await fixture.request("GET", `/businesses/${fixture.scope.storeId}/products`)).json()
      ).toHaveLength(1);
      const restored = createCp2Store();
      restored.hydrateSnapshot(fixture.store.snapshot());
      expect(restored.pushOfflineOperation(fixture.sessionId, original).status).toBe("ACKED");
      expect(
        restored.listProducts({ sessionId: fixture.sessionId, businessId: fixture.scope.storeId })
      ).toHaveLength(1);
      const productId = products.json()[0].id;
      await fixture.request("PATCH", `/businesses/${fixture.scope.storeId}/products/${productId}`, {
        name: "Online rice",
        quantity: 9
      });
      await sync.pull();
      expect(await local.call("catalogue.list", {})).toMatchObject([
        { id: productId, name: "Online rice" }
      ]);
    } finally {
      await fixture.app.close();
    }
  });
  it("surfaces a two-device stock conflict and supports explicit resolution", async () => {
    const fixture = await serverFixture();
    try {
      await fixture.request("POST", `/businesses/${fixture.scope.storeId}/products`, {
        name: "Rice",
        quantity: 10
      });
      const snapshot = fixture.store.getOfflineRuntimeSnapshot(
        fixture.sessionId,
        fixture.scope.storeId
      );
      const second = { ...fixture.scope, deviceId: "second-device" };
      const firstDb = await database();
      const secondDb = await database();
      await install(firstDb, fixture.scope, snapshot.collections);
      await install(secondDb, second, snapshot.collections);
      const id = snapshot.collections.products[0]!.id;
      await new LocalProvider(firstDb, fixture.scope).call("inventory.adjust", {
        id,
        body: { quantityAfter: 8 }
      });
      await new LocalProvider(secondDb, second).call("inventory.adjust", {
        id,
        body: { quantityAfter: 6 }
      });
      await new SyncClient(firstDb, fixture.scope, fixture.transport).sync();
      const secondSync = new SyncClient(secondDb, second, fixture.transportFor(second));
      await secondSync.sync();
      const state = await secondDb.read(second);
      expect(state.operations[0]?.syncStatus).toBe("CONFLICT");
      expect(state.rows[0]?.payload.quantity).toBe(6);
      await secondSync.resolveManual(state.operations[0]!.id, "server");
      expect((await secondDb.read(second)).rows[0]?.payload.quantity).toBe(8);
    } finally {
      await fixture.app.close();
    }
  });
  it("keeps sync available when enrollment is disabled and rejects other-account writes", async () => {
    const fixture = await serverFixture();
    try {
      vi.stubEnv("OFFLINE_RUNTIME_ENABLED", "false");
      expect(
        (
          await fixture.request(
            "GET",
            `/businesses/${fixture.scope.storeId}/offline-runtime/snapshot`
          )
        ).statusCode
      ).toBe(403);
      expect(
        (await fixture.request("GET", `/sync/pull?storeId=${fixture.scope.storeId}`)).statusCode
      ).toBe(200);
      const db = await database();
      await install(db, fixture.scope);
      await new LocalProvider(db, fixture.scope).call("catalogue.create", {
        body: { name: "Rice" }
      });
      const op = (await db.read(fixture.scope)).operations[0]!;
      const response = await fixture.request("POST", "/sync/push", {
        ops: [{ ...op, accountId: "another-account" }]
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await fixture.app.close();
    }
  });
});

describe("Conservative conflict policies and retry limits", () => {
  const base = { id: "item", name: "Rice", quantity: 10 };
  it("merges disjoint permitted fields and rejects overlapping edits", () => {
    expect(
      resolveConflict({
        policy: "merge",
        base,
        local: { ...base, name: "Brown rice" },
        server: { ...base, quantity: 8 },
        allowedFields: ["name", "quantity"]
      })
    ).toEqual({ resolved: true, entity: { id: "item", name: "Brown rice", quantity: 8 } });
    expect(
      resolveConflict({
        policy: "merge",
        base,
        local: { ...base, quantity: 4 },
        server: { ...base, quantity: 8 },
        allowedFields: ["quantity"]
      }).resolved
    ).toBe(false);
    expect(resolveConflict({ policy: "server-wins", base, local: base, server: null })).toEqual({
      resolved: true,
      entity: null
    });
    expect(resolveConflict({ policy: "manual", base, local: base, server: base }).resolved).toBe(
      false
    );
    expect(
      resolveConflict({
        policy: "last-write-wins",
        base,
        local: base,
        server: null,
        localServerSequence: 1,
        remoteServerSequence: 2
      })
    ).toEqual({ resolved: true, entity: null });
    expect(
      resolveConflict({ policy: "last-write-wins", base, local: base, server: null }).resolved
    ).toBe(false);
  });
  it("retains failed uploads with backoff and dead-letters validation failures after three attempts", async () => {
    const db = await database();
    await install(db);
    await new LocalProvider(db, scope).call("catalogue.create", { body: { name: "Rice" } });
    const push = vi.fn(async (ops: Operation[]) => ({
      results: ops.map((op) => ({
        id: op.id,
        localSeq: op.localSeq,
        status: "REJECTED" as const,
        entity: null,
        serverOpId: op.id,
        message: "Invalid field"
      }))
    }));
    const sync = new SyncClient(db, scope, { push, pull: vi.fn() });
    for (let attempt = 0; attempt < 3; attempt++) {
      await db.transaction(scope, (state) => {
        state.operations[0]!.nextAttemptAt = 0;
      });
      await sync.push();
    }
    expect((await db.read(scope)).operations[0]?.syncStatus).toBe("CONFLICT");
    await sync.push();
    expect(push).toHaveBeenCalledTimes(3);
  });
});

async function serverFixture() {
  const store = createCp2Store();
  const app = buildApi({ cp2: { store } });
  const auth = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    payload: { method: "phone", contact: "254700000997", pin: "1234" }
  });
  expect(auth.statusCode).toBe(200);
  const cookies = auth.headers["set-cookie"];
  const cookie = (Array.isArray(cookies) ? cookies[0]! : cookies!).split(";")[0]!;
  const request = (
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: unknown,
    deviceId = "test-device"
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie, "x-soko-device-id": deviceId },
      ...(payload === undefined
        ? {}
        : {
            payload: JSON.stringify(payload),
            headers: { cookie, "x-soko-device-id": deviceId, "content-type": "application/json" }
          })
    });
  const created = await request("POST", "/businesses", { name: "Offline shop", language: "en" });
  expect(created.statusCode).toBe(200);
  const target = {
    accountId: auth.json().account.id,
    storeId: created.json().business.id,
    deviceId: "test-device"
  };
  const transportFor = (identity: Scope) => ({
    push: async (ops: Operation[]) => {
      const response = await request("POST", "/sync/push", { ops }, identity.deviceId);
      if (response.statusCode !== 200) throw new Error(response.body);
      return response.json();
    },
    pull: async (cursor: string | null) => {
      const response = await request(
        "GET",
        `/sync/pull?storeId=${identity.storeId}${cursor === null ? "" : `&since=${cursor}`}`
      );
      if (response.statusCode !== 200) throw new Error(response.body);
      return response.json();
    }
  });
  return {
    app,
    store,
    request,
    scope: target,
    sessionId: auth.json().session.id as string,
    transportFor,
    transport: transportFor(target)
  };
}
