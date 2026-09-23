import { expect } from "vitest";
import type { BusinessRole } from "../../packages/shared-types/src";
import type { buildApi } from "../../services/api/src/app";
import type { Cp2Store } from "../../services/api/src/cp2/store";

export type TestApp = ReturnType<typeof buildApi>;

export interface TestOwner {
  businessId: string;
  userId: string;
  cookie: string;
}

let phoneCounter = 0;

/** A unique Kenyan mobile number per call, so parallel/shared-DB tests never collide. */
export function uniquePhone(): string {
  phoneCounter += 1;
  const suffix = `${Date.now() % 1_000_000}${phoneCounter}`.slice(-6).padStart(6, "0");
  return `2547${String(phoneCounter % 100).padStart(2, "0")}${suffix}`.slice(0, 12);
}

export async function signUp(app: TestApp, contact = uniquePhone()) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ method: "phone", contact, pin: "1234" })
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(";")[0] ?? "";
  const body = response.json<{ user: { id: string } }>();
  return { cookie, userId: body.user.id };
}

export async function createOwner(app: TestApp, name = "Corridor Wholesale"): Promise<TestOwner> {
  const { cookie, userId } = await signUp(app);
  const business = await request<{ business: { id: string } }>(app, "POST", "/businesses", cookie, {
    name,
    language: "en"
  });
  return { businessId: business.body.business.id, userId, cookie };
}

/** Adds `userId` to `businessId` with `role` (there is no staff-invitation API yet). */
export function addMember(
  store: Cp2Store,
  businessId: string,
  userId: string,
  role: BusinessRole
): void {
  const snapshot = store.snapshot();
  store.hydrateSnapshot({
    ...snapshot,
    memberships: [
      ...snapshot.memberships,
      { id: `membership-${role}-${userId}`, businessId, userId, role }
    ]
  });
}

export async function request<T>(
  app: TestApp,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  cookie: string | undefined,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie === undefined ? {} : { cookie }),
      ...headers
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
  });
  return { status: response.statusCode, body: response.json<T>() };
}

export async function ok<T>(
  app: TestApp,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  cookie: string | undefined,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await request<T>(app, method, url, cookie, payload, headers);
  if (response.status !== 200) {
    throw new Error(`${method} ${url} -> ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

export async function createProduct(
  app: TestApp,
  owner: TestOwner,
  input: {
    name: string;
    unit?: string;
    quantity?: number;
    sellingPrice?: number;
    unitWeightGrams?: string | null;
    fieldValues?: Record<string, string>;
  }
) {
  return ok<{ id: string; unitWeightGrams?: string | null }>(
    app,
    "POST",
    `/businesses/${owner.businessId}/products`,
    owner.cookie,
    { quantity: 1000, sellingPrice: 100, unit: "unit", ...input }
  );
}

export async function createCustomer(app: TestApp, owner: TestOwner, name = "Mama Njeri Shop") {
  return ok<{ id: string }>(
    app,
    "POST",
    `/businesses/${owner.businessId}/customers`,
    owner.cookie,
    {
      name
    }
  );
}

export async function confirmInvoice(
  app: TestApp,
  owner: TestOwner,
  input: {
    customerId?: string;
    items: Array<{ productId: string; quantity: number }>;
    fulfillmentMethod?: "delivery" | "pickup";
    source?: string;
  }
) {
  const draft = await ok<{ id: string }>(
    app,
    "POST",
    `/businesses/${owner.businessId}/invoices`,
    owner.cookie,
    {
      ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
      ...(input.source === undefined ? {} : { source: input.source }),
      taxRate: 0,
      items: input.items.map((item) => ({ ...item, unitPrice: 100 }))
    }
  );
  return ok<{
    invoice: {
      id: string;
      items: Array<{
        id: string;
        productId: string;
        unitWeightGramsSnapshot?: string | null;
        totalWeightGrams?: string | null;
        weightStatus?: string | null;
        weightUnresolvedReason?: string | null;
      }>;
    };
    logistics?: { id: string; method: string; status: string };
  }>(
    app,
    "POST",
    `/businesses/${owner.businessId}/invoices/${draft.id}/confirm`,
    owner.cookie,
    input.fulfillmentMethod === undefined ? {} : { fulfillmentMethod: input.fulfillmentMethod }
  );
}

/**
 * Rolls back every migration from the newest down to `fromPrefix` (inclusive) in reverse order,
 * like `db:rollback`, runs `between`, then re-applies them in order. Later migrations reference
 * earlier fulfillment tables, so a migration can only be reversed together with everything after
 * it. Run inside a transaction the caller rolls back.
 */
export async function withMigrationsReversed(
  client: { query: (sql: string) => Promise<unknown> },
  fromPrefix: string,
  between: () => Promise<void>
): Promise<void> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const migrations = readdirSync("infra/db/migrations")
    .filter((name) => name.endsWith(".sql") && name >= fromPrefix)
    .sort();
  for (const name of [...migrations].reverse()) {
    await client.query(
      readFileSync(`infra/db/rollbacks/${name.replace(/\.sql$/u, ".down.sql")}`, "utf8")
    );
  }
  await between();
  for (const name of migrations) {
    await client.query(readFileSync(`infra/db/migrations/${name}`, "utf8"));
  }
}
