import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { OAuthProvider } from "../packages/shared-types/src";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface SessionResponse {
  account: {
    id: string;
  };
}

const providers: OAuthProvider[] = [
  "google",
  "facebook",
  "tiktok",
  "apple",
  "github",
  "microsoft",
  "linkedin",
  "x"
];

describe("authentication channels", () => {
  it("keeps phone and email OTP authentication available", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const phone = await verifyOtp(app, "phone", "254700000201");
    const email = await verifyOtp(app, "email", "owner@example.com");

    expect(phone.account.id).toBeTruthy();
    expect(email.account.id).toBeTruthy();
    expect(phone.account.id).not.toBe(email.account.id);

    await app.close();
  });

  it("publishes every OAuth provider as disabled", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const response = await app.inject({ method: "GET", url: "/auth/oauth/providers" });

    expect(response.statusCode).toBe(200);
    expect(response.json().providers).toEqual(
      providers.map((provider) =>
        expect.objectContaining({
          id: provider,
          enabled: false,
          configured: false
        })
      )
    );

    await app.close();
  });

  it.each(providers)("rejects %s OAuth login before creating a session", async (provider) => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const response = await app.inject({
      method: "POST",
      url: "/auth/oauth/start",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        provider,
        redirectUri: "http://127.0.0.1:5173/auth/oauth/callback"
      })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "oauth_provider_disabled" });

    await app.close();
  });

  it("rejects the legacy social-login endpoint", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const response = await app.inject({
      method: "POST",
      url: "/auth/social/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({ provider: "google", email: "owner@example.com" })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "social_login_disabled" });

    await app.close();
  });

  it("rejects direct OAuth callback completion", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const response = await app.inject({
      method: "POST",
      url: "/auth/oauth/callback",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        provider: "google",
        state: "disabled-state",
        csrfToken: "disabled-csrf",
        code: "disabled-code"
      })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "oauth_provider_disabled" });

    await app.close();
  });
});

async function verifyOtp(
  app: ReturnType<typeof buildApi>,
  channel: "phone" | "email",
  destination: string
): Promise<SessionResponse> {
  const otp = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel,
    destination
  });
  const response = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({ challengeId: otp.challengeId, code: otp.devOtp })
  });

  expect(response.statusCode).toBe(200);
  return response.json<SessionResponse>();
}

async function postJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: jsonHeaders(),
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function jsonHeaders() {
  return { "content-type": "application/json" };
}
