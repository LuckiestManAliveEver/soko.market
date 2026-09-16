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

describe("Soko Home: recognized returning device pill", () => {
  it("derives the pill from identityLevel, not just from having a session", () => {
    expect(sokoApplication).toContain(
      'session?.account.identityLevel === "device" && initialOwnerAuth !== null'
    );
    expect(sokoApplication).toContain("This device — continue to ${initialBusiness.name}?");
    expect(sokoApplication).toContain('"This device — log in to pick up where you left off?"');
    expect(sokoApplication).toContain("recognizedDeviceLabel={recognizedDeviceLabel}");
  });

  it("only shows on an untouched marketplace thread and taps straight into login", () => {
    expect(normalizedChatSurface).toContain(
      'mode === "marketplace" && activeModuleView === null && recognizedDeviceLabel !== null && visibleMessages.filter((message) => message.id !== "welcome").length === 0'
    );
    expect(chatSurface).toContain(
      '<button className="recognized-device-pill" type="button" onClick={onLogIn}>'
    );
  });

  it("actually opens the login form on tap, instead of a no-op behind a stale session===null gate", () => {
    // A device-only session is real and non-null, so the pre-device-account shouldShowAuth gate
    // (session === null) silently swallowed onLogIn's isAuthOpen=true - the phone/PIN form never
    // rendered. It must also fire for a session whose identityLevel is still "device".
    expect(sokoApplication).toMatch(
      /const shouldShowAuth =\s*!authBootstrapPending &&\s*isAuthOpen &&\s*\(session === null \|\| session\.account\.identityLevel === "device"\);/u
    );
  });
});

describe("Soko Home: merchant entry point", () => {
  it("routes an already-authenticated customer straight into business setup, not a redundant login screen", () => {
    expect(sokoApplication).toContain(
      'data-testid={business === null ? "shop-entry-button" : "agent-profile-link"}'
    );
    expect(normalizedChatSurface.length).toBeGreaterThan(0); // sanity: file loaded
    expect(sokoApplication).toMatch(
      /if \(business === null\) \{\s*switchMode\("seller"\);\s*\} else \{\s*setAgentProfileInitialSection\(null\);\s*openAgentProfile\(\);\s*\}/u
    );
  });
});

describe("Soko Home: hamburger menu drawer", () => {
  it("opens the menu drawer instead of toggling the message inbox directly", () => {
    expect(sokoApplication).toContain('aria-label="Open menu"');
    expect(sokoApplication).toContain("aria-expanded={isMenuDrawerOpen}");
    expect(sokoApplication).toContain("onClick={() => setIsMenuDrawerOpen(true)}");
  });

  it("renders MenuDrawer wired to message history and the three settings destinations", () => {
    expect(sokoApplication).toContain('import { MenuDrawer } from "./MenuDrawer";');
    expect(sokoApplication).toContain("<MenuDrawer");
    expect(sokoApplication).toContain("hasBusiness={business !== null}");
    expect(sokoApplication).toContain('setAgentProfileInitialSection("business");');
    expect(sokoApplication).toContain('setAgentProfileInitialSection("agent");');
    expect(sokoApplication).toContain('setAgentProfileInitialSection("security");');
  });

  it("threads the requested settings section into AgentProfileSurface, which opens and scrolls to it", () => {
    const agentProfileSurface = readFileSync("apps/web/src/AgentProfileSurface.tsx", "utf8");
    expect(sokoApplication).toContain("initialOpenSection={agentProfileInitialSection}");
    expect(agentProfileSurface).toContain(
      'initialOpenSection?: "business" | "agent" | "security" | null;'
    );
    expect(agentProfileSurface).toContain("target.open = true;");
    expect(agentProfileSurface).toContain('target.scrollIntoView({ behavior: "smooth"');
  });

  it("resets the requested section on every other path into agent settings, so a stale menu pick can't stick", () => {
    expect(sokoApplication).toMatch(
      /if \(!setupComplete\) return;\s*setAgentProfileInitialSection\(null\);\s*openAgentProfile\(\);/u
    );
    expect(sokoApplication).toMatch(
      /onReview=\{\(\) => \{\s*setAgentProfileInitialSection\(null\);\s*openAgentProfile\(\);\s*\}\}/u
    );
  });

  it("falls back to a single 'set up your shop' item for a customer with no business yet", () => {
    const menuDrawer = readFileSync("apps/web/src/MenuDrawer.tsx", "utf8");
    expect(menuDrawer).toContain("Set up your shop");
    expect(menuDrawer).toContain("hasBusiness ? (");
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
