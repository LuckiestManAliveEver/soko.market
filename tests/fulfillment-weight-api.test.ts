import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import {
  addMember,
  confirmInvoice,
  createCustomer,
  createOwner,
  createProduct,
  ok,
  request,
  signUp
} from "./fixtures/fulfillment-test-helpers";

function setup() {
  const store = createCp2Store();
  const app = buildApi({ cp2: { store } });
  return { store, app };
}

describe("product unit weight (A4)", () => {
  it("stores, preserves, clears and validates unitWeightGrams through the product API", async () => {
    const { app } = setup();
    const owner = await createOwner(app);
    const sack = await createProduct(app, owner, {
      name: "Maize 90kg sack",
      unitWeightGrams: "90000"
    });
    expect(sack.unitWeightGrams).toBe("90000");

    const url = `/businesses/${owner.businessId}/products/${sack.id}`;
    // An edit that omits the field keeps the existing weight.
    const renamed = await ok<{ unitWeightGrams: string | null }>(app, "PATCH", url, owner.cookie, {
      name: "Maize sack (90kg)",
      quantity: 1000
    });
    expect(renamed.unitWeightGrams).toBe("90000");

    const cleared = await ok<{ unitWeightGrams: string | null }>(app, "PATCH", url, owner.cookie, {
      name: "Maize sack (90kg)",
      quantity: 1000,
      unitWeightGrams: null
    });
    expect(cleared.unitWeightGrams).toBeNull();

    for (const bad of ["0", "-90000", "90.5", 90000, "90kg"]) {
      const response = await request<{ code: string }>(app, "PATCH", url, owner.cookie, {
        name: "Maize sack",
        quantity: 1000,
        unitWeightGrams: bad
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("unit_weight_grams_invalid");
    }
    const withoutWeight = await createProduct(app, owner, { name: "Loose tomatoes" });
    expect(withoutWeight.unitWeightGrams).toBeNull();
    await app.close();
  });
});

describe("order-line weight snapshots and canonical order weight (A4/A5)", () => {
  it("snapshots at confirmation and is unaffected by later catalogue edits", async () => {
    const { app } = setup();
    const owner = await createOwner(app);
    const shop = await createCustomer(app, owner);
    const sack = await createProduct(app, owner, { name: "Maize sack", unitWeightGrams: "90000" });
    const carton = await createProduct(app, owner, {
      name: "Soap carton",
      unitWeightGrams: "12000"
    });

    const { invoice } = await confirmInvoice(app, owner, {
      customerId: shop.id,
      items: [
        { productId: sack.id, quantity: 10 },
        { productId: carton.id, quantity: 5 }
      ]
    });
    expect(
      invoice.items.map((item) => [item.unitWeightGramsSnapshot, item.totalWeightGrams])
    ).toEqual([
      ["90000", "900000"],
      ["12000", "60000"]
    ]);

    const weightUrl = `/businesses/${owner.businessId}/invoices/${invoice.id}/fulfillment-weight`;
    expect(await ok(app, "GET", weightUrl, owner.cookie)).toEqual({
      status: "RESOLVED",
      totalWeightGrams: "960000"
    });

    // Catalogue edit after confirmation: the historical snapshot and order weight do not move.
    await ok(app, "PATCH", `/businesses/${owner.businessId}/products/${sack.id}`, owner.cookie, {
      name: "Maize sack",
      quantity: 1000,
      unitWeightGrams: "50000"
    });
    expect(await ok(app, "GET", weightUrl, owner.cookie)).toEqual({
      status: "RESOLVED",
      totalWeightGrams: "960000"
    });
    const invoices = await ok<Array<{ id: string; items: Array<{ totalWeightGrams?: string }> }>>(
      app,
      "GET",
      `/businesses/${owner.businessId}/invoices`,
      owner.cookie
    );
    expect(invoices.find((entry) => entry.id === invoice.id)?.items[0]?.totalWeightGrams).toBe(
      "900000"
    );
    await app.close();
  });

  it("reports unknown weight as UNRESOLVED with the offending lines, never zero", async () => {
    const { app } = setup();
    const owner = await createOwner(app);
    const sack = await createProduct(app, owner, { name: "Maize sack", unitWeightGrams: "90000" });
    const loose = await createProduct(app, owner, { name: "Loose tomatoes" });
    const oddGram = await createProduct(app, owner, { name: "Spice sachet", unitWeightGrams: "3" });

    const { invoice } = await confirmInvoice(app, owner, {
      items: [
        { productId: sack.id, quantity: 1 },
        { productId: loose.id, quantity: 2 },
        { productId: oddGram.id, quantity: 0.5 }
      ]
    });
    const [, looseLine, oddLine] = invoice.items;
    expect(looseLine).toMatchObject({ weightStatus: "UNRESOLVED", totalWeightGrams: null });
    expect(oddLine).toMatchObject({
      weightStatus: "UNRESOLVED",
      weightUnresolvedReason: "NON_INTEGRAL_WEIGHT"
    });
    expect(
      await ok(
        app,
        "GET",
        `/businesses/${owner.businessId}/invoices/${invoice.id}/fulfillment-weight`,
        owner.cookie
      )
    ).toEqual({
      status: "UNRESOLVED",
      unresolvedLineIds: [looseLine?.id, oddLine?.id],
      unresolvedLines: [
        { lineId: looseLine?.id, reason: "MISSING_UNIT_WEIGHT" },
        { lineId: oddLine?.id, reason: "NON_INTEGRAL_WEIGHT" }
      ]
    });
    await app.close();
  });

  it("does not expose one business's order weight to another business", async () => {
    const { app } = setup();
    const owner = await createOwner(app, "Wholesaler A");
    const other = await createOwner(app, "Wholesaler B");
    const sack = await createProduct(app, owner, { name: "Maize sack", unitWeightGrams: "90000" });
    const { invoice } = await confirmInvoice(app, owner, {
      items: [{ productId: sack.id, quantity: 1 }]
    });

    const crossTenant = await request(
      app,
      "GET",
      `/businesses/${owner.businessId}/invoices/${invoice.id}/fulfillment-weight`,
      other.cookie
    );
    expect(crossTenant.status).toBe(403);
    const wrongScope = await request(
      app,
      "GET",
      `/businesses/${other.businessId}/invoices/${invoice.id}/fulfillment-weight`,
      other.cookie
    );
    expect(wrongScope.status).toBe(404);
    await app.close();
  });
});

describe("business timezone (A11)", () => {
  it("is unset by default and only an owner can configure a valid IANA zone", async () => {
    const { app, store } = setup();
    const owner = await createOwner(app);
    const settingsUrl = `/businesses/${owner.businessId}/fulfillment/settings`;
    expect(await ok(app, "GET", settingsUrl, owner.cookie)).toEqual({
      businessId: owner.businessId,
      timezone: null,
      viewerCanManage: true
    });

    const invalid = await request<{ code: string }>(app, "PATCH", settingsUrl, owner.cookie, {
      timezone: "Nairobi"
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("timezone_invalid");

    expect(
      await ok(app, "PATCH", settingsUrl, owner.cookie, { timezone: "Africa/Nairobi" })
    ).toEqual({
      businessId: owner.businessId,
      timezone: "Africa/Nairobi",
      viewerCanManage: true
    });

    // Optimistic concurrency: a stale expectedTimezone is refused, never applied.
    const stale = await request<{ code: string; details: { timezone: string } }>(
      app,
      "PATCH",
      settingsUrl,
      owner.cookie,
      { timezone: "Africa/Kampala", expectedTimezone: null }
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: "timezone_changed",
      details: { timezone: "Africa/Nairobi" }
    });
    expect((await ok<{ timezone: string }>(app, "GET", settingsUrl, owner.cookie)).timezone).toBe(
      "Africa/Nairobi"
    );
    expect(
      await ok(app, "PATCH", settingsUrl, owner.cookie, {
        timezone: "Africa/Nairobi",
        expectedTimezone: "Africa/Nairobi"
      })
    ).toMatchObject({ timezone: "Africa/Nairobi" });
    // Repeating your own write (a retry after a lost response) succeeds: the stored value is
    // already what you asked for, so there is nothing to conflict with.
    expect(
      await ok(app, "PATCH", settingsUrl, owner.cookie, {
        timezone: "Africa/Nairobi",
        expectedTimezone: null
      })
    ).toMatchObject({ timezone: "Africa/Nairobi" });

    // A dispatcher (manager) can read but not manage settings; a cashier cannot even read.
    const dispatcher = await signUp(app);
    addMember(store, owner.businessId, dispatcher.userId, "manager");
    const cashier = await signUp(app);
    addMember(store, owner.businessId, cashier.userId, "cashier");
    const dispatcherView = await request(app, "GET", settingsUrl, dispatcher.cookie);
    expect(dispatcherView.status).toBe(200);
    // The server tells the UI the dispatcher may read but not manage (no client role table).
    expect(dispatcherView.body).toEqual({
      businessId: owner.businessId,
      timezone: "Africa/Nairobi",
      viewerCanManage: false
    });
    expect(
      (await request(app, "PATCH", settingsUrl, dispatcher.cookie, { timezone: "UTC" })).status
    ).toBe(403);
    expect((await request(app, "GET", settingsUrl, cashier.cookie)).status).toBe(403);

    const outsider = await createOwner(app, "Another wholesaler");
    expect(
      (await request(app, "PATCH", settingsUrl, outsider.cookie, { timezone: "UTC" })).status
    ).toBe(403);
    await app.close();
  });
});

describe("memory mode (decision D2)", () => {
  it("answers 503 fulfillment_requires_postgres for Postgres-authoritative operations", async () => {
    const { app } = setup();
    const owner = await createOwner(app);
    for (const [method, path, payload] of [
      ["GET", "fulfillment/vehicles", undefined],
      ["POST", "fulfillment/vehicles", { name: "Truck", capacityGrams: "7000000" }],
      ["GET", "fulfillment/policies", undefined],
      ["GET", "fulfillment/default-policy", undefined]
    ] as const) {
      const response = await request<{ code: string }>(
        app,
        method,
        `/businesses/${owner.businessId}/${path}`,
        owner.cookie,
        payload
      );
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("fulfillment_requires_postgres");
    }
    await app.close();
  });
});
