import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatSurface = readFileSync("apps/web/src/ChatSurface.tsx", "utf8");
const chatInboxState = readFileSync("apps/web/src/hooks/useChatInboxState.ts", "utf8");
const useAuthState = readFileSync("apps/web/src/hooks/useAuthState.ts", "utf8");
const sokoApplication = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");

describe("session-list home screen (Phase 3)", () => {
  it("shows only the account's own agent sessions on home, not the general messaging inbox", () => {
    expect(chatSurface).toContain('const isSessionListView = activeView === "home";');
    expect(chatSurface).toContain(
      'isSessionListView ? conversation.kind === "personal" && !conversation.hasHumanRecipient : true'
    );
  });

  it("keeps the chat view showing the full inbox unchanged", () => {
    expect(chatSurface).toContain(
      'const showMessageThread = activeView === "chat" || activeView === "home";'
    );
  });

  it("offers a New session action on home, distinct from New direct-message conversation", () => {
    expect(chatSurface).toContain("onCreateAgentSession");
    expect(chatSurface).toContain("Start session");
    expect(chatSurface).toContain("isNewSessionOpen && isSessionListView");
    expect(chatSurface).toContain("isNewConversationOpen && !isSessionListView");
  });

  it("creates a genuinely new personal conversation, not the login-time singleton", () => {
    expect(chatInboxState).toContain("async function createAgentSession(title?: string)");
    expect(chatInboxState).toContain('kind: "personal"');
    expect(chatInboxState).toContain("activeShopId: null");
  });

  it("restores the selected session's own mode instead of the account-wide default", () => {
    expect(useAuthState).toContain(
      "async function applySessionContextForConversation(conversationId: string): Promise<SokoMode | null>"
    );
    expect(useAuthState).toContain("/v1/session/context?conversationId=");
    expect(chatInboxState).toContain(
      "const restoredMode = await applySessionContextForConversation(conversationId);"
    );
  });

  it("wires useAuthState before useChatInboxState so the mode-restore function exists at call time", () => {
    const authIndex = sokoApplication.indexOf("} = useAuthState({");
    const inboxIndex = sokoApplication.indexOf("} = useChatInboxState({");
    expect(authIndex).toBeGreaterThan(-1);
    expect(inboxIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(inboxIndex);
  });
});
