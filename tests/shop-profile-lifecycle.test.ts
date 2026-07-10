import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
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

const previousGoogleClientId = process.env.OAUTH_GOOGLE_CLIENT_ID;

describe("Shop profile lifecycle", () => {
  beforeAll(() => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = "google-test-client-id";
  });

  afterAll(() => {
    if (previousGoogleClientId === undefined) {
      delete process.env.OAUTH_GOOGLE_CLIENT_ID;
    } else {
      process.env.OAUTH_GOOGLE_CLIENT_ID = previousGoogleClientId;
    }
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

    await app.close();
  });

  it("blocks disconnecting the last social login method until a PIN exists", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const oauth = await completeOAuth(app);
    const cookie = extractSessionCookie(oauth.setCookie);
    const business = await postJson<BusinessResponse>(
      app,
      "/businesses",
      { name: "Social Shop", language: "en" },
      cookie
    );
    const accounts = await getJson<{
      accounts: Array<{
        id: string;
        provider: string;
      }>;
    }>(app, `/businesses/${business.business.id}/social-accounts`, cookie);

    expect(accounts.accounts).toHaveLength(1);
    const blocked = await app.inject({
      method: "DELETE",
      url: `/businesses/${business.business.id}/social-accounts/${accounts.accounts[0]?.id}`,
      headers: {
        cookie
      }
    });
    expect(blocked.statusCode).toBe(409);

    await postJson<SessionResponse>(app, "/auth/pin/setup", { pin: "1234" }, cookie);
    const disconnected = await app.inject({
      method: "DELETE",
      url: `/businesses/${business.business.id}/social-accounts/${accounts.accounts[0]?.id}`,
      headers: {
        cookie
      }
    });
    expect(disconnected.statusCode).toBe(200);

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

async function completeOAuth(
  app: ReturnType<typeof buildApi>
): Promise<SessionResponse & { setCookie: string | string[] | undefined }> {
  const start = await postJson<{ state: string; csrfToken: string }>(app, "/auth/oauth/start", {
    provider: "google",
    redirectUri: "http://127.0.0.1:5173/auth/oauth/callback"
  });
  const response = await app.inject({
    method: "POST",
    url: "/auth/oauth/callback",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      provider: "google",
      state: start.state,
      csrfToken: start.csrfToken,
      profile: {
        providerSubject: "google-shop-profile",
        email: "social-owner@example.com",
        emailVerified: true,
        displayName: "Social Owner"
      },
      tokens: {
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        scope: "openid email profile"
      }
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
