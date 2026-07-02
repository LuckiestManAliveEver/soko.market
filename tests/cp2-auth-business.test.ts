import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  destination: string;
  devOtp: string;
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
  };
  membership: {
    role: string;
  };
}

interface RoleCheckResponse {
  allowed: boolean;
  role: string;
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
});

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
