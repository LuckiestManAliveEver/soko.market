import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import type { OtpProvider } from "../services/api/src/cp2/otp-provider";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface SessionResponse {
  account: {
    id: string;
  };
  session: {
    id: string;
  };
}

interface BusinessResponse {
  business: {
    id: string;
    sokoId: string;
  };
}

interface ProductResponse {
  id: string;
}

interface ShopDeletionRequestResponse {
  request: {
    id: string;
    status: string;
  };
  otp: {
    devOtp: string;
  };
  preview: {
    counts: {
      products: number;
    };
  };
}

describe("Shop profile lifecycle", () => {
  it("uses external phone verification and never exposes a deletion development OTP", async () => {
    const store = createCp2Store();
    const providerRequests: string[] = [];
    const providerVerifications: string[] = [];
    const otpProvider: OtpProvider = {
      name: "firebase_test",
      exposesDevOtp: false,
      verifiesExternally: true,
      canHandle: (channel) => channel === "phone",
      requestOtp: async ({ destination }) => {
        providerRequests.push(destination);
      },
      verifyOtp: async ({ destination, code }) => {
        providerVerifications.push(destination);
        return code === "firebase-id-token";
      }
    };
    const app = buildApi({ cp2: { store, otpProvider } });
    const phone = "+254700000709";
    const otpRequest = await postJson<{ challengeId: string }>(
      app,
      "/auth/otp/request",
      { method: "phone", contact: phone, deliveryChannel: "sms" }
    );
    const owner = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: phone,
        challengeId: otpRequest.challengeId,
        firebaseIdToken: "firebase-id-token"
      })
    });
    expect(owner.statusCode).toBe(200);
    const ownerCookie = extractSessionCookie(owner.headers["set-cookie"]);
    await postJson<SessionResponse>(app, "/auth/pin/setup", { pin: "1234" }, ownerCookie);
    const shop = await postJson<BusinessResponse>(
      app,
      "/businesses",
      { name: "Firebase Delete", language: "en" },
      ownerCookie
    );

    const deletion = await postJson<
      ShopDeletionRequestResponse & { otp: { channel: string; devOtp?: string } }
    >(
      app,
      `/businesses/${shop.business.id}/shop-deletion/request`,
      { shopId: shop.business.sokoId },
      ownerCookie
    );
    expect(deletion.otp).toMatchObject({ channel: "phone" });
    expect(deletion.otp.devOtp).toBeUndefined();

    const completed = await postJson<{ status: string }>(
      app,
      `/businesses/${shop.business.id}/shop-deletion/${deletion.request.id}/finalize`,
      {
        pin: "1234",
        firebaseIdToken: "firebase-id-token",
        acknowledgement: true,
        idempotencyKey: "firebase-delete-shop"
      },
      ownerCookie
    );
    expect(completed.status).toBe("COMPLETED");
    expect(store.snapshot().businesses).toHaveLength(0);
    expect(providerRequests).toEqual([phone, phone]);
    expect(providerVerifications).toEqual([phone, phone]);

    await app.close();
  });

  it("requires owner, exact shop ID, PIN and OTP before tenant-scoped shop deletion", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const owner = await verifyOtp(app, "phone", "254700000701");
    const ownerCookie = extractSessionCookie(owner.setCookie);

    await postJson<SessionResponse>(app, "/auth/pin/setup", { pin: "1234" }, ownerCookie);
    const firstShop = await postJson<BusinessResponse>(
      app,
      "/businesses",
      { name: "Delete Me", language: "en" },
      ownerCookie
    );
    const secondShop = await postJson<BusinessResponse>(
      app,
      "/businesses",
      { name: "Keep Me", language: "en" },
      ownerCookie
    );
    await postJson<ProductResponse>(
      app,
      `/businesses/${firstShop.business.id}/products`,
      { name: "Sugar", unit: "kg", quantity: 3 },
      ownerCookie
    );
    await postJson<ProductResponse>(
      app,
      `/businesses/${secondShop.business.id}/products`,
      { name: "Rice", unit: "kg", quantity: 2 },
      ownerCookie
    );

    const nonOwner = await verifyOtp(app, "phone", "254700000702");
    const nonOwnerRequest = await app.inject({
      method: "POST",
      url: `/businesses/${firstShop.business.id}/shop-deletion/request`,
      headers: {
        ...jsonHeaders(),
        cookie: extractSessionCookie(nonOwner.setCookie)
      },
      payload: JSON.stringify({ shopId: firstShop.business.sokoId })
    });
    expect(nonOwnerRequest.statusCode).toBe(403);

    const wrongShopId = await app.inject({
      method: "POST",
      url: `/businesses/${firstShop.business.id}/shop-deletion/request`,
      headers: {
        ...jsonHeaders(),
        cookie: ownerCookie
      },
      payload: JSON.stringify({ shopId: "DELETE" })
    });
    expect(wrongShopId.statusCode).toBe(400);
    expect(wrongShopId.json()).toMatchObject({ code: "shop_id_mismatch" });

    const deletion = await postJson<ShopDeletionRequestResponse>(
      app,
      `/businesses/${firstShop.business.id}/shop-deletion/request`,
      { shopId: firstShop.business.sokoId },
      ownerCookie
    );
    expect(deletion.request.status).toBe("PENDING_VERIFICATION");
    expect(deletion.preview.counts.products).toBe(1);

    const badOtp = await app.inject({
      method: "POST",
      url: `/businesses/${firstShop.business.id}/shop-deletion/${deletion.request.id}/finalize`,
      headers: {
        ...jsonHeaders(),
        cookie: ownerCookie
      },
      payload: JSON.stringify({
        pin: "1234",
        otpCode: "000000",
        acknowledgement: true,
        idempotencyKey: "delete-first-shop"
      })
    });
    expect(badOtp.statusCode).toBe(401);

    const completed = await postJson<{ status: string }>(
      app,
      `/businesses/${firstShop.business.id}/shop-deletion/${deletion.request.id}/finalize`,
      {
        pin: "1234",
        otpCode: deletion.otp.devOtp,
        acknowledgement: true,
        idempotencyKey: "delete-first-shop"
      },
      ownerCookie
    );
    expect(completed.status).toBe("COMPLETED");

    const snapshot = store.snapshot();
    expect(snapshot.businesses.map((business) => business.id)).not.toContain(firstShop.business.id);
    expect(snapshot.businesses.map((business) => business.id)).toContain(secondShop.business.id);
    expect(snapshot.products.map((product) => product.name)).toEqual(["Rice"]);
    expect(snapshot.auditEvents.some((event) => event.type === "shop_deletion.completed")).toBe(
      true
    );
    const ownerRelogin = await verifyOtp(app, "phone", "254700000701");
    const syncPage = await getJson<{
      changes: Array<{
        collection: string;
        entityId: string;
        operation: string;
        entity: unknown | null;
        tombstoneExpiresAt: string | null;
      }>;
    }>(app, "/v1/sync/changes?limit=100", extractSessionCookie(ownerRelogin.setCookie));
    expect(syncPage.changes).toContainEqual(
      expect.objectContaining({
        collection: "shops",
        entityId: firstShop.business.id,
        operation: "delete",
        entity: null,
        tombstoneExpiresAt: expect.any(String)
      })
    );

    await app.close();
  });

  it("does not allow a social identity to create a shop session", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const response = await app.inject({
      method: "POST",
      url: "/auth/social/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({ provider: "google", email: "social-owner@example.com" })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "social_login_disabled" });
    expect(response.headers["set-cookie"]).toBeUndefined();

    await app.close();
  });
});

async function verifyOtp(
  app: ReturnType<typeof buildApi>,
  channel: "phone" | "email",
  destination: string
): Promise<SessionResponse & { setCookie: string | string[] | undefined }> {
  const otp = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel,
    destination
  });
  const response = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otp.challengeId,
      code: otp.devOtp
    })
  });

  expect(response.statusCode).toBe(200);
  return {
    ...response.json<SessionResponse>(),
    setCookie: response.headers["set-cookie"]
  };
}

async function postJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown,
  cookie?: string
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: {
      ...jsonHeaders(),
      ...(cookie === undefined ? {} : { cookie })
    },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

async function getJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie?: string
): Promise<T> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: cookie === undefined ? {} : { cookie }
  });

  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(setCookie: string | string[] | undefined): string {
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(cookie).toBeTruthy();
  return cookie?.split(";")[0] ?? "";
}
