import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("account PIN settings UI", () => {
  const source = readFileSync("apps/web/src/IdentitySecurityPanel.tsx", "utf8");

  it("places a focused PIN form before unrelated identity settings", () => {
    expect(source.indexOf("{accountPinForm()}")).toBeGreaterThan(-1);
    expect(source.indexOf("{accountPinForm()}")).toBeLessThan(
      source.indexOf("Private identity contact")
    );
    expect(source).toContain("onSubmit={(event) => {");
    expect(source).toContain('void runProfileAction("pin-save", saveAccountPin)');
  });

  it("uses contextual setup/change copy and immediate accessible feedback", () => {
    expect(source).toContain('hasPin ? "Set a new PIN" : "Create your PIN"');
    expect(source).toContain("Choose a four-digit PIN and enter it again to confirm.");
    expect(source).toContain("Show PIN while typing");
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain("Your PIN is ready. You can now use it to sign in.");
  });
});
