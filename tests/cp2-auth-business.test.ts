import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { OtpProvider } from "../services/api/src/cp2/otp-provider";

interface OtpRequestResponse {
  challengeId: string;
  destination: string;
  devOtp?: string;
}

interface VerifyOtpResponse {
  account: {
    id: string;
  };
  user: {
    id: string;
    language: string;
  };
  session: {
    id: string;
  };
  resumed: boolean;
}

interface CreateBusinessResponse {
  business: {
    id: string;
    language: string;
    sokoId: string;
  };
  membership: {
    role: string;
  };
}

interface RoleCheckResponse {
  allowed: boolean;
  role: string;
}

interface ProductResponse {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
}

interface PublicStorefrontResponse {
  agentId: string;
  sokoId: string;
  businessName: string;
  products: Array<{
    id: string;
    name: string;
    unit: string;
    available: boolean;
  }>;
}

describe("CP2 auth and business creation", () => {
  it("creates an owner account, session, business, language preference, role, and audit events", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      channel: "phone",
      destination: "254700000001"
    });

    expect(otpResponse.destination).toBe("+254700000001");
    expect(otpResponse.devOtp).toHaveLength(6);

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        challengeId: otpResponse.challengeId,
        code: otpResponse.devOtp
      })
    });
    const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
    const auth = verifyResponse.json<VerifyOtpResponse>();

    expect(verifyResponse.statusCode).toBe(200);
    expect(sessionCookie).toContain("soko_session=");
    expect(auth.resumed).toBe(false);

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/session",
      headers: {
        cookie: sessionCookie
      }
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json<VerifyOtpResponse>().account.id).toBe(auth.account.id);

    const business = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: "Jane's Shop",
        language: "sw"
      },
      sessionCookie
    );

    expect(business.business.language).toBe("sw");
    expect(business.business.sokoId).toMatch(/^\+254-A\d{8}$/);
    expect(business.membership.role).toBe("owner");

    const ownerRole = await postJson<RoleCheckResponse>(
      app,
      "/roles/check",
      {
        businessId: business.business.id,
        role: "owner"
      },
      sessionCookie
    );
    const cashierRole = await postJson<RoleCheckResponse>(
      app,
      "/roles/check",
      {
        businessId: business.business.id,
        role: "cashier"
      },
      sessionCookie
    );

    expect(ownerRole).toEqual({
      allowed: true,
      role: "owner",
      permission: "business:read"
    });
    expect(cashierRole.allowed).toBe(false);

    const refreshedSession = await app.inject({
      method: "GET",
      url: "/session",
      headers: {
        cookie: sessionCookie
      }
    });

    expect(refreshedSession.json<VerifyOtpResponse>().user.language).toBe("sw");

    const auditTypes = store.snapshot().auditEvents.map((event) => event.type);
    expect(auditTypes).toEqual(
      expect.arrayContaining([
        "user.created",
        "auth.session_created",
        "auth.otp_verified",
        "account.created",
        "business.created",
        "business.global_shop_id_created",
        "membership.created"
      ])
    );
    expect(Object.isFrozen(store.snapshot().auditEvents[0]?.payload)).toBe(true);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: sessionCookie
      }
    });

    expect(logoutResponse.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/session",
      headers: {
        cookie: sessionCookie
      }
    });

    expect(afterLogout.statusCode).toBe(401);
    expect(store.snapshot().auditEvents.map((event) => event.type)).toContain(
      "auth.session_revoked"
    );

    await app.close();
  });

  it("rejects invalid OTPs and unauthenticated business creation", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      channel: "email",
      destination: "owner@example.com"
    });

    const badOtp = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        challengeId: otpResponse.challengeId,
        code: "000000"
      })
    });

    expect(badOtp.statusCode).toBe(401);
    expect(badOtp.json()).toMatchObject({
      code: "otp_invalid"
    });

    const unauthenticatedBusiness = await app.inject({
      method: "POST",
      url: "/businesses",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        name: "Blocked Shop",
        language: "en"
      })
    });

    expect(unauthenticatedBusiness.statusCode).toBe(401);

    const invalidRole = await postJson<VerifyOtpResponse>(app, "/auth/otp/verify", {
      challengeId: otpResponse.challengeId,
      code: otpResponse.devOtp
    });
    const sessionCookie = `soko_session=${invalidRole.session.id}`;
    const roleResponse = await app.inject({
      method: "POST",
      url: "/roles/check",
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({
        businessId: "missing-business",
        role: "admin"
      })
    });

    expect(roleResponse.statusCode).toBe(400);
    expect(roleResponse.json()).toMatchObject({
      code: "role_invalid"
    });

    await app.close();
  });

  it("accepts email OTP setup payloads with method, contact, and otp", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      method: "email",
      contact: "Owner@Example.com"
    });

    expect(otpResponse.destination).toBe("owner@example.com");

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "email",
        contact: "owner@example.com",
        otp: otpResponse.devOtp
      })
    });
    const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);

    expect(verifyResponse.statusCode).toBe(200);
    expect(sessionCookie).toContain("soko_session=");

    await app.close();
  });

  it("authenticates a social profile and finishes setup with a PIN after business creation", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const social = await app.inject({
      method: "POST",
      url: "/auth/social/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        provider: "google",
        email: "Owner@Social.example",
        displayName: "Social Owner"
      })
    });
    const sessionCookie = extractSessionCookie(social.headers["set-cookie"]);
    const socialBody = social.json<VerifyOtpResponse>();

    expect(social.statusCode).toBe(200);
    expect(socialBody.user.id).toBeTruthy();
    expect(sessionCookie).toContain("soko_session=");

    const business = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: "Social Shop",
        language: "en"
      },
      sessionCookie
    );
    const pinSetup = await postJson<VerifyOtpResponse>(
      app,
      "/auth/pin/setup",
      {
        pin: "2468"
      },
      sessionCookie
    );
    const ownerRole = await postJson<RoleCheckResponse>(
      app,
      "/roles/check",
      {
        businessId: business.business.id,
        role: "owner"
      },
      sessionCookie
    );
    const resumed = await app.inject({
      method: "POST",
      url: "/auth/social/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        provider: "google",
        email: "owner@social.example"
      })
    });

    expect(pinSetup.account.id).toBe(socialBody.account.id);
    expect(business.business.sokoId).toMatch(/^\+254-A\d{8}$/);
    expect(ownerRole.allowed).toBe(true);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json<VerifyOtpResponse>().resumed).toBe(true);
    expect(store.snapshot().auditEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "auth.oauth_completed",
        "business.created",
        "business.global_shop_id_created",
        "auth.pin_set"
      ])
    );

    await app.close();
  });

  it("sets and verifies an owner login PIN after OTP", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      method: "phone",
      contact: "+254700000003"
    });
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: "+254700000003",
        otp: otpResponse.devOtp
      })
    });
    const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
    const initialPinStatus = await app.inject({
      method: "GET",
      url: "/auth/pin/status",
      headers: {
        cookie: sessionCookie
      }
    });
    const recoverBeforeSetup = await app.inject({
      method: "POST",
      url: "/auth/pin/recover",
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({
        pin: "7777"
      })
    });

    expect(initialPinStatus.json()).toMatchObject({
      hasPin: false
    });
    expect(recoverBeforeSetup.statusCode).toBe(409);
    expect(recoverBeforeSetup.json()).toMatchObject({
      code: "pin_not_set"
    });

    const pinSetup = await postJson<VerifyOtpResponse>(
      app,
      "/auth/pin/setup",
      {
        pin: "1234"
      },
      sessionCookie
    );
    const setupPinStatus = await app.inject({
      method: "GET",
      url: "/auth/pin/status",
      headers: {
        cookie: sessionCookie
      }
    });
    const business = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: "Pinned Shop",
        language: "en"
      },
      sessionCookie
    );

    expect(pinSetup.account.id).toBe(verifyResponse.json<VerifyOtpResponse>().account.id);
    expect(setupPinStatus.json()).toMatchObject({
      hasPin: true
    });
    expect(business.membership.role).toBe("owner");

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: sessionCookie
      }
    });

    const badPinLogin = await app.inject({
      method: "POST",
      url: "/auth/pin/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: "+254700000003",
        pin: "0000"
      })
    });

    expect(badPinLogin.statusCode).toBe(401);
    expect(badPinLogin.json()).toMatchObject({
      code: "pin_invalid"
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/pin/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: "+254700000003",
        pin: "1234"
      })
    });
    const loginCookie = extractSessionCookie(login.headers["set-cookie"]);

    expect(login.statusCode).toBe(200);
    expect(loginCookie).toContain("soko_session=");
    expect(login.json<VerifyOtpResponse>().account.id).toBe(
      verifyResponse.json<VerifyOtpResponse>().account.id
    );

    const allowedRole = await postJson<RoleCheckResponse>(
      app,
      "/roles/check",
      {
        businessId: business.business.id,
        role: "owner"
      },
      loginCookie
    );

    expect(allowedRole.allowed).toBe(true);

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: loginCookie
      }
    });

    const recoveryOtp = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      method: "phone",
      contact: "+254700000003"
    });
    const recoveryVerify = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: "+254700000003",
        otp: recoveryOtp.devOtp
      })
    });
    const recoveryCookie = extractSessionCookie(recoveryVerify.headers["set-cookie"]);

    await postJson<VerifyOtpResponse>(
      app,
      "/auth/pin/recover",
      {
        pin: "7777"
      },
      recoveryCookie
    );

    const recoveredRole = await postJson<RoleCheckResponse>(
      app,
      "/roles/check",
      {
        businessId: business.business.id,
        role: "owner"
      },
      recoveryCookie
    );

    expect(recoveredRole.allowed).toBe(true);

    await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: recoveryCookie
      }
    });

    const oldPin = await app.inject({
      method: "POST",
      url: "/auth/pin/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: "+254700000003",
        pin: "1234"
      })
    });
    const newPin = await app.inject({
      method: "POST",
      url: "/auth/pin/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        method: "phone",
        contact: "+254700000003",
        pin: "7777"
      })
    });

    expect(oldPin.statusCode).toBe(401);
    expect(newPin.statusCode).toBe(200);
    expect(newPin.json<VerifyOtpResponse>().account.id).toBe(
      verifyResponse.json<VerifyOtpResponse>().account.id
    );

    await app.close();
  });

  it("serves a public storefront product list without exposing business data", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      channel: "phone",
      destination: "254700000004"
    });
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        challengeId: otpResponse.challengeId,
        code: otpResponse.devOtp
      })
    });
    const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
    const businessName = "Public Shop";
    const business = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: businessName,
        language: "en"
      },
      sessionCookie
    );
    const stockedProduct = await postJson<ProductResponse>(
      app,
      `/businesses/${business.business.id}/products`,
      {
        name: "Soko Rice",
        sku: "PRIVATE-SKU",
        unit: "2 kg bag",
        quantity: 4,
        buyingPrice: 120,
        sellingPrice: 180
      },
      sessionCookie
    );

    await postJson<ProductResponse>(
      app,
      `/businesses/${business.business.id}/products`,
      {
        name: "Out of stock beans",
        sku: "HIDDEN-SKU",
        unit: "kg",
        quantity: 0
      },
      sessionCookie
    );

    const agentId = createExpectedAgentId(business.business.id, businessName);
    const legacyPublicResponse = await app.inject({
      method: "GET",
      url: `/public/storefronts/${agentId}`
    });
    const publicResponse = await app.inject({
      method: "GET",
      url: `/public/storefronts/${encodeURIComponent(business.business.sokoId)}`
    });
    const privateProducts = await app.inject({
      method: "GET",
      url: `/businesses/${business.business.id}/products`
    });

    expect(publicResponse.statusCode).toBe(200);
    expect(legacyPublicResponse.statusCode).toBe(200);
    expect(privateProducts.statusCode).toBe(401);
    expect(publicResponse.json<PublicStorefrontResponse>()).toEqual({
      agentId: business.business.sokoId,
      sokoId: business.business.sokoId,
      businessName,
      products: [
        {
          id: stockedProduct.id,
          name: "Soko Rice",
          unit: "2 kg bag",
          available: true
        }
      ]
    });
    expect(legacyPublicResponse.json<PublicStorefrontResponse>().sokoId).toBe(
      business.business.sokoId
    );
    expect(publicResponse.json().products[0]).not.toHaveProperty("businessId");
    expect(publicResponse.json().products[0]).not.toHaveProperty("sku");
    expect(publicResponse.json().products[0]).not.toHaveProperty("quantity");
    expect(publicResponse.json().products[0]).not.toHaveProperty("buyingPrice");
    expect(publicResponse.json().products[0]).not.toHaveProperty("sellingPrice");
    expect(publicResponse.json().products[0]).not.toHaveProperty("createdAt");
    expect(publicResponse.json().products[0]).not.toHaveProperty("updatedAt");

    await app.close();
  });

  it("uses an external OTP provider without exposing a development code", async () => {
    const store = createCp2Store();
    const provider = new FakeOtpProvider("123456");
    const app = buildApi({ cp2: { store, otpProvider: provider } });

    const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
      channel: "phone",
      destination: "254700000002"
    });

    expect(otpResponse.destination).toBe("+254700000002");
    expect(otpResponse.devOtp).toBeUndefined();
    expect(provider.requests).toEqual([
      {
        channel: "phone",
        destination: "+254700000002"
      }
    ]);

    const badOtp = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        challengeId: otpResponse.challengeId,
        code: "000000"
      })
    });

    expect(badOtp.statusCode).toBe(401);

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        challengeId: otpResponse.challengeId,
        code: "123456"
      })
    });
    const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
    const auth = verifyResponse.json<VerifyOtpResponse>();

    expect(verifyResponse.statusCode).toBe(200);
    expect(sessionCookie).toContain("soko_session=");
    expect(auth.account.id).toHaveLength(36);
    expect(provider.verifications).toEqual([
      {
        channel: "phone",
        destination: "+254700000002",
        code: "000000"
      },
      {
        channel: "phone",
        destination: "+254700000002",
        code: "123456"
      }
    ]);

    await app.close();
  });
});

class FakeOtpProvider implements OtpProvider {
  readonly name = "fake";
  readonly exposesDevOtp = false;
  readonly verifiesExternally = true;
  readonly requests: Array<{ channel: "phone" | "email"; destination: string }> = [];
  readonly verifications: Array<{ channel: "phone" | "email"; destination: string; code: string }> =
    [];

  constructor(private readonly acceptedCode: string) {}

  canHandle(channel: "phone" | "email"): boolean {
    return channel === "phone";
  }

  async requestOtp(input: { channel: "phone" | "email"; destination: string }): Promise<void> {
    this.requests.push(input);
  }

  async verifyOtp(input: {
    channel: "phone" | "email";
    destination: string;
    code: string;
  }): Promise<boolean> {
    this.verifications.push(input);
    return input.code === this.acceptedCode;
  }
}

function createExpectedAgentId(businessId: string, businessName: string): string {
  const seed = `${businessId}-${businessName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return seed.length === 0 ? "soko-agent" : seed;
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: cookie === undefined ? jsonHeaders() : { ...jsonHeaders(), cookie },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);

  return response.json<TResponse>();
}

function jsonHeaders(): Record<string, string> {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined) {
    throw new Error("Expected set-cookie header.");
  }

  return value.split(";")[0] ?? value;
}
