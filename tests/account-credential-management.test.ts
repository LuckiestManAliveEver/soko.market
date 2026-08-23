import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

describe("existing account credential management", () => {
  it("creates and changes a login PIN without allowing setup to overwrite it", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const signup = await post(app, "/auth/otp/request", {
      method: "email",
      contact: "pin-settings-owner@example.test"
    });
    const challenge = signup.json<{ challengeId: string; devOtp: string }>();
    const verified = await post(app, "/auth/otp/verify", {
      method: "email",
      contact: "pin-settings-owner@example.test",
      otp: challenge.devOtp
    });
    const cookie = cookies(verified.headers["set-cookie"]);

    expect((await get(app, "/auth/credentials/status", cookie)).json()).toEqual({
      hasPin: false,
      hasPassword: false
    });
    expect(
      (await post(app, "/auth/pin/setup", { pin: "1234", pinConfirmation: "4321" }, cookie)).json()
    ).toMatchObject({ code: "pin_confirmation_invalid" });

    const created = await post(
      app,
      "/auth/pin/setup",
      { pin: "1234", pinConfirmation: "1234" },
      cookie
    );
    expect(created.statusCode).toBe(200);
    expect((await get(app, "/auth/credentials/status", cookie)).json()).toEqual({
      hasPin: true,
      hasPassword: false
    });

    const unsafeOverwrite = await post(
      app,
      "/auth/pin/setup",
      { pin: "5678", pinConfirmation: "5678" },
      cookie
    );
    expect(unsafeOverwrite.statusCode).toBe(409);
    expect(unsafeOverwrite.json()).toMatchObject({ code: "pin_already_set" });

    const wrongCurrentPin = await post(
      app,
      "/auth/pin/change",
      { currentPin: "9999", pin: "5678", pinConfirmation: "5678" },
      cookie
    );
    expect(wrongCurrentPin.statusCode).toBe(401);
    expect(wrongCurrentPin.json()).toMatchObject({ code: "pin_invalid" });

    const changed = await post(
      app,
      "/auth/pin/change",
      { currentPin: "1234", pin: "5678", pinConfirmation: "5678" },
      cookie
    );
    expect(changed.statusCode).toBe(200);

    expect(
      (
        await post(app, "/auth/pin/login", {
          method: "email",
          contact: "pin-settings-owner@example.test",
          pin: "1234"
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await post(app, "/auth/pin/login", {
          method: "email",
          contact: "pin-settings-owner@example.test",
          pin: "5678"
        })
      ).statusCode
    ).toBe(200);

    await app.close();
  });

  it("creates a password with the current PIN, then changes it with the current password", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    const signup = await post(app, "/auth/pin/signup", {
      method: "phone",
      contact: "+254712345680",
      pin: "2468"
    });
    const cookie = cookies(signup.headers["set-cookie"]);
    const password = "first secure account password";
    const nextPassword = "second secure account password";

    const missingPin = await post(
      app,
      "/auth/password/setup",
      { password, passwordConfirmation: password },
      cookie
    );
    expect(missingPin.statusCode).toBe(401);
    expect(missingPin.json()).toMatchObject({ code: "pin_required" });

    const wrongPin = await post(
      app,
      "/auth/password/setup",
      { currentPin: "1357", password, passwordConfirmation: password },
      cookie
    );
    expect(wrongPin.statusCode).toBe(401);
    expect(wrongPin.json()).toMatchObject({ code: "pin_invalid" });

    const created = await post(
      app,
      "/auth/password/setup",
      { currentPin: "2468", password, passwordConfirmation: password },
      cookie
    );
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ created: true });
    expect((await get(app, "/auth/credentials/status", cookie)).json()).toEqual({
      hasPin: true,
      hasPassword: true
    });

    const duplicate = await post(
      app,
      "/auth/password/setup",
      { currentPin: "2468", password, passwordConfirmation: password },
      cookie
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "password_already_set" });

    const wrongPassword = await post(
      app,
      "/auth/password/change",
      {
        currentPassword: "not the current password",
        password: nextPassword,
        passwordConfirmation: nextPassword
      },
      cookie
    );
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ code: "current_password_invalid" });

    const changed = await post(
      app,
      "/auth/password/change",
      { currentPassword: password, password: nextPassword, passwordConfirmation: nextPassword },
      cookie
    );
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ changed: true });

    expect(
      (
        await post(app, "/auth/login/password", {
          type: "phone",
          identifier: "+254712345680",
          password
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await post(app, "/auth/login/password", {
          type: "phone",
          identifier: "+254712345680",
          password: nextPassword
        })
      ).statusCode
    ).toBe(200);

    await app.close();
  });
});

function post(app: ReturnType<typeof buildApi>, url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    payload
  });
}

function get(app: ReturnType<typeof buildApi>, url: string, cookie: string) {
  return app.inject({ method: "GET", url, headers: { cookie } });
}

function cookies(value: string | string[] | undefined): string {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map((item) => item.split(";", 1)[0]).join("; ");
}
