import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("progressive onboarding UI", () => {
  it("opens the current phone-first signup instead of the legacy continue screen", async () => {
    const [applicationSource, signupSource, styles] = await Promise.all([
      readFile(new URL("../apps/web/src/SokoApplication.tsx", import.meta.url), "utf8"),
      readFile(new URL("../apps/web/src/PhoneSignup.tsx", import.meta.url), "utf8"),
      readFile(new URL("../apps/web/src/styles.css", import.meta.url), "utf8")
    ]);

    expect(applicationSource).toContain(
      'initialAuthenticationTarget ?? (initialOwnerAuth !== null ? "login" : "signup")'
    );
    expect(applicationSource).toContain('authenticationView === "signup"');
    expect(applicationSource).toContain("<PhoneSignup");
    expect(applicationSource).not.toContain("ProgressiveAuthentication");
    expect(applicationSource).not.toContain('authenticationView === "continue"');
    expect(signupSource).toContain("Start with your phone");
    expect(signupSource).toContain("Continue to marketplace as guest");
    expect(styles).not.toContain("progressive-auth");
    expect(styles).not.toContain("signup-video");
    expect(styles).not.toContain("auth-landing-grid");
  });

  it("recovers a device account from its device-bound signing key before onboarding", async () => {
    const [recoverySource, applicationSource] = await Promise.all([
      readFile(new URL("../apps/web/src/device-recovery.ts", import.meta.url), "utf8"),
      readFile(new URL("../apps/web/src/SokoApplication.tsx", import.meta.url), "utf8")
    ]);

    expect(recoverySource).toContain('const databaseName = "soko-device-recovery-v1"');
    expect(recoverySource).toContain("indexedDB.open(databaseName, 1)");
    expect(recoverySource).toContain('name: "ECDSA"');
    expect(recoverySource).toContain('namedCurve: "P-256"');
    expect(recoverySource).toContain('false,\n    ["sign"]');
    expect(recoverySource).toContain('"/auth/device/recover"');
    const recoveryBranch = applicationSource.slice(
      applicationSource.indexOf("if (isDefinitiveAuthenticationError(error))"),
      applicationSource.indexOf("if (cached !== null) setSession(cached)")
    );
    const recoveryIndex = recoveryBranch.indexOf("recoverDeviceAccount()");
    const onboardingIndex = recoveryBranch.indexOf("setAuthenticationView(nextAuthenticationView)");
    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(onboardingIndex).toBeGreaterThanOrEqual(0);
    expect(recoveryIndex).toBeLessThan(onboardingIndex);
  });
});
