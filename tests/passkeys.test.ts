import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

const origin = "http://localhost:5173";

describe("passkey authentication", () => {
  it("creates server-bound registration and discoverable login ceremonies", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const sessionCookie = await createSessionCookie(app);

    const registration = await app.inject({
      method: "POST",
      url: "/auth/passkeys/register/options",
      headers: {
        cookie: sessionCookie,
        origin
      }
    });

    expect(registration.statusCode).toBe(200);
    expect(registration.json()).toMatchObject({
      ceremonyId: expect.any(String),
      options: {
        challenge: expect.any(String),
        rp: { name: "Soko.market" },
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required"
        }
      }
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/passkeys/login/options",
      headers: { origin }
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      ceremonyId: expect.any(String),
      options: {
        challenge: expect.any(String),
        userVerification: "required"
      }
    });
    expect(store.snapshot().passkeyCeremonies).toHaveLength(2);

    await app.close();
  });

  it("rejects untrusted origins and keeps passkeys account-scoped after hydration", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const sessionCookie = await createSessionCookie(app);

    const rejected = await app.inject({
      method: "POST",
      url: "/auth/passkeys/register/options",
      headers: {
        cookie: sessionCookie,
        origin: "https://attacker.example"
      }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ code: "passkey_origin_not_allowed" });

    const snapshot = store.snapshot();
    const account = snapshot.accounts[0];
    const user = snapshot.users[0];
    expect(account).toBeDefined();
    expect(user).toBeDefined();
    snapshot.passkeys = [
      {
        id: "credential-id",
        accountId: account!.id,
        userId: user!.id,
        webauthnUserId: "user-handle",
        publicKey: "AQID",
        counter: 0,
        label: "Android passkey",
        deviceType: "multiDevice",
        backedUp: true,
        transports: ["internal", "hybrid"],
        createdAt: new Date(0).toISOString(),
        lastUsedAt: null
      }
    ];

    const restoredStore = createCp2Store();
    restoredStore.hydrateSnapshot(snapshot);
    const restoredApp = buildApi({ cp2: { store: restoredStore } });
    const listed = await restoredApp.inject({
      method: "GET",
      url: "/auth/passkeys",
      headers: { cookie: sessionCookie }
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      passkeys: [
        expect.objectContaining({
          id: "credential-id",
          label: "Android passkey",
          backedUp: true
        })
      ]
    });

    await app.close();
    await restoredApp.close();
  });
});

async function createSessionCookie(app: ReturnType<typeof buildApi>): Promise<string> {
  const otpRequest = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    headers: { "content-type": "application/json" },
    payload: {
      channel: "email",
      destination: "passkey-owner@example.com"
    }
  });
  const challenge = otpRequest.json<{ challengeId: string; devOtp: string }>();
  const verified = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: { "content-type": "application/json" },
    payload: {
      challengeId: challenge.challengeId,
      code: challenge.devOtp
    }
  });
  const setCookie = verified.headers["set-cookie"];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(value).split(";")[0] ?? "";
}
