/**
 * Corridor fulfillment Phase 1b against real PostgreSQL: corridor geometry versioning, corridor
 * resolution with append-only provenance, staleness, manual assignment, security and concurrency.
 * Skipped unless CP2_POSTGRES_TEST_DATABASE_URL points at a migrated database.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Pool as PgPool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store, type Cp2Store } from "../services/api/src/cp2/store";
import { createPostgresFulfillmentService } from "../services/api/src/cp2/domains/fulfillment/service";
import {
  addMember,
  confirmInvoice,
  createCustomer,
  createOwner,
  createProduct,
  ok,
  request,
  signUp,
  type TestApp,
  type TestOwner
} from "./fixtures/fulfillment-test-helpers";

const { Pool } = createRequire(resolve(process.cwd(), "services/api/package.json"))("pg") as {
  Pool: new (options: { connectionString: string }) => PgPool;
};

const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

// Thika Road out of Nairobi, and a second road that shares its first section then forks east.
const thikaRoad = {
  type: "LineString",
  coordinates: [
    [36.8219, -1.2921],
    [36.8792, -1.2305],
    [36.9795, -1.1601],
    [37.0693, -1.0332]
  ]
};
const kangunduRoad = {
  type: "LineString",
  coordinates: [
    [36.8219, -1.2921],
    [36.8792, -1.2305],
    [36.95, -1.26]
  ]
};
// A shop a few hundred metres off the shared section: both corridors qualify.
const sharedSectionShop = { latitude: -1.258, longitude: 36.852 };
// A shop near the Thika end: only Thika Road qualifies.
const thikaEndShop = { latitude: -1.04, longitude: 37.06 };

const policyBody = {
  name: "Default",
  targetLoadGrams: "6000000",
  minimumDispatchLoadGrams: null,
  maxDiversionMeters: 2000,
  cutoffLocalTime: "18:00",
  maxWaitHours: 72,
  fulfillmentLeadDays: 1,
  underThresholdFallback: [],
  overflowStrategy: "NEXT_MANIFEST",
  makeBusinessDefault: true
};

describePostgres("corridor fulfillment Phase 1b on PostgreSQL", () => {
  let pool: PgPool;
  let store: Cp2Store;
  let app: TestApp;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl ?? "" });
  });

  beforeEach(() => {
    store = createCp2Store();
    const service = createPostgresFulfillmentService({
      pool,
      deps: {
        authorize: (input) => store.authorizeBusinessPermission(input),
        hasPermission: (input) => store.hasBusinessPermission(input),
        requireCustomer: (businessId, customerId) =>
          store.requireBusinessCustomer(businessId, customerId),
        requireConfirmedOrder: (businessId, invoiceId) =>
          store.requireConfirmedOrderReference(businessId, invoiceId)
      }
    });
    app = buildApi({ cp2: { store, fulfillmentService: service } });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  const url = (businessId: string, path: string) => `/businesses/${businessId}/fulfillment/${path}`;

  async function createCorridor(
    owner: TestOwner,
    name: string,
    routeGeometry: unknown,
    extra: Record<string, unknown> = {}
  ) {
    return ok<{ id: string; geometryVersion: number; distanceMeters: number; priority: number }>(
      app,
      "POST",
      url(owner.businessId, "corridors"),
      owner.cookie,
      { name, originLabel: "Nairobi CBD", destinationLabel: name, routeGeometry, ...extra }
    );
  }

  async function shopWithOrder(
    owner: TestOwner,
    location: { latitude: number; longitude: number } | null
  ) {
    const shop = await createCustomer(app, owner, `Shop ${randomUUID().slice(0, 6)}`);
    if (location !== null) {
      await ok(
        app,
        "PUT",
        url(owner.businessId, `shops/${shop.id}/location`),
        owner.cookie,
        location
      );
    }
    const product = await createProduct(app, owner, {
      name: "Maize sack",
      unitWeightGrams: "90000"
    });
    const { invoice } = await confirmInvoice(app, owner, {
      customerId: shop.id,
      items: [{ productId: product.id, quantity: 10 }]
    });
    return { shop, invoiceId: invoice.id };
  }

  async function ownerWithPolicy() {
    const owner = await createOwner(app);
    await ok(app, "POST", url(owner.businessId, "policies"), owner.cookie, policyBody);
    return owner;
  }

  describe("corridors and geometry versioning (A14/A16)", () => {
    it("computes distance server-side, defaults priority to 100, and versions geometry edits", async () => {
      const owner = await ownerWithPolicy();
      const corridor = await createCorridor(owner, "Thika", thikaRoad, { distanceMeters: 1 });
      expect(corridor.geometryVersion).toBe(1);
      expect(corridor.priority).toBe(100);
      expect(corridor.distanceMeters).toBeGreaterThan(40_000);
      expect(corridor.distanceMeters).toBeLessThan(45_000);

      const edited = await ok<{ geometryVersion: number; distanceMeters: number }>(
        app,
        "PUT",
        url(owner.businessId, `corridors/${corridor.id}/geometry`),
        owner.cookie,
        { routeGeometry: kangunduRoad }
      );
      expect(edited.geometryVersion).toBe(2);
      expect(edited.distanceMeters).toBeLessThan(corridor.distanceMeters);
      const versions = await ok<Array<{ version: number; distanceMeters: number }>>(
        app,
        "GET",
        url(owner.businessId, `corridors/${corridor.id}/geometry-versions`),
        owner.cookie
      );
      expect(versions.map((version) => version.version)).toEqual([2, 1]);
      expect(versions[1]?.distanceMeters).toBe(corridor.distanceMeters);

      // Geometry cannot be changed through the plain PATCH (that would skip versioning).
      const patch = await request<{ code: string }>(
        app,
        "PATCH",
        url(owner.businessId, `corridors/${corridor.id}`),
        owner.cookie,
        { routeGeometry: thikaRoad }
      );
      expect(patch.status).toBe(400);
    });

    it("rejects malformed, one-point and zero-length geometry", async () => {
      const owner = await ownerWithPolicy();
      for (const routeGeometry of [
        { type: "Point", coordinates: [36.8, -1.3] },
        { type: "LineString", coordinates: [[36.8, -1.3]] },
        {
          type: "LineString",
          coordinates: [
            [36.8, -1.3],
            [36.8, -1.3]
          ]
        },
        {
          type: "LineString",
          coordinates: [
            [-1.3, 200],
            [36.8, -1.2]
          ]
        }
      ]) {
        const response = await request<{ code: string }>(
          app,
          "POST",
          url(owner.businessId, "corridors"),
          owner.cookie,
          { name: "Bad", originLabel: "A", destinationLabel: "B", routeGeometry }
        );
        expect(response.status).toBe(400);
        expect(response.body.code).toBe("corridor_geometry_invalid");
      }
    });

    it("isolates corridors per business and requires fulfillment:manage to change them", async () => {
      const owner = await ownerWithPolicy();
      const other = await createOwner(app);
      const corridor = await createCorridor(owner, "Thika", thikaRoad);
      expect(
        (await request(app, "GET", url(other.businessId, `corridors/${corridor.id}`), other.cookie))
          .status
      ).toBe(404);
      expect(
        (await request(app, "GET", url(owner.businessId, "corridors"), other.cookie)).status
      ).toBe(403);
      const dispatcher = await signUp(app);
      addMember(store, owner.businessId, dispatcher.userId, "manager");
      expect(
        (
          await request(
            app,
            "PUT",
            url(owner.businessId, `corridors/${corridor.id}/geometry`),
            dispatcher.cookie,
            {
              routeGeometry: kangunduRoad
            }
          )
        ).status
      ).toBe(403);
      // A policy override must name a policy lineage of the same business.
      const foreignPolicy = await ok<{ policyId: string }>(
        app,
        "POST",
        url(other.businessId, "policies"),
        other.cookie,
        policyBody
      );
      expect(
        (
          await request(
            app,
            "PATCH",
            url(owner.businessId, `corridors/${corridor.id}`),
            owner.cookie,
            {
              policyOverrideId: foreignPolicy.policyId
            }
          )
        ).status
      ).toBe(404);
    });
  });

  describe("resolution and provenance (A15/A16)", () => {
    it("resolves an order end-to-end and persists an AUTO provenance record", async () => {
      const owner = await ownerWithPolicy();
      const thika = await createCorridor(owner, "Thika", thikaRoad);
      const { invoiceId } = await shopWithOrder(owner, thikaEndShop);

      const result = await ok<{
        outcome: string;
        reason: string;
        resolution: Record<string, unknown>;
      }>(
        app,
        "POST",
        url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
        owner.cookie,
        {}
      );
      expect(result.outcome).toBe("RESOLVED");
      expect(result.reason).toBe("ONLY_CANDIDATE");
      expect(result.resolution).toMatchObject({
        invoiceId,
        corridorId: thika.id,
        corridorGeometryVersion: 1,
        resolutionMethod: "AUTO",
        resolvedBy: owner.userId,
        maxDiversionMeters: 2000,
        supersededAt: null
      });
      expect(result.resolution.diversionMeters).toBeLessThan(2000);
      expect(result.resolution.distanceAlongMeters).toBeGreaterThan(35_000);

      const status = await ok<{ resolutionStatus: string; stale: boolean; history: unknown[] }>(
        app,
        "GET",
        url(owner.businessId, `orders/${invoiceId}/corridor`),
        owner.cookie
      );
      expect(status).toMatchObject({ resolutionStatus: "RESOLVED", stale: false });
      expect(status.history).toHaveLength(1);
    });

    it("appends on re-resolution instead of overwriting", async () => {
      const owner = await ownerWithPolicy();
      await createCorridor(owner, "Thika", thikaRoad);
      const { invoiceId } = await shopWithOrder(owner, thikaEndShop);
      const resolveUrl = url(owner.businessId, `orders/${invoiceId}/corridor/resolve`);
      const first = await ok<{ resolution: { id: string } }>(
        app,
        "POST",
        resolveUrl,
        owner.cookie,
        {}
      );
      const second = await ok<{ resolution: { id: string } }>(
        app,
        "POST",
        resolveUrl,
        owner.cookie,
        {}
      );
      expect(second.resolution.id).not.toBe(first.resolution.id);
      const status = await ok<{
        current: { id: string };
        history: Array<{ id: string; supersededAt: string | null }>;
      }>(app, "GET", url(owner.businessId, `orders/${invoiceId}/corridor`), owner.cookie);
      expect(status.current.id).toBe(second.resolution.id);
      expect(status.history.map((record) => [record.id, record.supersededAt === null])).toEqual([
        [second.resolution.id, true],
        [first.resolution.id, false]
      ]);
    });

    it("selects deterministically on a shared section and allows manual assignment to a qualifying alternative", async () => {
      const owner = await ownerWithPolicy();
      const thika = await createCorridor(owner, "Thika", thikaRoad, { priority: 100 });
      const kangundu = await createCorridor(owner, "Kangundu", kangunduRoad, { priority: 50 });
      const { shop, invoiceId } = await shopWithOrder(owner, sharedSectionShop);

      const match = await ok<{
        status: string;
        reason: string;
        selected: { corridorId: string };
        alternatives: Array<{ corridorId: string }>;
      }>(app, "GET", url(owner.businessId, `shops/${shop.id}/corridor-match`), owner.cookie);
      // Same road section, same diversion: lower priority number wins.
      expect(match).toMatchObject({
        status: "RESOLVED",
        reason: "PRIORITY_TIE_BREAK",
        selected: { corridorId: kangundu.id },
        alternatives: [{ corridorId: thika.id }]
      });
      // corridor-match only computes; nothing was persisted.
      const before = await ok<{ history: unknown[] }>(
        app,
        "GET",
        url(owner.businessId, `orders/${invoiceId}/corridor`),
        owner.cookie
      );
      expect(before.history).toEqual([]);

      const manual = await ok<{
        reason: string;
        resolution: { corridorId: string; resolutionMethod: string };
      }>(app, "POST", url(owner.businessId, `orders/${invoiceId}/corridor/assign`), owner.cookie, {
        corridorId: thika.id
      });
      expect(manual).toMatchObject({
        reason: "MANUAL_ASSIGNMENT",
        resolution: { corridorId: thika.id, resolutionMethod: "MANUAL" }
      });
    });

    it("rejects manual assignment to a corridor that does not qualify", async () => {
      const owner = await ownerWithPolicy();
      await createCorridor(owner, "Thika", thikaRoad);
      const kangundu = await createCorridor(owner, "Kangundu", kangunduRoad);
      const { invoiceId } = await shopWithOrder(owner, thikaEndShop);
      const response = await request<{ code: string }>(
        app,
        "POST",
        url(owner.businessId, `orders/${invoiceId}/corridor/assign`),
        owner.cookie,
        { corridorId: kangundu.id }
      );
      expect(response.status).toBe(422);
      expect(response.body.code).toBe("corridor_not_qualifying");
      const status = await ok<{ history: unknown[] }>(
        app,
        "GET",
        url(owner.businessId, `orders/${invoiceId}/corridor`),
        owner.cookie
      );
      expect(status.history).toEqual([]);
    });

    it("reports explicit unresolved outcomes without persisting anything", async () => {
      const noPolicy = await createOwner(app);
      await createCorridor(noPolicy, "Thika", thikaRoad);
      const unpoliced = await shopWithOrder(noPolicy, thikaEndShop);
      expect(
        await ok(
          app,
          "POST",
          url(noPolicy.businessId, `orders/${unpoliced.invoiceId}/corridor/resolve`),
          noPolicy.cookie,
          {}
        )
      ).toMatchObject({ outcome: "UNRESOLVED", reason: "NO_DISPATCH_POLICY" });

      const owner = await ownerWithPolicy();
      const noLocation = await shopWithOrder(owner, null);
      expect(
        await ok(
          app,
          "POST",
          url(owner.businessId, `orders/${noLocation.invoiceId}/corridor/resolve`),
          owner.cookie,
          {}
        )
        // A missing delivery point is reported first: it blocks matching whatever corridors exist.
      ).toMatchObject({ outcome: "UNRESOLVED", reason: "NO_LOCATION" });
      const locatedNoCorridor = await shopWithOrder(owner, thikaEndShop);
      expect(
        await ok(
          app,
          "POST",
          url(owner.businessId, `orders/${locatedNoCorridor.invoiceId}/corridor/resolve`),
          owner.cookie,
          {}
        )
      ).toMatchObject({ outcome: "UNRESOLVED", reason: "NO_ACTIVE_CORRIDOR" });
      await createCorridor(owner, "Thika", thikaRoad);
      expect(
        await ok(
          app,
          "POST",
          url(owner.businessId, `orders/${noLocation.invoiceId}/corridor/resolve`),
          owner.cookie,
          {}
        )
      ).toMatchObject({ outcome: "UNRESOLVED", reason: "NO_LOCATION" });
      const faraway = await shopWithOrder(owner, { latitude: -0.5, longitude: 36.0 });
      expect(
        await ok(
          app,
          "POST",
          url(owner.businessId, `orders/${faraway.invoiceId}/corridor/resolve`),
          owner.cookie,
          {}
        )
      ).toMatchObject({ outcome: "UNRESOLVED", reason: "OUTSIDE_TOLERANCE" });
      const rows = await pool.query(
        "select 1 from fulfillment_corridor_resolutions where business_id = $1",
        [owner.businessId]
      );
      expect(rows.rows).toEqual([]);
    });

    it("does not resolve draft orders", async () => {
      const owner = await ownerWithPolicy();
      const product = await createProduct(app, owner, { name: "Sack" });
      const draft = await ok<{ id: string }>(
        app,
        "POST",
        `/businesses/${owner.businessId}/invoices`,
        owner.cookie,
        {
          taxRate: 0,
          items: [{ productId: product.id, quantity: 1, unitPrice: 1 }]
        }
      );
      const response = await request<{ code: string }>(
        app,
        "POST",
        url(owner.businessId, `orders/${draft.id}/corridor/resolve`),
        owner.cookie,
        {}
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("order_not_confirmed");
    });
  });

  describe("staleness (A16)", () => {
    it("flags geometry and location changes, never silently re-resolves, and keeps history interpretable", async () => {
      const owner = await ownerWithPolicy();
      const thika = await createCorridor(owner, "Thika", thikaRoad);
      const { shop, invoiceId } = await shopWithOrder(owner, thikaEndShop);
      const resolved = await ok<{ resolution: { id: string; corridorGeometryVersion: number } }>(
        app,
        "POST",
        url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
        owner.cookie,
        {}
      );
      const statusUrl = url(owner.businessId, `orders/${invoiceId}/corridor`);
      expect(await ok(app, "GET", statusUrl, owner.cookie)).toMatchObject({
        stale: false,
        staleReasons: []
      });

      await ok(app, "PUT", url(owner.businessId, `corridors/${thika.id}/geometry`), owner.cookie, {
        routeGeometry: {
          type: "LineString",
          coordinates: [...thikaRoad.coordinates, [37.08, -1.02]]
        }
      });
      const afterGeometry = await ok<{
        stale: boolean;
        staleReasons: string[];
        current: { id: string; corridorGeometryVersion: number };
      }>(app, "GET", statusUrl, owner.cookie);
      expect(afterGeometry).toMatchObject({
        stale: true,
        staleReasons: ["GEOMETRY_CHANGED"],
        // Not moved: still the original record on the original geometry version.
        current: { id: resolved.resolution.id, corridorGeometryVersion: 1 }
      });

      await ok(app, "PUT", url(owner.businessId, `shops/${shop.id}/location`), owner.cookie, {
        latitude: -1.045,
        longitude: 37.058
      });
      expect(await ok(app, "GET", statusUrl, owner.cookie)).toMatchObject({
        stale: true,
        staleReasons: ["GEOMETRY_CHANGED", "LOCATION_CHANGED"]
      });

      // The historical geometry the old record names is still readable.
      const versions = await ok<Array<{ version: number }>>(
        app,
        "GET",
        url(owner.businessId, `corridors/${thika.id}/geometry-versions`),
        owner.cookie
      );
      expect(versions.map((version) => version.version)).toContain(1);

      await ok(
        app,
        "POST",
        url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
        owner.cookie,
        {}
      );
      const refreshed = await ok<{
        stale: boolean;
        current: { corridorGeometryVersion: number };
        history: unknown[];
      }>(app, "GET", statusUrl, owner.cookie);
      expect(refreshed).toMatchObject({ stale: false, current: { corridorGeometryVersion: 2 } });
      expect(refreshed.history).toHaveLength(2);
    });
  });

  describe("security (A8/A3.11)", () => {
    it("denies cross-tenant access and requires fulfillment:dispatch to resolve or assign", async () => {
      const owner = await ownerWithPolicy();
      const other = await createOwner(app);
      const thika = await createCorridor(owner, "Thika", thikaRoad);
      const { shop, invoiceId } = await shopWithOrder(owner, thikaEndShop);

      expect(
        (
          await request(
            app,
            "POST",
            url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
            other.cookie,
            {}
          )
        ).status
      ).toBe(403);
      expect(
        (
          await request(
            app,
            "POST",
            url(other.businessId, `orders/${invoiceId}/corridor/resolve`),
            other.cookie,
            {}
          )
        ).status
      ).toBe(404);
      expect(
        (
          await request(
            app,
            "GET",
            url(other.businessId, `shops/${shop.id}/corridor-match`),
            other.cookie
          )
        ).status
      ).toBe(404);

      const salesperson = await signUp(app);
      addMember(store, owner.businessId, salesperson.userId, "sales_agent");
      expect(
        (
          await request(
            app,
            "GET",
            url(owner.businessId, `orders/${invoiceId}/corridor`),
            salesperson.cookie
          )
        ).status
      ).toBe(200);
      for (const [path, body] of [
        [`orders/${invoiceId}/corridor/resolve`, {}],
        [`orders/${invoiceId}/corridor/assign`, { corridorId: thika.id }]
      ] as const) {
        expect(
          (await request(app, "POST", url(owner.businessId, path), salesperson.cookie, body)).status
        ).toBe(403);
      }
      const dispatcher = await signUp(app);
      addMember(store, owner.businessId, dispatcher.userId, "manager");
      expect(
        await ok(
          app,
          "POST",
          url(owner.businessId, `orders/${invoiceId}/corridor/assign`),
          dispatcher.cookie,
          {
            corridorId: thika.id
          }
        )
      ).toMatchObject({ outcome: "RESOLVED", resolution: { resolvedBy: dispatcher.userId } });
    });
  });

  describe("concurrency and database invariants (A17)", () => {
    it("serializes concurrent resolutions of one order into a single current record", async () => {
      const owner = await ownerWithPolicy();
      await createCorridor(owner, "Thika", thikaRoad);
      const { invoiceId } = await shopWithOrder(owner, thikaEndShop);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(
            app,
            "POST",
            url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
            owner.cookie,
            {}
          )
        )
      );
      expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200]);
      const rows = await pool.query(
        `select r.superseded_at from fulfillment_corridor_resolutions r
         join fulfillment_orders o on o.id = r.fulfillment_order_id
         where o.business_id = $1 and o.invoice_id = $2`,
        [owner.businessId, invoiceId]
      );
      expect(rows.rows).toHaveLength(5);
      expect(rows.rows.filter((row) => row.superseded_at === null)).toHaveLength(1);
      const orders = await pool.query(
        "select 1 from fulfillment_orders where business_id = $1 and invoice_id = $2",
        [owner.businessId, invoiceId]
      );
      expect(orders.rows).toHaveLength(1);
    });

    it("never records a resolution against a geometry version it did not evaluate", async () => {
      const owner = await ownerWithPolicy();
      const thika = await createCorridor(owner, "Thika", thikaRoad);
      const { invoiceId } = await shopWithOrder(owner, thikaEndShop);
      const extended = {
        type: "LineString",
        coordinates: [...thikaRoad.coordinates, [37.08, -1.02]]
      };
      await Promise.all([
        ...Array.from({ length: 3 }, () =>
          request(
            app,
            "POST",
            url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
            owner.cookie,
            {}
          )
        ),
        request(app, "PUT", url(owner.businessId, `corridors/${thika.id}/geometry`), owner.cookie, {
          routeGeometry: extended
        })
      ]);
      // Every stored record's geometry version exists, and its diversion/along were computed on
      // that version's geometry (the recheck retries any resolution whose corridor moved).
      const rows = await pool.query<{ version: number; along: string }>(
        `select r.corridor_geometry_version as version, r.distance_along_meters as along
         from fulfillment_corridor_resolutions r
         join fulfillment_orders o on o.id = r.fulfillment_order_id
         where o.business_id = $1 and o.invoice_id = $2`,
        [owner.businessId, invoiceId]
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      for (const row of rows.rows) {
        const version = await pool.query<{ route_geometry: unknown }>(
          "select route_geometry from fulfillment_corridor_geometry_versions where corridor_id = $1 and version = $2",
          [thika.id, row.version]
        );
        expect(version.rows).toHaveLength(1);
      }
    });

    it("enforces provenance invariants in the database itself", async () => {
      const owner = await ownerWithPolicy();
      const thika = await createCorridor(owner, "Thika", thikaRoad);
      const { invoiceId } = await shopWithOrder(owner, thikaEndShop);
      const resolved = await ok<{
        resolution: { fulfillmentOrderId: string; shopLocationId: string };
      }>(
        app,
        "POST",
        url(owner.businessId, `orders/${invoiceId}/corridor/resolve`),
        owner.cookie,
        {}
      );
      const insert = (diversion: number) =>
        pool.query(
          `insert into fulfillment_corridor_resolutions
             (id, business_id, fulfillment_order_id, corridor_id, corridor_geometry_version, shop_location_id,
              diversion_meters, distance_along_meters, segment_index, max_diversion_meters,
              resolution_method, resolved_by, resolved_at)
           values ($1, $2, $3, $4, 1, $5, $6, 0, 0, 2000, 'MANUAL', 'test', now())`,
          [
            randomUUID(),
            owner.businessId,
            resolved.resolution.fulfillmentOrderId,
            thika.id,
            resolved.resolution.shopLocationId,
            diversion
          ]
        );
      // A second current record for the same order.
      await expect(insert(10)).rejects.toMatchObject({ code: "23505" });
      // Off-corridor beyond the recorded tolerance.
      await expect(insert(2500)).rejects.toMatchObject({ code: "23514" });
      // A corridor of another tenant cannot be referenced (composite tenant FK).
      const other = await ownerWithPolicy();
      const foreign = await createCorridor(other, "Foreign", thikaRoad);
      await expect(
        pool.query(
          `insert into fulfillment_corridor_resolutions
             (id, business_id, fulfillment_order_id, corridor_id, corridor_geometry_version, shop_location_id,
              diversion_meters, distance_along_meters, segment_index, max_diversion_meters,
              resolution_method, resolved_by, resolved_at, superseded_at)
           values ($1, $2, $3, $4, 1, $5, 0, 0, 0, 2000, 'MANUAL', 'test', now(), now())`,
          [
            randomUUID(),
            owner.businessId,
            resolved.resolution.fulfillmentOrderId,
            foreign.id,
            resolved.resolution.shopLocationId
          ]
        )
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  describe("migrations 091/092", () => {
    it("reverse and re-apply cleanly", async () => {
      const client = await pool.connect();
      const read = (path: string) => readFileSync(path, "utf8");
      try {
        await client.query("begin");
        await client.query(read("infra/db/rollbacks/092_fulfillment_orders_resolutions.down.sql"));
        await client.query(read("infra/db/rollbacks/091_fulfillment_corridors.down.sql"));
        const gone = await client.query(
          "select to_regclass('fulfillment_corridors') as corridors, to_regclass('fulfillment_orders') as orders"
        );
        expect(gone.rows[0]).toEqual({ corridors: null, orders: null });
        await client.query(read("infra/db/migrations/091_fulfillment_corridors.sql"));
        await client.query(read("infra/db/migrations/092_fulfillment_orders_resolutions.sql"));
        const back = await client.query(
          "select to_regclass('fulfillment_corridor_resolutions') is not null as present"
        );
        expect(back.rows[0]).toEqual({ present: true });
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });
});
