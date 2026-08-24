import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  passkeyPinMutationEndpoint,
  passkeyPinRecoveryStage
} from "../apps/web/src/PhoneFirstAuthentication";

describe("phone passkey PIN recovery frontend", () => {
  it("routes no-PIN and existing-PIN accounts to distinct credential mutations", () => {
    expect(passkeyPinRecoveryStage(false)).toBe("create-pin");
    expect(passkeyPinMutationEndpoint("create-pin")).toBe("/auth/pin/setup");

    expect(passkeyPinRecoveryStage(true)).toBe("recover-pin");
    expect(passkeyPinMutationEndpoint("recover-pin")).toBe("/auth/pin/recover/passkey");
  });

  it("checks server credential status after passkey verification and before choosing the screen", () => {
    const source = readFileSync("apps/web/src/PhoneFirstAuthentication.tsx", "utf8");
    const flow = source.slice(
      source.indexOf("async function startRecovery()"),
      source.indexOf("async function verifyAndResetPassword()")
    );
    const verifyIndex = flow.indexOf('"/auth/passkeys/login/verify"');
    const statusIndex = flow.indexOf('"/auth/credentials/status"');
    const stageIndex = flow.indexOf("passkeyPinRecoveryStage(credentials.hasPin)");

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(verifyIndex);
    expect(stageIndex).toBeGreaterThan(statusIndex);
    expect(flow).toContain("skipAuthRefresh: true");
    expect(flow).toContain("Identity verified. Create a 4-digit PIN.");
    expect(flow).toContain("Identity verified. Choose a new PIN.");
  });

  it("does not automatically retry a mutation after recovery authorization is lost", () => {
    const source = readFileSync("apps/web/src/PhoneFirstAuthentication.tsx", "utf8");
    const mutation = source.slice(
      source.indexOf("async function finishPinRecovery()"),
      source.indexOf("function goBack()")
    );

    expect(mutation).toContain('error.code === "passkey_pin_recovery_required"');
    expect(mutation).toContain('setStage("methods")');
    expect(mutation).toContain("Verify your passkey again before changing your PIN.");
    expect(mutation.match(/apiFetch<AuthSessionView>/gu)).toHaveLength(1);
  });
});
