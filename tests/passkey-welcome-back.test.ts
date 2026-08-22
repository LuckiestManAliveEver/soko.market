import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Passkey welcome-back fast path: when this device already holds a passkey hint, the login
 * screen skips straight to "Unlock with passkey" instead of asking for an identifier again.
 * WebAuthn cannot distinguish "no discoverable credential" from "user cancelled" (both surface
 * as the same rejection), so any ceremony failure must fall through silently to ordinary
 * identifier entry - never a visible error, never a jump into the methods/password stages that
 * assume an identifier was already submitted.
 */
describe("passkey welcome-back fast path", () => {
  const source = readFileSync("apps/web/src/PhoneFirstAuthentication.tsx", "utf8");
  const signupSource = readFileSync("apps/web/src/PhoneSignup.tsx", "utf8");

  it("starts at the welcome-back stage only when a device hint exists and WebAuthn is supported", () => {
    expect(source).toContain('"welcome-back-passkey"');
    expect(source).toContain(
      'hint !== null && browserSupportsWebAuthn() ? "welcome-back-passkey" : "entry"'
    );
  });

  it("stores the device hint separately from the PIN-scoped remembered-account storage", () => {
    expect(source).toContain(
      'const passkeyDeviceHintStorageKey = "soko.chatFirst.passkeyDeviceHint"'
    );
    // Referenced only in the explanatory comment distinguishing the two storage keys, never
    // imported/read as a value - the passkey hint must not piggyback on PIN-scoped storage.
    expect(source).not.toMatch(/import\s*\{[^}]*ownerAuthStorageKey/u);
    expect(source).toContain("export function readPasskeyDeviceHint()");
    expect(source).toContain("export function writePasskeyDeviceHint(");
  });

  it("refreshes the hint on both signup passkey creation and ordinary passkey login", () => {
    expect(signupSource).toContain(
      'import { writePasskeyDeviceHint } from "./PhoneFirstAuthentication";'
    );
    const createPasskeyBlock = signupSource.slice(
      signupSource.indexOf("async function createPasskey()"),
      signupSource.indexOf("function goBack()")
    );
    expect(createPasskeyBlock).toContain("writePasskeyDeviceHint({");
    expect(createPasskeyBlock.indexOf("writePasskeyDeviceHint(")).toBeLessThan(
      createPasskeyBlock.indexOf("onAuthenticated(createdSession)")
    );

    const performPasskeyLoginBlock = source.slice(
      source.indexOf("async function performPasskeyLogin()"),
      source.indexOf("async function usePasskey()")
    );
    expect(performPasskeyLoginBlock).toContain("writePasskeyDeviceHint({");
  });

  it("falls through silently on any ceremony rejection - no error shown, no jump into methods", () => {
    const fallThroughBlock = source.slice(
      source.indexOf("function fallThroughToEntry()"),
      source.indexOf("async function unlockWithPasskeyFastPath()")
    );
    expect(fallThroughBlock).toContain('setStage("entry")');
    expect(fallThroughBlock).not.toContain('setStage("methods")');

    const fastPathBlock = source.slice(
      source.indexOf("async function unlockWithPasskeyFastPath()"),
      source.indexOf("function goBack()")
    );
    expect(fastPathBlock).toContain("} catch {");
    expect(fastPathBlock).toContain("fallThroughToEntry();");
    // The generic run() wrapper surfaces getUserFacingErrorMessage(error) on failure - the fast
    // path must not do that, since a missing/rejected credential here is the expected common
    // case, not a failure to report.
    expect(fastPathBlock).not.toContain("getUserFacingErrorMessage");
    expect(fastPathBlock).not.toContain("setMessage(");
  });

  it("pre-fills the hinted identifier when falling through, without touching usingRemembered", () => {
    const fallThroughBlock = source.slice(
      source.indexOf("function fallThroughToEntry()"),
      source.indexOf("async function unlockWithPasskeyFastPath()")
    );
    expect(fallThroughBlock).toContain("setIdentifier(hint.identifier)");
    expect(fallThroughBlock).not.toContain("setUsingRemembered");
  });

  it("shows no progress dots and the mockup's copy on the welcome-back stage", () => {
    expect(source).toContain('{stage === "welcome-back-passkey" ? null : (');
    expect(source).toContain('"WELCOME BACK" : "LOG IN"');
    expect(source).toContain("Unlock with passkey");
    expect(source).toContain("Use password instead");
    expect(source).toContain("Use it to continue — nothing to type.");
  });

  it("routes 'Use password instead' through ordinary entry, not directly into methods/password", () => {
    const buttonIndex = source.indexOf("Use password instead");
    const onClickIndex = source.lastIndexOf("onClick=", buttonIndex);
    const onClickToButton = source.slice(onClickIndex, buttonIndex);
    expect(onClickToButton).toContain("fallThroughToEntry");
  });
});
