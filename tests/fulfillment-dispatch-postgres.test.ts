/**
 * Corridor fulfillment Phase 1c against real PostgreSQL: intake, pools and readiness, A21
 * allocation, manifests, the A12 lifecycle, security, the A17 concurrency races, and the Phase 1
 * end-to-end Definition of Done. Skipped unless CP2_POSTGRES_TEST_DATABASE_URL is set.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Pool as PgPool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store, type Cp2Store } from "../services/api/src/cp2/store";
import {
  createPostgresFulfillmentService,
  fulfillmentDepsFromStore,
  type FulfillmentService
} from "../services/api/src/cp2/domains/fulfillment/service";
import {
  addMember,
  confirmInvoice,
  createCustomer,
  createOwner,
  createProduct,
  ok,
  request,
  signUp,
  withMigrationsReversed,
  type TestApp,
  type TestOwner
} from "./fixtures/fulfillment-test-helpers";

const { Pool } = createRequire(resolve(process.cwd(), "services/api/package.json"))("pg") as {
  Pool: new (options: { connectionString: string }) => PgPool;
};

const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

const KG = 1000;
// Corridor X: a straight north-south road (~11.1 km) along longitude 36.8.
const corridorX = {
  type: "LineString",
  coordinates: [
    [36.8, -1.3],
    [36.8, -1.2]
  ]
};
/** A shop ~110 m off Corridor X at `fraction` of the way along it. */
const alongX = (fraction: number) => ({ latitude: -1.3 + 0.1 * fraction, longitude: 36.801 });

interface PoolView {
  corridorId: string;
  eligibleOrderCount: number;
  eligibleTotalWeightGrams: string;
  allocatableWeightGrams: string;
  targetLoadGrams: string | null;
  readiness: string | null;
  needsResolution: boolean;
  unresolvedWeightCount: number;
  staleResolutionCount: number;
  percentFilled: number | null;
  timeUntilCutoffSeconds: number | null;
  oldestWaitingOrderAgeSeconds: number | null;
}

interface ManifestView {
  id: string;
  status: string;
  totalWeightGrams: string;
  vehicleCapacityGrams: string;
  corridorGeometryVersion: number;
  policyVersion: number;
  stops: Array<{
    id: string;
    invoiceId: string;
    sequence: number;
    distanceAlongMeters: number;
    latitude: number;
    longitude: number;
    orderWeightGrams: string;
    allocationActive: boolean;
    deliveryStatus: string;
  }>;
}

interface CreateManifestResult {
  manifest: ManifestView;
  allocatedInvoiceIds: string[];
  skippedInvoiceIds: string[];
  requiresPlanningInvoiceIds: string[];
}

describePostgres("corridor fulfillment Phase 1c on PostgreSQL", () => {
  let pool: PgPool;
  let store: Cp2Store;
  let service: FulfillmentService;
  let app: TestApp;
  let pendingIntakes: Array<Promise<unknown>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl ?? "" });
  });

  beforeEach(() => {
    store = createCp2Store();
    service = createPostgresFulfillmentService({ pool, deps: fulfillmentDepsFromStore(store) });
    pendingIntakes = [];
    store.setFulfillmentIntakeListener((input) => {
      const intake = service.intakeOrder(input);
      pendingIntakes.push(intake);
      return intake;
    });
    app = buildApi({ cp2: { store, fulfillmentService: service } });
  });

  afterEach(async () => {
    await Promise.allSettled(pendingIntakes);
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  const url = (owner: TestOwner, path: string) =>
    `/businesses/${owner.businessId}/fulfillment/${path}`;

  /** Waits for the fire-and-forget intake the store hook started (microtask). */
  async function settleIntakes() {
    await new Promise((done) => setImmediate(done));
    await Promise.allSettled(pendingIntakes);
  }

  async function setupBusiness(
    options: { targetKg?: number; minimumKg?: number | null; name?: string } = {}
  ) {
    const owner = await createOwner(app, options.name ?? "Corridor Wholesale");
    await ok(app, "PATCH", url(owner, "settings"), owner.cookie, { timezone: "Africa/Nairobi" });
    await ok(app, "POST", url(owner, "policies"), owner.cookie, {
      name: "Default",
      targetLoadGrams: String((options.targetKg ?? 6000) * KG),
      minimumDispatchLoadGrams:
        options.minimumKg === undefined || options.minimumKg === null
          ? null
          : String(options.minimumKg * KG),
      maxDiversionMeters: 2000,
      cutoffLocalTime: "18:00",
      maxWaitHours: 72,
      fulfillmentLeadDays: 1,
      underThresholdFallback: [],
      overflowStrategy: "NEXT_MANIFEST",
      makeBusinessDefault: true
    });
    const corridor = await ok<{ id: string }>(app, "POST", url(owner, "corridors"), owner.cookie, {
      name: "Corridor X",
      originLabel: "Depot",
      destinationLabel: "Market",
      routeGeometry: corridorX
    });
    const vehicle = await ok<{ id: string }>(app, "POST", url(owner, "vehicles"), owner.cookie, {
      name: "7-tonne truck",
      capacityGrams: String(7000 * KG)
    });
    return { owner, corridorId: corridor.id, vehicleId: vehicle.id };
  }

  /** A confirmed delivery order of exactly `grams` for a new shop at `location`. */
  async function deliveryOrder(
    owner: TestOwner,
    grams: number | null,
    location: { latitude: number; longitude: number } | null,
    options: { fulfillmentMethod?: "delivery" | "pickup" | null; customerId?: string } = {}
  ) {
    const customerId =
      options.customerId ??
      (await createCustomer(app, owner, `Shop ${randomUUID().slice(0, 6)}`)).id;
    if (location !== null && options.customerId === undefined) {
      await ok(app, "PUT", url(owner, `shops/${customerId}/location`), owner.cookie, location);
    }
    const product = await createProduct(app, owner, {
      name: `Load ${randomUUID().slice(0, 6)}`,
      ...(grams === null ? {} : { unitWeightGrams: String(grams) })
    });
    const method = options.fulfillmentMethod === undefined ? "delivery" : options.fulfillmentMethod;
    const { invoice } = await confirmInvoice(app, owner, {
      customerId,
      source: "FIELD_SALES",
      items: [{ productId: product.id, quantity: 1 }],
      ...(method === null ? {} : { fulfillmentMethod: method })
    });
    await settleIntakes();
    return { invoiceId: invoice.id, customerId };
  }

  const pools = async (owner: TestOwner) =>
    ok<{ pools: PoolView[]; unassigned: Record<string, number> }>(
      app,
      "GET",
      url(owner, "pools"),
      owner.cookie
    );
  const poolFor = async (owner: TestOwner, corridorId: string) =>
    (await pools(owner)).pools.find((entry) => entry.corridorId === corridorId) as PoolView;
  const orderStatus = async (owner: TestOwner, invoiceId: string) =>
    ok<{
      intakeStatus: string;
      state: string | null;
      corridor: { current: { corridorId: string } | null; stale: boolean } | null;
    }>(app, "GET", url(owner, `orders/${invoiceId}`), owner.cookie);
  const createManifest = (
    owner: TestOwner,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) =>
    request<CreateManifestResult & { code?: string; details?: Record<string, unknown> }>(
      app,
      "POST",
      url(owner, "manifests"),
      owner.cookie,
      body,
      headers
    );

  describe("intake on confirmation", () => {
    it("takes in delivery orders, resolves their corridor, and never blocks confirmation", async () => {
      const { owner, corridorId } = await setupBusiness();
      const delivered = await deliveryOrder(owner, 900 * KG, alongX(0.5));
      expect(await orderStatus(owner, delivered.invoiceId)).toMatchObject({
        intakeStatus: "TAKEN_IN",
        state: "POOLED",
        corridor: { current: { corridorId }, stale: false }
      });
      const logistics = await ok<Array<{ invoiceId: string; method: string; status: string }>>(
        app,
        "GET",
        `/businesses/${owner.businessId}/logistics`,
        owner.cookie
      );
      expect(logistics.find((entry) => entry.invoiceId === delivered.invoiceId)).toMatchObject({
        method: "delivery",
        status: "pending"
      });

      // Pickup and no-intent orders never enter fulfillment.
      const pickup = await deliveryOrder(owner, 900 * KG, alongX(0.5), {
        fulfillmentMethod: "pickup"
      });
      expect((await orderStatus(owner, pickup.invoiceId)).intakeStatus).toBe("NOT_FOR_DELIVERY");
      const noIntent = await deliveryOrder(owner, 900 * KG, alongX(0.5), {
        fulfillmentMethod: null
      });
      expect((await orderStatus(owner, noIntent.invoiceId)).intakeStatus).toBe("NOT_FOR_DELIVERY");
      // A delivery record added later makes it deliverable.
      await ok(app, "POST", `/businesses/${owner.businessId}/logistics`, owner.cookie, {
        invoiceId: noIntent.invoiceId,
        method: "delivery"
      });
      await settleIntakes();
      expect((await orderStatus(owner, noIntent.invoiceId)).intakeStatus).toBe("TAKEN_IN");

      // No location: taken in, visible as unassigned, not dropped.
      const lost = await deliveryOrder(owner, 900 * KG, null);
      expect((await orderStatus(owner, lost.invoiceId)).corridor?.current ?? null).toBeNull();
      expect((await pools(owner)).unassigned).toMatchObject({ unresolvedLocationCount: 1 });
    });

    it("reconciles orders whose intake never ran and flags orphans without deleting them", async () => {
      const { owner } = await setupBusiness();
      store.setFulfillmentIntakeListener(null);
      const missed = await deliveryOrder(owner, 500 * KG, alongX(0.3));
      expect((await orderStatus(owner, missed.invoiceId)).intakeStatus).toBe("PENDING_INTAKE");
      expect((await pools(owner)).unassigned.pendingIntakeCount).toBe(1);
      const first = await service.reconcileIntake();
      expect(first.takenIn).toBeGreaterThanOrEqual(1);
      expect((await orderStatus(owner, missed.invoiceId)).intakeStatus).toBe("TAKEN_IN");

      // Lose the invoice from the store (e.g. an unpersisted confirmation lost in a crash).
      const snapshot = store.snapshot();
      store.hydrateSnapshot({
        ...snapshot,
        invoices: snapshot.invoices.filter((invoice) => invoice.id !== missed.invoiceId)
      });
      const second = await service.reconcileIntake();
      expect(second.orphaned).toBeGreaterThanOrEqual(1);
      const row = await pool.query("select state from fulfillment_orders where invoice_id = $1", [
        missed.invoiceId
      ]);
      expect(row.rows).toEqual([{ state: "ORPHANED" }]);
      expect((await pools(owner)).unassigned.orphanedCount).toBe(1);
    });
  });

  describe("pooling and readiness (A13, A16)", () => {
    it("counts eligible, unpaid and pay-on-delivery orders; excludes unknown weight and cancellations", async () => {
      const { owner, corridorId } = await setupBusiness();
      const unpaid = await deliveryOrder(owner, 1000 * KG, alongX(0.2));
      const partPaid = await deliveryOrder(owner, 2000 * KG, alongX(0.4));
      await ok(app, "POST", `/businesses/${owner.businessId}/payments`, owner.cookie, {
        invoiceId: partPaid.invoiceId,
        amount: 10,
        method: "cash"
      });
      await deliveryOrder(owner, null, alongX(0.6));
      const cancelled = await deliveryOrder(owner, 3000 * KG, alongX(0.8));
      await ok(app, "POST", url(owner, `orders/${cancelled.invoiceId}/cancel`), owner.cookie, {
        reason: "Shop closed"
      });
      const view = await poolFor(owner, corridorId);
      // Payment state is not an input: unpaid and part-paid both count.
      expect(view).toMatchObject({
        eligibleOrderCount: 2,
        eligibleTotalWeightGrams: String(3000 * KG),
        unresolvedWeightCount: 1,
        needsResolution: true,
        readiness: "ACCUMULATING",
        percentFilled: 50
      });
      expect(unpaid.invoiceId).toBeTruthy();
      expect(view.timeUntilCutoffSeconds).toBeGreaterThan(0);
      expect(view.oldestWaitingOrderAgeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("keeps a stale order in the total, flags it, excludes it from readiness and blocks allocation", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness({ targetKg: 1000 });
      const order = await deliveryOrder(owner, 1000 * KG, alongX(0.5));
      expect((await poolFor(owner, corridorId)).readiness).toBe("DISPATCH_READY");
      await ok(app, "PUT", url(owner, `corridors/${corridorId}/geometry`), owner.cookie, {
        routeGeometry: {
          type: "LineString",
          coordinates: [...corridorX.coordinates, [36.8, -1.19]]
        }
      });
      expect(await poolFor(owner, corridorId)).toMatchObject({
        eligibleTotalWeightGrams: String(1000 * KG),
        allocatableWeightGrams: "0",
        staleResolutionCount: 1,
        needsResolution: true,
        readiness: "ACCUMULATING"
      });
      const auto = await createManifest(owner, { corridorId, vehicleId });
      expect(auto.status).toBe(409);
      const explicit = await createManifest(owner, {
        corridorId,
        vehicleId,
        orderIds: [order.invoiceId]
      });
      expect(explicit.status).toBe(422);
      expect(explicit.body.details?.rejections).toEqual([
        { orderId: order.invoiceId, reason: "STALE_RESOLUTION" }
      ]);
      await ok(
        app,
        "POST",
        url(owner, `orders/${order.invoiceId}/corridor/resolve`),
        owner.cookie,
        {}
      );
      expect((await createManifest(owner, { corridorId, vehicleId })).status).toBe(200);
    });

    it("moves pools when an order is manually reassigned", async () => {
      const { owner, corridorId } = await setupBusiness();
      const other = await ok<{ id: string }>(app, "POST", url(owner, "corridors"), owner.cookie, {
        name: "Corridor Y",
        originLabel: "Depot",
        destinationLabel: "Y",
        routeGeometry: corridorX,
        priority: 500
      });
      const order = await deliveryOrder(owner, 800 * KG, alongX(0.5));
      expect((await poolFor(owner, corridorId)).eligibleOrderCount).toBe(1);
      await ok(app, "POST", url(owner, `orders/${order.invoiceId}/corridor/assign`), owner.cookie, {
        corridorId: other.id
      });
      expect((await poolFor(owner, corridorId)).eligibleOrderCount).toBe(0);
      expect((await poolFor(owner, other.id)).eligibleTotalWeightGrams).toBe(String(800 * KG));
    });

    it("computes readiness at the exact gram boundaries", async () => {
      const nullMinimum = await setupBusiness({ targetKg: 6000 });
      await deliveryOrder(nullMinimum.owner, 6000 * KG - 1, alongX(0.3));
      expect((await poolFor(nullMinimum.owner, nullMinimum.corridorId)).readiness).toBe(
        "ACCUMULATING"
      );
      await deliveryOrder(nullMinimum.owner, 1, alongX(0.4));
      expect((await poolFor(nullMinimum.owner, nullMinimum.corridorId)).readiness).toBe(
        "DISPATCH_READY"
      );

      const withMinimum = await setupBusiness({ targetKg: 6000, minimumKg: 4000 });
      await deliveryOrder(withMinimum.owner, 4000 * KG - 1, alongX(0.3));
      expect((await poolFor(withMinimum.owner, withMinimum.corridorId)).readiness).toBe(
        "ACCUMULATING"
      );
      await deliveryOrder(withMinimum.owner, 1, alongX(0.4));
      expect((await poolFor(withMinimum.owner, withMinimum.corridorId)).readiness).toBe(
        "DISPATCHABLE"
      );
    });
  });

  describe("A21 allocation", () => {
    it("5,900 kg + 900 kg into 7,000 kg: both allocated, exact BIGINT total, stops in road order", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const far = await deliveryOrder(owner, 5900 * KG, alongX(0.9));
      const near = await deliveryOrder(owner, 900 * KG, alongX(0.1));
      const result = await createManifest(owner, { corridorId, vehicleId });
      expect(result.status).toBe(200);
      expect(result.body.manifest).toMatchObject({
        status: "OPEN",
        totalWeightGrams: String(6800 * KG),
        vehicleCapacityGrams: String(7000 * KG)
      });
      expect(result.body.manifest.stops.map((stop) => [stop.sequence, stop.invoiceId])).toEqual([
        [1, near.invoiceId],
        [2, far.invoiceId]
      ]);
      expect(typeof result.body.manifest.stops[0]?.orderWeightGrams).toBe("string");
    });

    it("6,500 kg + 900 kg into 7,000 kg: the second stays pooled with its original age", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const big = await deliveryOrder(owner, 6500 * KG, alongX(0.5));
      const extra = await deliveryOrder(owner, 900 * KG, alongX(0.6));
      const result = await createManifest(owner, { corridorId, vehicleId });
      expect(result.body.allocatedInvoiceIds).toEqual([big.invoiceId]);
      expect(result.body.skippedInvoiceIds).toEqual([extra.invoiceId]);
      expect((await orderStatus(owner, extra.invoiceId)).state).toBe("POOLED");
    });

    it("skips an older order that does not fit and allocates a newer one that does", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const base = await deliveryOrder(owner, 6300 * KG, alongX(0.2));
      const older = await deliveryOrder(owner, 900 * KG, alongX(0.3));
      const newer = await deliveryOrder(owner, 400 * KG, alongX(0.4));
      const result = await createManifest(owner, { corridorId, vehicleId });
      expect(result.body.allocatedInvoiceIds.sort()).toEqual(
        [base.invoiceId, newer.invoiceId].sort()
      );
      expect(result.body.skippedInvoiceIds).toEqual([older.invoiceId]);
    });

    it("flags an order heavier than the vehicle as REQUIRES_PLANNING", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const huge = await deliveryOrder(owner, 7500 * KG, alongX(0.5));
      expect((await poolFor(owner, corridorId)).eligibleOrderCount).toBe(1);
      const alone = await createManifest(owner, { corridorId, vehicleId });
      expect(alone.status).toBe(409);
      const small = await deliveryOrder(owner, 100 * KG, alongX(0.6));
      const result = await createManifest(owner, { corridorId, vehicleId });
      expect(result.body.allocatedInvoiceIds).toEqual([small.invoiceId]);
      expect(result.body.requiresPlanningInvoiceIds).toEqual([huge.invoiceId]);
    });

    it("rejects an explicit selection that exceeds capacity, all or nothing", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const a = await deliveryOrder(owner, 4000 * KG, alongX(0.2));
      const b = await deliveryOrder(owner, 4000 * KG, alongX(0.4));
      const result = await createManifest(owner, {
        corridorId,
        vehicleId,
        orderIds: [a.invoiceId, b.invoiceId]
      });
      expect(result.status).toBe(422);
      expect(result.body.code).toBe("invalid_selection");
      const manifests = await ok<unknown[]>(app, "GET", url(owner, "manifests"), owner.cookie);
      expect(manifests).toEqual([]);
      expect((await orderStatus(owner, a.invoiceId)).state).toBe("POOLED");
    });

    it("rejects an explicit selection with an allocated, foreign or unknown order", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const other = await setupBusiness({ name: "Another wholesaler" });
      const first = await deliveryOrder(owner, 1000 * KG, alongX(0.2));
      const fresh = await deliveryOrder(owner, 1000 * KG, alongX(0.3));
      const foreign = await deliveryOrder(other.owner, 1000 * KG, alongX(0.3));
      await createManifest(owner, { corridorId, vehicleId, orderIds: [first.invoiceId] });
      const result = await createManifest(owner, {
        corridorId,
        vehicleId,
        orderIds: [fresh.invoiceId, first.invoiceId, foreign.invoiceId]
      });
      expect(result.status).toBe(422);
      expect(result.body.details?.rejections).toEqual([
        { orderId: first.invoiceId, reason: "ALREADY_ALLOCATED" },
        { orderId: foreign.invoiceId, reason: "NOT_FOUND" }
      ]);
      expect((await orderStatus(owner, fresh.invoiceId)).state).toBe("POOLED");
    });
  });

  describe("manifests and the A12 lifecycle", () => {
    it("snapshots location, geometry and policy versions; later edits do not change the manifest", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const order = await deliveryOrder(owner, 1000 * KG, alongX(0.5));
      const created = await createManifest(owner, { corridorId, vehicleId });
      const before = created.body.manifest;
      expect(before).toMatchObject({ corridorGeometryVersion: 1, policyVersion: 1 });
      await ok(
        app,
        "PUT",
        url(owner, `shops/${order.customerId}/location`),
        owner.cookie,
        alongX(0.7)
      );
      await ok(app, "PUT", url(owner, `corridors/${corridorId}/geometry`), owner.cookie, {
        routeGeometry: {
          type: "LineString",
          coordinates: [...corridorX.coordinates, [36.8, -1.19]]
        }
      });
      const after = await ok<ManifestView>(
        app,
        "GET",
        url(owner, `manifests/${before.id}`),
        owner.cookie
      );
      expect(after.corridorGeometryVersion).toBe(1);
      expect(after.stops[0]).toMatchObject({
        latitude: before.stops[0]?.latitude,
        longitude: before.stops[0]?.longitude,
        distanceAlongMeters: before.stops[0]?.distanceAlongMeters
      });
      // An allocated order cannot be re-resolved; it must leave the manifest first.
      const reresolve = await request<{ code: string }>(
        app,
        "POST",
        url(owner, `orders/${order.invoiceId}/corridor/resolve`),
        owner.cookie,
        {}
      );
      expect(reresolve.status).toBe(409);
      expect(reresolve.body.code).toBe("order_allocated");
    });

    it("handles cancellation and removal while OPEN, blocks cancellation once CLOSED, and records deliveries", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const a = await deliveryOrder(owner, 1000 * KG, alongX(0.1));
      const b = await deliveryOrder(owner, 2000 * KG, alongX(0.2));
      const c = await deliveryOrder(owner, 3000 * KG, alongX(0.3));
      const d = await deliveryOrder(owner, 500 * KG, alongX(0.4));
      const created = (await createManifest(owner, { corridorId, vehicleId })).body.manifest;
      expect(created.totalWeightGrams).toBe(String(6500 * KG));

      // OPEN: cancellation deactivates the stop and recomputes the total.
      await ok(app, "POST", url(owner, `orders/${a.invoiceId}/cancel`), owner.cookie, {
        reason: "Changed mind"
      });
      const afterCancel = await ok<ManifestView>(
        app,
        "GET",
        url(owner, `manifests/${created.id}`),
        owner.cookie
      );
      expect(afterCancel.totalWeightGrams).toBe(String(5500 * KG));
      expect((await orderStatus(owner, a.invoiceId)).state).toBe("CANCELLED");
      // OPEN: removal returns the order to the pool.
      await ok(
        app,
        "POST",
        url(owner, `manifests/${created.id}/orders/${d.invoiceId}/remove`),
        owner.cookie,
        {}
      );
      expect((await orderStatus(owner, d.invoiceId)).state).toBe("POOLED");

      const closed = await ok<ManifestView>(
        app,
        "POST",
        url(owner, `manifests/${created.id}/close`),
        owner.cookie,
        {}
      );
      expect(closed.status).toBe("CLOSED");
      const blocked = await request<{ code: string }>(
        app,
        "POST",
        url(owner, `orders/${b.invoiceId}/cancel`),
        owner.cookie,
        {}
      );
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe("order_dispatched");

      const stopFor = (invoiceId: string) =>
        closed.stops.find(
          (stop) => stop.invoiceId === invoiceId && stop.allocationActive
        ) as ManifestView["stops"][number];
      const skipNoReason = await request(
        app,
        "POST",
        url(owner, `manifests/${created.id}/stops/${stopFor(c.invoiceId).id}/delivery`),
        owner.cookie,
        { outcome: "SKIPPED" }
      );
      expect(skipNoReason.status).toBe(400);
      await ok(
        app,
        "POST",
        url(owner, `manifests/${created.id}/stops/${stopFor(c.invoiceId).id}/delivery`),
        owner.cookie,
        {
          outcome: "SKIPPED",
          note: "Shop locked"
        }
      );
      // Skipped goes back to the pool with its original confirmation age.
      expect((await orderStatus(owner, c.invoiceId)).state).toBe("POOLED");
      await ok(
        app,
        "POST",
        url(owner, `manifests/${created.id}/stops/${stopFor(b.invoiceId).id}/delivery`),
        owner.cookie,
        { outcome: "ARRIVED" }
      );
      const done = await ok<ManifestView>(
        app,
        "POST",
        url(owner, `manifests/${created.id}/stops/${stopFor(b.invoiceId).id}/delivery`),
        owner.cookie,
        { outcome: "DELIVERED" }
      );
      expect(done.status).toBe("COMPLETED");
      expect((await orderStatus(owner, b.invoiceId)).state).toBe("DELIVERED");
      const again = await request(
        app,
        "POST",
        url(owner, `manifests/${created.id}/stops/${stopFor(b.invoiceId).id}/delivery`),
        owner.cookie,
        { outcome: "FAILED", note: "x" }
      );
      expect(again.status).toBe(409);

      const logistics = await ok<Array<{ invoiceId: string; status: string }>>(
        app,
        "GET",
        `/businesses/${owner.businessId}/logistics`,
        owner.cookie
      );
      const statusOf = (invoiceId: string) =>
        logistics.find((entry) => entry.invoiceId === invoiceId)?.status;
      expect([
        statusOf(a.invoiceId),
        statusOf(b.invoiceId),
        statusOf(c.invoiceId),
        statusOf(d.invoiceId)
      ]).toEqual(["cancelled", "completed", "ready", "ready"]);
    });
  });

  describe("security (A8, A3.11)", () => {
    it("denies cross-tenant access and enforces dispatch and delivery permissions", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const other = await createOwner(app, "Intruder");
      const order = await deliveryOrder(owner, 1000 * KG, alongX(0.5));
      expect((await request(app, "GET", url(owner, "pools"), other.cookie)).status).toBe(403);
      expect(
        (
          await request(app, "POST", url(owner, "manifests"), other.cookie, {
            corridorId,
            vehicleId
          })
        ).status
      ).toBe(403);
      expect(
        (
          await request(
            app,
            "POST",
            `/businesses/${other.businessId}/fulfillment/manifests`,
            other.cookie,
            { corridorId, vehicleId }
          )
        ).status
      ).toBe(404);

      const salesperson = await signUp(app);
      addMember(store, owner.businessId, salesperson.userId, "sales_agent");
      expect((await request(app, "GET", url(owner, "pools"), salesperson.cookie)).status).toBe(200);
      expect(
        (await request(app, "GET", url(owner, `pools/${corridorId}`), salesperson.cookie)).status
      ).toBe(403);
      expect(
        (
          await request(app, "POST", url(owner, "manifests"), salesperson.cookie, {
            corridorId,
            vehicleId
          })
        ).status
      ).toBe(403);

      const created = (await createManifest(owner, { corridorId, vehicleId })).body.manifest;
      await ok(app, "POST", url(owner, `manifests/${created.id}/close`), owner.cookie, {});
      const driver = await signUp(app);
      addMember(store, owner.businessId, driver.userId, "driver");
      expect(
        (
          await request(app, "POST", url(owner, "manifests"), driver.cookie, {
            corridorId,
            vehicleId
          })
        ).status
      ).toBe(403);
      expect(
        (
          await request(
            app,
            "POST",
            url(owner, `manifests/${created.id}/stops/${created.stops[0]?.id}/delivery`),
            driver.cookie,
            { outcome: "DELIVERED" }
          )
        ).status
      ).toBe(200);
      expect((await orderStatus(owner, order.invoiceId)).state).toBe("DELIVERED");
    });
  });

  describe("A17 concurrency on real PostgreSQL", () => {
    it("serializes concurrent automatic creation: no order in two manifests, none lost, none over capacity", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const orders = [];
      for (let index = 0; index < 12; index += 1) {
        orders.push(await deliveryOrder(owner, 1500 * KG, alongX(0.05 + index * 0.07)));
      }
      const results = await Promise.all(
        Array.from({ length: 4 }, () => createManifest(owner, { corridorId, vehicleId }))
      );
      // 4 x 1,500 kg fit a 7,000 kg truck: three manifests take all 12 orders, and the fourth
      // request sees the post-lock state (nothing left) instead of a stale snapshot.
      const created = results.filter((result) => result.status === 200);
      expect(created).toHaveLength(3);
      expect(results.filter((result) => result.status === 409)).toHaveLength(1);
      const allocated = created.flatMap((result) => result.body.allocatedInvoiceIds);
      expect(new Set(allocated).size).toBe(allocated.length);
      expect(allocated).toHaveLength(12);
      for (const result of created) {
        expect(BigInt(result.body.manifest.totalWeightGrams)).toBeLessThanOrEqual(7000n * 1000n);
      }
      const states = await pool.query<{ invoice_id: string; state: string; active: number }>(
        `select o.invoice_id, o.state,
                (select count(*) from fulfillment_manifest_stops s where s.fulfillment_order_id = o.id and s.allocation_active)::int as active
         from fulfillment_orders o where o.business_id = $1`,
        [owner.businessId]
      );
      expect(states.rows).toHaveLength(12);
      for (const row of states.rows) {
        expect(row.state === "ALLOCATED" ? row.active : 1 - row.active).toBe(1);
      }
      expect(states.rows.filter((row) => row.state === "ALLOCATED")).toHaveLength(allocated.length);
    });

    it("lets exactly one of two overlapping explicit selections win", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      const shared = await deliveryOrder(owner, 1000 * KG, alongX(0.2));
      const onlyA = await deliveryOrder(owner, 1000 * KG, alongX(0.3));
      const onlyB = await deliveryOrder(owner, 1000 * KG, alongX(0.4));
      const [first, second] = await Promise.all([
        createManifest(owner, {
          corridorId,
          vehicleId,
          orderIds: [shared.invoiceId, onlyA.invoiceId]
        }),
        createManifest(owner, {
          corridorId,
          vehicleId,
          orderIds: [shared.invoiceId, onlyB.invoiceId]
        })
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 422]);
      const loser = first.status === 422 ? first : second;
      expect(loser.body.details?.rejections).toEqual([
        { orderId: shared.invoiceId, reason: "ALREADY_ALLOCATED" }
      ]);
      // No partial explicit allocation survives for the loser.
      const loserOnly = loser === first ? onlyA : onlyB;
      expect((await orderStatus(owner, loserOnly.invoiceId)).state).toBe("POOLED");
    });

    it("never allocates an order in its cancelled or reassigned state (membership race)", async () => {
      for (let round = 0; round < 3; round += 1) {
        const { owner, corridorId, vehicleId } = await setupBusiness({ name: `Race ${round}` });
        const cancelled = await deliveryOrder(owner, 1000 * KG, alongX(0.2));
        const reassigned = await deliveryOrder(owner, 1000 * KG, alongX(0.3));
        const other = await ok<{ id: string }>(app, "POST", url(owner, "corridors"), owner.cookie, {
          name: "Parallel",
          originLabel: "Depot",
          destinationLabel: "P",
          routeGeometry: corridorX,
          priority: 900
        });
        await Promise.all([
          createManifest(owner, { corridorId, vehicleId }),
          request(
            app,
            "POST",
            url(owner, `orders/${cancelled.invoiceId}/cancel`),
            owner.cookie,
            {}
          ),
          request(
            app,
            "POST",
            url(owner, `orders/${reassigned.invoiceId}/corridor/assign`),
            owner.cookie,
            { corridorId: other.id }
          )
        ]);
        const rows = await pool.query<{
          invoice_id: string;
          state: string;
          active_manifest_corridor: string | null;
          resolved_corridor: string | null;
        }>(
          `select o.invoice_id, o.state,
                  (select m.corridor_id from fulfillment_manifest_stops s join fulfillment_manifests m on m.id = s.manifest_id
                   where s.fulfillment_order_id = o.id and s.allocation_active) as active_manifest_corridor,
                  (select r.corridor_id from fulfillment_corridor_resolutions r
                   where r.fulfillment_order_id = o.id and r.superseded_at is null) as resolved_corridor
           from fulfillment_orders o where o.business_id = $1`,
          [owner.businessId]
        );
        for (const row of rows.rows) {
          // A cancelled order never holds an active allocation.
          if (row.state === "CANCELLED") expect(row.active_manifest_corridor).toBeNull();
          // An allocated order's manifest is on the corridor it is resolved to.
          if (row.active_manifest_corridor !== null) {
            expect(row.state).toBe("ALLOCATED");
            expect(row.resolved_corridor).toBe(row.active_manifest_corridor);
          }
        }
      }
    });

    it("turns concurrent identical requests into one manifest and rejects a different body", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      await deliveryOrder(owner, 1000 * KG, alongX(0.2));
      await deliveryOrder(owner, 1000 * KG, alongX(0.3));
      const headers = { "idempotency-key": "manifest-race" };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createManifest(owner, { corridorId, vehicleId }, headers))
      );
      expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(results.map((result) => result.body.manifest.id)).size).toBe(1);
      const count = await pool.query("select 1 from fulfillment_manifests where business_id = $1", [
        owner.businessId
      ]);
      expect(count.rows).toHaveLength(1);
      const conflict = await createManifest(
        owner,
        { corridorId, vehicleId, orderIds: [randomUUID()] },
        headers
      );
      expect(conflict.status).toBe(409);
    });

    it("enforces one active allocation and capacity in the database itself", async () => {
      const { owner, corridorId, vehicleId } = await setupBusiness();
      await deliveryOrder(owner, 1000 * KG, alongX(0.2));
      const created = (await createManifest(owner, { corridorId, vehicleId })).body.manifest;
      const stop = await pool.query(
        "select * from fulfillment_manifest_stops where manifest_id = $1",
        [created.id]
      );
      const row = stop.rows[0];
      await expect(
        pool.query(
          `insert into fulfillment_manifest_stops
             (id, business_id, manifest_id, fulfillment_order_id, invoice_id, customer_id, corridor_resolution_id,
              shop_location_id, sequence, distance_along_meters, diversion_meters, latitude, longitude,
              order_weight_grams, allocation_active, delivery_status, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 99, 0, 0, 0, 0, 1, true, 'PENDING', now(), now())`,
          [
            randomUUID(),
            row.business_id,
            row.manifest_id,
            row.fulfillment_order_id,
            row.invoice_id,
            row.customer_id,
            row.corridor_resolution_id,
            row.shop_location_id
          ]
        )
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        pool.query(
          "update fulfillment_manifests set total_weight_grams = vehicle_capacity_grams + 1 where id = $1",
          [created.id]
        )
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("Phase 1 end-to-end Definition of Done", () => {
    it("runs the 14-step field-sales-to-delivery scenario", async () => {
      // Target 6,000 kg with no minimum; a 7,000 kg truck.
      const { owner, corridorId, vehicleId } = await setupBusiness({ targetKg: 6000 });
      const salesperson = await signUp(app);
      addMember(store, owner.businessId, salesperson.userId, "sales_agent");
      const asSales: TestOwner = {
        businessId: owner.businessId,
        userId: salesperson.userId,
        cookie: salesperson.cookie
      };

      // 1-2. Salesperson registers Shop A and captures its GPS.
      const shopA = await ok<{ id: string }>(
        app,
        "POST",
        `/businesses/${owner.businessId}/customers`,
        asSales.cookie,
        { name: "Shop A" }
      );
      await ok(app, "PUT", url(owner, `shops/${shopA.id}/location`), asSales.cookie, alongX(0.5));
      // 3. Shop A resolves to Corridor X.
      const match = await ok<{ status: string; selected: { corridorId: string } }>(
        app,
        "GET",
        url(owner, `shops/${shopA.id}/corridor-match`),
        asSales.cookie
      );
      expect(match).toMatchObject({ status: "RESOLVED", selected: { corridorId } });
      // 4. Salesperson creates a 900 kg order (owner confirms: sales agents cannot confirm).
      const product = await createProduct(app, owner, {
        name: "Maize sack 90kg",
        unitWeightGrams: String(90 * KG)
      });
      const draft = await ok<{ id: string }>(
        app,
        "POST",
        `/businesses/${owner.businessId}/invoices`,
        asSales.cookie,
        {
          customerId: shopA.id,
          source: "FIELD_SALES",
          taxRate: 0,
          items: [{ productId: product.id, quantity: 10, unitPrice: 3000 }]
        }
      );
      await ok(
        app,
        "POST",
        `/businesses/${owner.businessId}/invoices/${draft.id}/confirm`,
        owner.cookie,
        { fulfillmentMethod: "delivery" }
      );
      await settleIntakes();
      const orderA = await orderStatus(owner, draft.id);
      expect(orderA).toMatchObject({
        intakeStatus: "TAKEN_IN",
        state: "POOLED",
        corridor: { current: { corridorId } }
      });
      const provenance = await pool.query(
        "select resolution_method from fulfillment_corridor_resolutions r join fulfillment_orders o on o.id = r.fulfillment_order_id where o.invoice_id = $1",
        [draft.id]
      );
      expect(provenance.rows).toEqual([{ resolution_method: "AUTO" }]);

      // 5-6. More orders join Corridor X up to target - 1 g: ACCUMULATING.
      const b = await deliveryOrder(owner, 3000 * KG, alongX(0.2));
      const c = await deliveryOrder(owner, 2100 * KG - 1, alongX(0.8));
      expect(await poolFor(owner, corridorId)).toMatchObject({
        eligibleTotalWeightGrams: String(6000 * KG - 1),
        readiness: "ACCUMULATING"
      });
      // 7-8. A pay-on-delivery order (no payment recorded) takes it to target: DISPATCH_READY.
      const pod = await deliveryOrder(owner, 1, alongX(0.9));
      expect(await poolFor(owner, corridorId)).toMatchObject({
        eligibleTotalWeightGrams: String(6000 * KG),
        readiness: "DISPATCH_READY"
      });
      // 9. Geometry edit: one unallocated order becomes stale and is blocked until re-resolved.
      await ok(app, "PUT", url(owner, `corridors/${corridorId}/geometry`), owner.cookie, {
        routeGeometry: {
          type: "LineString",
          coordinates: [...corridorX.coordinates, [36.8, -1.19]]
        }
      });
      const staleView = await poolFor(owner, corridorId);
      expect(staleView.staleResolutionCount).toBe(4);
      expect(staleView.eligibleTotalWeightGrams).toBe(String(6000 * KG));
      const blocked = await createManifest(owner, {
        corridorId,
        vehicleId,
        orderIds: [b.invoiceId]
      });
      expect(blocked.status).toBe(422);
      for (const invoiceId of [draft.id, b.invoiceId, c.invoiceId, pod.invoiceId]) {
        await ok(app, "POST", url(owner, `orders/${invoiceId}/corridor/resolve`), owner.cookie, {});
      }
      // An extra order that will not fit, to prove capacity (step 11).
      const overflow = await deliveryOrder(owner, 1500 * KG, alongX(0.95));

      // 10-11. Dispatcher (manager) creates a manifest with the 7,000 kg truck.
      const dispatcher = await signUp(app);
      addMember(store, owner.businessId, dispatcher.userId, "manager");
      const created = await request<CreateManifestResult>(
        app,
        "POST",
        url(owner, "manifests"),
        dispatcher.cookie,
        { corridorId, vehicleId }
      );
      expect(created.status).toBe(200);
      expect(BigInt(created.body.manifest.totalWeightGrams)).toBeLessThanOrEqual(7000n * 1000n);
      expect(created.body.manifest.totalWeightGrams).toBe(String(6000 * KG));
      expect(created.body.skippedInvoiceIds).toEqual([overflow.invoiceId]);
      expect((await orderStatus(owner, overflow.invoiceId)).state).toBe("POOLED");
      // 12. Stops ordered by distance along Corridor X.
      expect(created.body.manifest.stops.map((stop) => stop.invoiceId)).toEqual([
        b.invoiceId,
        draft.id,
        c.invoiceId,
        pod.invoiceId
      ]);

      // 13. Manifest closes; deliveries are recorded.
      const closed = await ok<ManifestView>(
        app,
        "POST",
        url(owner, `manifests/${created.body.manifest.id}/close`),
        dispatcher.cookie,
        {}
      );
      for (const stop of closed.stops) {
        await ok(
          app,
          "POST",
          url(owner, `manifests/${closed.id}/stops/${stop.id}/delivery`),
          dispatcher.cookie,
          { outcome: "DELIVERED" }
        );
      }
      // 14. Canonical orders show the correct fulfillment state.
      const logistics = await ok<Array<{ invoiceId: string; status: string }>>(
        app,
        "GET",
        `/businesses/${owner.businessId}/logistics`,
        owner.cookie
      );
      for (const invoiceId of [draft.id, b.invoiceId, c.invoiceId, pod.invoiceId]) {
        expect((await orderStatus(owner, invoiceId)).state).toBe("DELIVERED");
        expect(logistics.find((entry) => entry.invoiceId === invoiceId)?.status).toBe("completed");
      }
      const finalManifest = await ok<ManifestView>(
        app,
        "GET",
        url(owner, `manifests/${closed.id}`),
        owner.cookie
      );
      expect(finalManifest.status).toBe("COMPLETED");

      // Proofs: no order disappears, none duplicates, none crosses tenants, no weight is lost.
      const all = await pool.query<{
        invoice_id: string;
        state: string;
        business_id: string;
        total_weight_grams: string;
      }>(
        "select invoice_id, state, business_id, total_weight_grams from fulfillment_orders where business_id = $1",
        [owner.businessId]
      );
      expect(all.rows).toHaveLength(5);
      expect(new Set(all.rows.map((row) => row.invoice_id)).size).toBe(5);
      const delivered = all.rows.filter((row) => row.state === "DELIVERED");
      expect(delivered.reduce((sum, row) => sum + BigInt(row.total_weight_grams), 0n)).toBe(
        6000n * 1000n
      );
      expect(all.rows.filter((row) => row.state === "POOLED").map((row) => row.invoice_id)).toEqual(
        [overflow.invoiceId]
      );
    }, 60_000);
  });

  describe("migrations 093/094", () => {
    it("reverse and re-apply cleanly", async () => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await withMigrationsReversed(client, "093", async () => {
          const gone = await client.query(
            "select to_regclass('fulfillment_manifests') as manifests"
          );
          expect(gone.rows[0]).toEqual({ manifests: null });
          const columns = await client.query(
            "select column_name from information_schema.columns where table_name = 'invoices' and column_name = 'source'"
          );
          expect(columns.rows).toEqual([]);
        });
        const back = await client.query(
          "select to_regclass('fulfillment_manifest_stops') is not null as present"
        );
        expect(back.rows[0]).toEqual({ present: true });
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });
});
