import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("progressive onboarding UI", () => {
  it("offers one deliberate Continue action without mandatory identity fields", async () => {
    const source = await readFile(
      new URL("../apps/web/src/ProgressiveAuthentication.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("Continue to Soko");
    expect(source).toContain("Opening Soko…");
    expect(source).toContain("Already have an account?");
    expect(source).toContain("Sign in");
    expect(source).toContain('"/auth/continue"');
    expect(source).not.toMatch(/<input|<select|<textarea/u);
    expect(source).not.toContain("contacts");
    expect(source).not.toContain("Notification.requestPermission");
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
    expect(recoveryBranch.indexOf("recoverDeviceAccount()")).toBeLessThan(
      recoveryBranch.indexOf('setAuthenticationView(initialOwnerAuth === null ? "continue"')
    );
  });
});
