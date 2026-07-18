import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

describe("storefront interaction contracts", () => {
  it("persists presence, invites, public care, messages, and order requests", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "254700000071", "Contract Shop", "4172");

    const presence = await injectJson(
      app,
      "PATCH",
      `/businesses/${owner.business.id}/presence`,
      {
        status: "private"
      },
      owner.cookie
    );
    expect(presence).toMatchObject({ businessId: owner.business.id, status: "private" });

    const inviteResult = await injectJson(
      app,
      "POST",
      `/businesses/${owner.business.id}/network/invites`,
      {
        contacts: [
          { name: "Phone contact", phone: "+254700000072", email: null },
          { name: "Email contact", phone: null, email: "invite@example.com" }
        ]
      },
      owner.cookie
    );
    expect(inviteResult.invites).toHaveLength(2);
    expect(inviteResult.invites.map((invite: { status: string }) => invite.status)).toEqual([
      "queued",
      "queued"
    ]);

    const product = await injectJson(
      app,
      "POST",
      `/businesses/${owner.business.id}/products`,
      { name: "Contract item", unit: "unit", quantity: 4 },
      owner.cookie
    );
    const care = await injectJson(
      app,
      "POST",
      `/public/storefronts/${owner.business.sokoId}/customer-care`,
      { type: "callback", customerName: "Public Buyer", phone: "+254700000073", message: "Call me" }
    );
    const message = await injectJson(
      app,
      "POST",
      `/public/storefronts/${owner.business.sokoId}/messages`,
      { visitorId: "visitor-contract-1", body: "Is this available?", attachmentNames: [] }
    );
    const order = await injectJson(
      app,
      "POST",
      `/public/storefronts/${owner.business.sokoId}/orders`,
      {
        visitorId: "visitor-contract-1",
        customerName: "Public Buyer",
        phone: "+254700000073",
        note: "Collect tomorrow",
        items: [{ productId: product.id, quantity: 2 }]
      }
    );

    expect(care).toMatchObject({ businessId: owner.business.id, status: "new", type: "callback" });
    expect(message).toMatchObject({ businessId: owner.business.id, body: "Is this available?" });
    expect(order).toMatchObject({ businessId: owner.business.id, status: "requested" });
    expect(order.items).toEqual([
      { productId: product.id, productName: "Contract item", unit: "unit", quantity: 2 }
    ]);

    const storefront = await injectJson(app, "GET", `/public/storefronts/${owner.business.sokoId}`);
    expect(storefront.presence.status).toBe("private");

    const snapshot = store.snapshot();
    expect(snapshot.shopPresences).toHaveLength(1);
    expect(snapshot.networkInvites).toHaveLength(2);
    expect(snapshot.publicCustomerCareRequests).toHaveLength(1);
    expect(snapshot.publicStorefrontMessages).toHaveLength(1);
    expect(snapshot.publicOrders).toHaveLength(1);

    const hydrated = createCp2Store();
    hydrated.hydrateSnapshot(snapshot);
    expect(hydrated.snapshot().publicOrders).toEqual(snapshot.publicOrders);
    await app.close();
  });

  it("requires authenticated PIN re-verification to restore an account during recovery", async () => {
    const app = buildApi();
    const owner = await createOwnerBusiness(app, "254700000081", "Restorable Shop", "5283");

    const deletionResponse = await app.inject({
      method: "POST",
      url: `/businesses/${owner.business.id}/compliance/account-deletion`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ confirmation: "DELETE", reason: "Contract test" })
    });
    expect(deletionResponse.statusCode).toBe(200);
    const deletion = deletionResponse.json<{ id: string; status: string }>();
    expect(deletion.status).toBe("scheduled");

    const login = await app.inject({
      method: "POST",
      url: "/auth/pin/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({ channel: "phone", destination: "254700000081", pin: "5283" })
    });
    expect(login.statusCode).toBe(200);
    const recoveryCookie = extractSessionCookie(login.headers["set-cookie"]);

    const blocked = await app.inject({
      method: "POST",
      url: "/roles/check",
      headers: jsonHeaders(recoveryCookie),
      payload: JSON.stringify({ businessId: owner.business.id, role: "owner" })
    });
    expect(blocked.statusCode).toBe(410);
    expect(blocked.json()).toMatchObject({ code: "account_pending_deletion" });

    const requests = await injectJson(
      app,
      "GET",
      "/account-restoration/requests",
      undefined,
      recoveryCookie
    );
    expect(requests.requests).toHaveLength(1);

    const wrongPin = await app.inject({
      method: "POST",
      url: `/account-restoration/${deletion.id}`,
      headers: jsonHeaders(recoveryCookie),
      payload: JSON.stringify({ pin: "0000" })
    });
    expect(wrongPin.statusCode).toBe(401);

    const restored = await injectJson(
      app,
      "POST",
      `/account-restoration/${deletion.id}`,
      { pin: "5283" },
      recoveryCookie
    );
    expect(restored.request.status).toBe("RESTORED");
    expect(restored.business.id).toBe(owner.business.id);
    expect(restored.membership.role).toBe("owner");

    const allowed = await app.inject({
      method: "POST",
      url: "/roles/check",
      headers: jsonHeaders(recoveryCookie),
      payload: JSON.stringify({ businessId: owner.business.id, role: "owner" })
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });
});

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  destination: string,
  name: string,
  pin: string
) {
  const verify = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: jsonHeaders(),
    payload: JSON.stringify({ method: "phone", contact: destination, pin })
  });
  const cookie = extractSessionCookie(verify.headers["set-cookie"]);
  const business = await injectJson(app, "POST", "/businesses", { name, language: "en" }, cookie);
  return { business: business.business as { id: string; sokoId: string }, cookie };
}

async function injectJson(
  app: ReturnType<typeof buildApi>,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
  cookie?: string
  // Test response shapes are asserted at each call site; Fastify injection returns untyped JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await app.inject({
    method,
    url,
    headers: jsonHeaders(cookie),
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
  });
  expect(response.statusCode, response.body).toBeGreaterThanOrEqual(200);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.json();
}

function jsonHeaders(cookie?: string) {
  return { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) throw new Error("Missing session cookie");
  return raw.split(";")[0] ?? raw;
}
