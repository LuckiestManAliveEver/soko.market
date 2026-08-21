// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { shouldCloseStackedModuleFromSwipe } from "../apps/web/src/stacked-module-behavior";
import { readOwnerRoute } from "../apps/web/src/routes";

const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
const chatSurface = readFileSync("apps/web/src/ChatSurface.tsx", "utf8");
const navigationState = readFileSync("apps/web/src/hooks/useNavigationState.ts", "utf8");
const modulePrimitive = readFileSync("apps/web/src/StackedModule.tsx", "utf8");

describe("stacked secondary modules", () => {
  it("closes from its control, scrim, Escape, and downward swipe threshold", () => {
    expect(modulePrimitive).toContain("if (event.target === event.currentTarget) onClose();");
    expect(modulePrimitive).toContain('if (event.key === "Escape")');
    expect(modulePrimitive).toContain("onClick={onClose}");
    expect(modulePrimitive).toContain(
      'event.target.closest("button, a[href], input, select, textarea")'
    );
    expect(modulePrimitive).toContain("shouldCloseStackedModuleFromSwipe(startY, event.clientY)");
    expect(shouldCloseStackedModuleFromSwipe(20, 91)).toBe(false);
    expect(shouldCloseStackedModuleFromSwipe(20, 92)).toBe(true);
  });

  it("keeps the conversation tree mounted behind every secondary surface", () => {
    expect(chatSurface).toContain("const showMessageThread = true;");
    expect(chatSurface).toContain('moduleId="owner-management"');
    expect(chatSurface).toContain('moduleId="marketplace"');
    expect(chatSurface).toContain('moduleId="workspace"');
    expect(chatSurface.indexOf('<div className="message-list"')).toBeLessThan(
      chatSurface.indexOf('moduleId="owner-management"')
    );
    expect(application).toMatch(/<ChatSurface[\s\S]*<AgentProfileSurface/u);
    expect(modulePrimitive).toContain("createPortal(");
    expect(modulePrimitive).toContain('appRoot?.setAttribute("inert", "")');
  });

  it("syncs every secondary surface to the URL/back-stack, not just chat and home", () => {
    // Without the permanent tab bar, the URL and the browser back button are the only way a
    // deep link (or a bookmark, or the browser back button itself) can express "this module is
    // open" once a session has already navigated past the first paint - so navigateToView must
    // push a real history entry for every view, not only chat/home.
    const navigateBlock = sourceFunction(navigationState, "navigateToView");
    const openProductBlock = sourceFunction(navigationState, "openProduct");
    const openAgentBlock = sourceFunction(navigationState, "openAgentProfile");

    expect(navigateBlock).not.toContain('if (nextView !== "chat"');
    expect(navigateBlock).toContain(
      "navigateToOwnerRoute({ mode: nextMode, view: nextView }, { replace: options?.replace });"
    );
    expect(navigateBlock).toContain("restoreScreenScroll(screenStateCacheRef.current, nextView);");
    expect(openProductBlock).toContain(
      'navigateToOwnerRoute({ mode: "seller", view: "products", productId: product.id });'
    );
    expect(openAgentBlock).toContain(
      'navigateToOwnerRoute({ mode: "seller", view: "agent", agentId: business.id });'
    );
  });

  it("retains legacy links as module-preopened bootstrap payloads", () => {
    expect(readOwnerRoute("/marketplace")).toEqual({ mode: "marketplace", view: "chat" });
    expect(readOwnerRoute("/settings")).toEqual({ mode: "seller", view: "agent" });
    expect(readOwnerRoute("/products/product%201")).toEqual({
      mode: "seller",
      view: "products",
      productId: "product 1"
    });
    expect(application).toContain("initialMarketplaceShortcutOpen:");
    expect(application).toContain("initialRoutedProductId: initialOwnerRoute?.productId ?? null");
  });
});

function sourceFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end);
}
