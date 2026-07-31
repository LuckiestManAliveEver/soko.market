// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canNavigateBackWithinApp,
  initializeOwnerHistory,
  navigateToBrowserUrl,
  navigateToOwnerRoute,
  readSokoHistoryState
} from "../apps/web/src/browser-navigation";
import {
  readOwnerNavigationSession,
  writeOwnerNavigationSession
} from "../apps/web/src/owner-navigation-session";

describe("browser-native navigation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/marketplace");
    window.sessionStorage.clear();
    vi.stubGlobal("scrollTo", vi.fn());
  });

  it("creates typed history entries and avoids duplicates", () => {
    initializeOwnerHistory({ mode: "marketplace", view: "chat" });
    const initialLength = window.history.length;

    expect(navigateToOwnerRoute({ mode: "seller", view: "products" })).toBe(true);
    expect(window.location.pathname).toBe("/catalogue");
    expect(window.history.length).toBe(initialLength + 1);
    expect(readSokoHistoryState(window.history.state)).toMatchObject({
      depth: 1,
      mode: "seller",
      view: "products"
    });
    expect(canNavigateBackWithinApp()).toBe(true);

    expect(navigateToOwnerRoute({ mode: "seller", view: "products" })).toBe(false);
    expect(window.history.length).toBe(initialLength + 1);
  });

  it("uses canonical URLs for conversations, products, profiles, and storefront products", () => {
    initializeOwnerHistory({ mode: "marketplace", view: "chat" });

    navigateToOwnerRoute({
      mode: "marketplace",
      view: "chat",
      conversationId: "conversation / 1"
    });
    expect(window.location.pathname).toBe("/marketplace/conversations/conversation%20%2F%201");

    navigateToOwnerRoute({
      mode: "seller",
      view: "products",
      productId: "product / 1"
    });
    expect(window.location.pathname).toBe("/products/product%20%2F%201");

    navigateToOwnerRoute({
      mode: "seller",
      view: "agent",
      agentId: "agent@example.com"
    });
    expect(window.location.pathname).toBe("/agents/agent%40example.com");

    navigateToBrowserUrl("/agent/shop-1/products/product-1");
    expect(window.location.pathname).toBe("/agent/shop-1/products/product-1");
  });

  it("restores bounded chat and agent-session state across refresh without attachment bodies", () => {
    writeOwnerNavigationSession("account-1", {
      activeConversationId: "conversation-1",
      runtimeSessionId: "runtime-1",
      chatDraft: "Unsaved reply",
      chatMessages: [
        {
          id: "message-1",
          author: "merchant",
          body: "Hello",
          attachments: [
            {
              id: "attachment-1",
              name: "receipt.jpg",
              type: "image/jpeg",
              size: 10,
              category: "image",
              dataUrl: "data:image/jpeg;base64,private"
            }
          ]
        }
      ]
    });

    expect(readOwnerNavigationSession("account-1")).toEqual({
      activeConversationId: "conversation-1",
      runtimeSessionId: "runtime-1",
      chatDraft: "Unsaved reply",
      chatMessages: [
        {
          id: "message-1",
          author: "merchant",
          body: "Hello",
          attachments: [
            {
              id: "attachment-1",
              name: "receipt.jpg",
              type: "image/jpeg",
              size: 10,
              category: "image"
            }
          ]
        }
      ]
    });
    expect(readOwnerNavigationSession("account-2")).toBeNull();
  });

  it("keeps all application pushes behind the central adapter", () => {
    const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
    const router = readFileSync("apps/web/src/AppRouter.tsx", "utf8");
    const worker = readFileSync("apps/web/public/sw.js", "utf8");

    expect(application).not.toContain("window.history.pushState");
    expect(application).toContain('navigateToOwnerRoute({ mode, view: "chat", conversationId })');
    expect(application).toContain("writeOwnerNavigationSession");
    expect(router).toContain("installBrowserLinkInterceptor");
    expect(worker).toContain("/marketplace/conversations/");
  });
});
