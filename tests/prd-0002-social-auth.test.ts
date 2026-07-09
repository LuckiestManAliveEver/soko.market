import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  user: {
    id: string;
  };
  session: {
    id: string;
  };
}

interface OAuthStartResponse {
  authorizationUrl: string;
  csrfToken: string;
  expiresAt: string;
  provider: OAuthProvider;
  state: string;
}

const providers: OAuthProvider[] = ["google", "facebook", "apple", "github", "microsoft"];
const oauthClientIdEnvByProvider: Record<OAuthProvider, string> = {
  apple: "OAUTH_APPLE_CLIENT_ID",
  facebook: "OAUTH_FACEBOOK_CLIENT_ID",
  github: "OAUTH_GITHUB_CLIENT_ID",
  google: "OAUTH_GOOGLE_CLIENT_ID",
  microsoft: "OAUTH_MICROSOFT_CLIENT_ID"
};
const previousOAuthClientIds = new Map<string, string | undefined>();

describe("PRD-0002 social sign-in authentication", () => {
  beforeAll(() => {
    for (const [provider, envName] of Object.entries(oauthClientIdEnvByProvider)) {
      previousOAuthClientIds.set(envName, process.env[envName]);
      process.env[envName] = `${provider}-test-client-id`;
    }
  });

  afterAll(() => {
    for (const [envName, value] of previousOAuthClientIds.entries()) {
      if (value === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = value;
      }
    }
  });

  it("keeps phone and email OTP working beside OAuth providers", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const phone = await verifyOtp(app, "phone", "254700000201");
    const email = await verifyOtp(app, "email", "owner@example.com");

    expect(phone.account.id).toBeTruthy();
    expect(email.account.id).toBeTruthy();
    expect(phone.account.id).not.toBe(email.account.id);

    await app.close();
  });

  it("lists the supported OAuth providers from one provider registry", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const response = await app.inject({
      method: "GET",
      url: "/auth/oauth/providers"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().providers.map((provider: { id: string }) => provider.id)).toEqual(
      providers
    );

    await app.close();
  });

  it.each(providers)("creates a normal authenticated session with %s", async (provider) => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });

    const result = await completeOAuth(app, provider, {
      email: `${provider}@example.com`,
      providerSubject: `${provider}-subject`
    });

    expect(result.session.id).toBeTruthy();
    expect(result.identity).toMatchObject({
      provider,
      email: `${provider}@example.com`
    });
    expect(extractSessionCookie(result.setCookie)).toContain("soko_session=");

    await app.close();
  });

  it("rejects invalid OAuth state and CSRF values", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const start = await startOAuth(app, "google");

    const invalidState = await app.inject({
      method: "POST",
      url: "/auth/oauth/callback",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        provider: "google",
        state: "wrong-state",
        csrfToken: start.csrfToken,
        profile: {
          providerSubject: "google-1",
          email: "google@example.com"
        }
      })
    });
    const invalidCsrf = await app.inject({
      method: "POST",
      url: "/auth/oauth/callback",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        provider: "google",
        state: start.state,
        csrfToken: "wrong-csrf",
        profile: {
          providerSubject: "google-1",
          email: "google@example.com"
        }
      })
    });

    expect(invalidState.statusCode).toBe(404);
    expect(invalidCsrf.statusCode).toBe(401);

    await app.close();
  });

  it("links email OTP and OAuth identities to one account by verified email", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const otp = await verifyOtp(app, "email", "same@example.com");
    const oauth = await completeOAuth(app, "google", {
      email: "same@example.com",
      providerSubject: "google-same"
    });

    expect(oauth.account.id).toBe(otp.account.id);
    expect(store.snapshot().accounts).toHaveLength(1);
    expect(store.snapshot().userIdentities).toHaveLength(1);

    await app.close();
  });

  it("links multiple OAuth providers with the same email to one user profile", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const google = await completeOAuth(app, "google", {
      email: "multi@example.com",
      providerSubject: "google-multi"
    });
    const apple = await completeOAuth(app, "apple", {
      email: "multi@example.com",
      providerSubject: "apple-multi"
    });

    expect(apple.account.id).toBe(google.account.id);
    expect(apple.user.id).toBe(google.user.id);
    expect(store.snapshot().accounts).toHaveLength(1);
    expect(
      store
        .snapshot()
        .userIdentities.map((identity) => identity.provider)
        .sort()
    ).toEqual(["apple", "google"]);

    await app.close();
  });

  it("links a signed-in phone account to a social identity", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const phone = await verifyOtp(app, "phone", "254700000202");
    const cookie = extractSessionCookie(phone.setCookie);
    const oauth = await completeOAuth(
      app,
      "microsoft",
      {
        email: "phone-linked@example.com",
        providerSubject: "microsoft-phone"
      },
      cookie
    );

    expect(oauth.account.id).toBe(phone.account.id);
    expect(store.snapshot().accounts).toHaveLength(1);
    expect(store.snapshot().userIdentities[0]).toMatchObject({
      accountId: phone.account.id,
      provider: "microsoft"
    });

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

async function startOAuth(
  app: ReturnType<typeof buildApi>,
  provider: OAuthProvider,
  cookie?: string
): Promise<OAuthStartResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/oauth/start",
    headers: {
      ...jsonHeaders(),
      ...(cookie === undefined ? {} : { cookie })
    },
    payload: JSON.stringify({
      provider,
      redirectUri: "http://127.0.0.1:5173/auth/oauth/callback"
    })
  });

  expect(response.statusCode).toBe(200);
  const body = response.json<OAuthStartResponse>();
  expect(body.authorizationUrl).toContain("state=");
  return body;
}

async function completeOAuth(
  app: ReturnType<typeof buildApi>,
  provider: OAuthProvider,
  profile: {
    providerSubject: string;
    email: string;
  },
  cookie?: string
): Promise<
  SessionResponse & {
    identity: {
      provider: OAuthProvider;
      email: string | null;
    };
    setCookie: string | string[] | undefined;
  }
> {
  const start = await startOAuth(app, provider, cookie);
  const response = await app.inject({
    method: "POST",
    url: "/auth/oauth/callback",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      provider,
      state: start.state,
      csrfToken: start.csrfToken,
      profile: {
        ...profile,
        emailVerified: true,
        displayName: `${provider} owner`
      },
      tokens: {
        accessToken: `${provider}-access-token`,
        refreshToken: `${provider}-refresh-token`,
        tokenType: "Bearer",
        expiresIn: 3600,
        scope: "openid email profile"
      }
    })
  });

  expect(response.statusCode).toBe(200);
  return {
    ...response.json<SessionResponse & { identity: { provider: OAuthProvider; email: string } }>(),
    setCookie: response.headers["set-cookie"]
  };
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
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(setCookie: string | string[] | undefined): string {
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(cookie).toBeTruthy();
  return cookie?.split(";")[0] ?? "";
}
