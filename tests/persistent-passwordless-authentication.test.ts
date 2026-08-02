import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../services/api/src/app";
import { readAuthRuntimeConfig } from "../services/api/src/cp2/auth-runtime-config";
import { createCp2Store } from "../services/api/src/cp2/store";

describe("persistent passwordless authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("creates an account without a password and keeps return-method discovery generic", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const identity = { type: "phone", identifier: "+254712349001" };
    const started = await post(app, "/auth/signup/start", identity);
    const challenge = started.json<{ transactionId: string }>();
    const completed = await post(app, "/auth/signup/complete", {
      transactionId: challenge.transactionId,
      displayName: "Passwordless Owner",
      termsAccepted: true,
      privacyAccepted: true
    });

    expect(completed.statusCode).toBe(200);
    const issuedCookies = JSON.stringify(completed.headers["set-cookie"]);
    expect(issuedCookies).toContain("soko_refresh=");
    expect(issuedCookies).toContain("Path=/");
    expect(issuedCookies).not.toContain("Path=/auth");
    expect(store.snapshot().passwordCredentials).toHaveLength(0);
    expect(store.snapshot().smsDeliveryAttempts).toHaveLength(0);
    expect(completed.json()).toMatchObject({
      session: {
        inactivityExpiresAt: expect.any(String),
        absoluteExpiresAt: expect.any(String)
      }
    });

    const known = await post(app, "/auth/login/methods", identity);
    const unknown = await post(app, "/auth/login/methods", {
      type: "phone",
      identifier: "+254712349999"
    });
    expect(known.json()).toEqual(unknown.json());
    expect(known.json()).toEqual({
      preferred: "passkey",
      passkeyAvailable: true,
      passwordFallback: true,
      recoveryAvailable: true,
      smsLogin: false
    });
    expect(store.snapshot().smsDeliveryAttempts).toHaveLength(0);

    for (const url of [
      "/auth/phone/challenges",
      "/auth/signup/verify-phone",
      "/auth/phone/request-otp",
      "/auth/phone/verify-otp",
      "/auth/whatsapp/request-otp",
      "/auth/whatsapp/verify-otp",
      "/webhooks/sms/android",
      "/internal/sms-gateways/health",
      "/internal/auth/sms-metrics"
    ]) {
      expect((await post(app, url, {})).statusCode).toBe(404);
    }

    const session = await app.inject({
      method: "GET",
      url: "/session",
      headers: { cookie: cookieHeader(completed.headers["set-cookie"]) }
    });
    expect(session.headers["cache-control"]).toBe("no-store");
    expect(session.headers.pragma).toBe("no-cache");
    await app.close();
  });

  it("rotates after access expiry, slides inactivity, preserves the absolute limit, and detects reuse", async () => {
    const startedAt = new Date("2030-01-01T00:00:00.000Z");
    const store = createCp2Store();
    const signup = store.signupWithPhonePin({
      destination: "+254712349002",
      pin: "1234",
      now: startedAt
    });
    const originalRefreshToken = store.prepareDeviceSession(
      signup.session.id,
      deviceMetadata,
      startedAt
    );
    store.consumeSessionRefreshToken(signup.session.id);
    const original = store.snapshot().sessions[0]!;
    const smsAttemptsBefore = store.snapshot().smsDeliveryAttempts?.length ?? 0;

    const refreshAt = new Date(startedAt.getTime() + 16 * 60_000);
    expect(store.getSession(original.id, refreshAt)).toBeNull();
    const refreshed = store.refreshSessionCredential({
      refreshToken: originalRefreshToken,
      metadata: deviceMetadata,
      now: refreshAt
    });
    const replacement = store
      .snapshot()
      .sessions.find((session) => session.rotatedFromSessionId === original.id)!;
    expect(replacement.absoluteExpiresAt).toBe(original.absoluteExpiresAt);
    expect(Date.parse(replacement.inactivityExpiresAt)).toBeGreaterThan(
      Date.parse(original.inactivityExpiresAt)
    );
    expect(replacement.authenticatedAt).toBe(original.authenticatedAt);
    expect(store.snapshot().smsDeliveryAttempts?.length ?? 0).toBe(smsAttemptsBefore);

    expect(() => store.logoutAll(refreshed.session.id, refreshAt)).toThrowError(
      expect.objectContaining({ code: "recent_authentication_required" })
    );

    expect(() =>
      store.refreshSessionCredential({
        refreshToken: originalRefreshToken,
        metadata: deviceMetadata,
        now: new Date(refreshAt.getTime() + 1)
      })
    ).toThrowError(expect.objectContaining({ code: "auth_refresh_reuse_detected" }));
    expect(
      store
        .snapshot()
        .sessions.filter((session) => session.sessionFamilyId === original.sessionFamilyId)
        .every((session) => session.revokedAt !== null)
    ).toBe(true);
  });

  it("rejects refresh at the absolute boundary and after an account is suspended", async () => {
    vi.stubEnv("SESSION_INACTIVITY_TTL_DAYS", "1");
    vi.stubEnv("SESSION_ABSOLUTE_TTL_DAYS", "7");
    const startedAt = new Date("2031-02-01T00:00:00.000Z");
    const originalStore = createCp2Store();
    const signup = originalStore.signupWithPhonePin({
      destination: "+254712349003",
      pin: "1234",
      now: startedAt
    });
    const originalRefreshToken = originalStore.prepareDeviceSession(
      signup.session.id,
      deviceMetadata,
      startedAt
    );
    originalStore.consumeSessionRefreshToken(signup.session.id);
    const snapshot = originalStore.snapshot();
    const session = snapshot.sessions[0]!;
    session.inactivityExpiresAt = session.absoluteExpiresAt;
    session.refreshExpiresAt = session.absoluteExpiresAt;

    const absoluteStore = createCp2Store();
    absoluteStore.hydrateSnapshot(snapshot);
    expect(() =>
      absoluteStore.refreshSessionCredential({
        refreshToken: originalRefreshToken,
        metadata: deviceMetadata,
        now: new Date(Date.parse(session.absoluteExpiresAt) + 1)
      })
    ).toThrowError(expect.objectContaining({ code: "auth_refresh_expired" }));

    const suspendedSnapshot = originalStore.snapshot();
    suspendedSnapshot.accounts[0]!.status = "suspended";
    const suspendedStore = createCp2Store();
    suspendedStore.hydrateSnapshot(suspendedSnapshot);
    expect(() =>
      suspendedStore.refreshSessionCredential({
        refreshToken: originalRefreshToken,
        metadata: deviceMetadata,
        now: new Date(startedAt.getTime() + 60_000)
      })
    ).toThrowError(expect.objectContaining({ statusCode: 403 }));
    expect(suspendedStore.snapshot().sessions.every((item) => item.revokedAt !== null)).toBe(true);
  });

  it("ships a reversible migration for rotating inactivity and absolute session limits", () => {
    const migration = readFileSync(
      "infra/db/migrations/045_persistent_passwordless_sessions.sql",
      "utf8"
    );
    const rollback = readFileSync(
      "infra/db/rollbacks/045_persistent_passwordless_sessions.down.sql",
      "utf8"
    );
    expect(migration).toContain("inactivity_expires_at");
    expect(migration).toContain("absolute_expires_at");
    expect(migration).toContain("rotated_from_session_id");
    expect(migration).toContain("authenticated_at");
    expect(rollback).toContain("drop column if exists absolute_expires_at");

    const smsRetirement = readFileSync(
      "infra/db/migrations/046_disable_sms_verification.sql",
      "utf8"
    );
    const smsRetirementRollback = readFileSync(
      "infra/db/rollbacks/046_disable_sms_verification.down.sql",
      "utf8"
    );
    expect(smsRetirement).toContain("Active phone/SMS verification challenges are disabled");
    expect(smsRetirement).toContain("verification_challenges_reject_phone");
    expect(smsRetirement).toContain("status = 'invalidated'");
    expect(smsRetirementRollback).toContain(
      "drop function if exists reject_phone_verification_challenge()"
    );

    const frontend = readFileSync("apps/web/src/PhoneFirstAuthentication.tsx", "utf8");
    expect(frontend).toContain('"/auth/login/methods"');
    expect(frontend).toContain('"/auth/email/verification/start"');
    expect(frontend).toContain('"/auth/email/verification/verify"');
    expect(frontend).toContain("methods.passkeyAvailable");
    expect(frontend).toContain("loginMethods?.passwordFallback");
    expect(frontend).not.toContain('"/auth/identify"');
    expect(frontend).not.toContain('"/auth/signup/verify-phone"');
    expect(frontend).not.toContain('"verify-phone"');
    expect(frontend).toContain(" fallback (optional)");
    expect(frontend).toContain("Create passkey");
    expect(frontend).toContain("Do this later");
  });

  it("fails closed on unsafe production cookie and session configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COOKIE_SECURE", "false");
    vi.stubEnv("WEBAUTHN_RP_ID", "soko.market");
    vi.stubEnv("WEBAUTHN_EXPECTED_ORIGINS", "https://soko.market");
    for (const name of [
      "OTP_HMAC_SECRET",
      "AUTH_AUDIT_HMAC_SECRET",
      "AUTH_TOKEN_ENCRYPTION_KEY",
      "PASSWORD_HASH_SECRET"
    ]) {
      vi.stubEnv(name, `${name}-secure-production-value-1234567890`);
    }
    expect(() => readAuthRuntimeConfig(["https://soko.market"])).toThrow(
      "Production cookies must be secure"
    );

    vi.stubEnv("COOKIE_SECURE", "true");
    vi.stubEnv("SESSION_ROTATION_ENABLED", "false");
    expect(() => readAuthRuntimeConfig(["https://soko.market"])).toThrow(
      "Production requires refresh-token rotation"
    );
  });
});

function post(app: ReturnType<typeof buildApi>, url: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    payload
  });
}

function cookieHeader(header: string | string[] | undefined): string {
  const values = Array.isArray(header) ? header : header === undefined ? [] : [header];
  const cookies = values.flatMap((value) => value.split(/,(?=\s*[^;,]+=)/u));
  if (cookies.length < 2) throw new Error("Expected access and refresh cookies.");
  return cookies.map((cookie) => cookie.trim().split(";")[0]).join("; ");
}

const deviceMetadata = {
  deviceId: "persistent-auth-test",
  deviceName: "Persistent auth test",
  platform: "test",
  browserOrApp: "web",
  userAgent: "Vitest"
};
