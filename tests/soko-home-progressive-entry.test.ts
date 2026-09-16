import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const useAuthState = readFileSync("apps/web/src/hooks/useAuthState.ts", "utf8");
const sokoApplication = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
const chatSurface = readFileSync("apps/web/src/ChatSurface.tsx", "utf8");
const appShell = readFileSync("apps/web/src/app-shell.ts", "utf8");
const normalizedChatSurface = chatSurface.replace(/\s+/gu, " ");

describe("Soko Home: zero-form entry (docs/authentication/progressive-identity.md)", () => {
  it("gives a genuinely fresh visitor a device account instead of a login wall", () => {
    expect(useAuthState).toContain(
      "async function continueToSoko(): Promise<SessionResponse | null>"
    );
    expect(useAuthState).toContain('apiFetch<SessionResponse>("/auth/continue"');
    expect(useAuthState).toContain("idempotencyKey");
  });

  it("auto-continues every non-deliberate cold boot, new visitor or returning one, instead of a login wall", () => {
    expect(useAuthState).toMatch(
      /const isDeliberateAuthFlow =\s*initialAuthenticationTarget !== null \|\| accountDeletionIntent \|\| accountRestorationIntent;/u
    );
    expect(useAuthState).toContain("if (!isDeliberateAuthFlow) {");
    expect(useAuthState).not.toContain("initialOwnerAuth === null &&");
  });

  it("invites a recognized returning device to log back in without blocking the chat shell", () => {
    expect(useAuthState).toContain("if (initialOwnerAuth !== null) {");
    expect(useAuthState).toContain("Welcome back. Log in to restore access to");
  });

  it("keeps the idempotency attempt key short-lived and bearer-only, per the documented contract", () => {
    expect(useAuthState).toContain("deviceContinueAttemptStorageKey");
    expect(useAuthState).toContain("deviceContinueAttemptTtlMs = 10 * 60 * 1000");
  });
});

describe("Soko Home: merchant entry point", () => {
  it("routes an already-authenticated customer straight into business setup, not a redundant login screen", () => {
    expect(sokoApplication).toContain(
      'data-testid={business === null ? "shop-entry-button" : "agent-profile-link"}'
    );
    expect(normalizedChatSurface.length).toBeGreaterThan(0); // sanity: file loaded
    expect(sokoApplication).toMatch(
      /if \(business === null\) \{\s*switchMode\("seller"\);\s*\} else \{\s*openAgentProfile\(\);\s*\}/u
    );
  });
});

describe("Soko Home: suggested requests and capability trace", () => {
  it("shows persistent suggestion chips on an empty marketplace thread", () => {
    expect(chatSurface).toContain("home-suggestion-chips");
    expect(chatSurface).toContain(
      'const homeSuggestionPrompts = ["Find me 50kg maize nearby", "Track my delivery", "Talk to a shop"];'
    );
  });

  it("names the real capability behind a generated card instead of fabricating one", () => {
    expect(chatSurface).toContain("function capabilityTraceLabel(");
    expect(chatSurface).toContain('"product-management": "product.update"');
  });

  it("welcomes with the Soko Home framing instead of gating on sign-up", () => {
    expect(appShell).toContain("What do you need?");
  });
});
