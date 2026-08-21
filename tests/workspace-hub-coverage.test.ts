import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkShellViewBoundary } from "../scripts/check-shellview-boundary.mjs";

/**
 * The Workspace hub (apps/web/src/ContextualBusinessCards.tsx) is now the only way to reach a
 * domain module once the permanent tab bar is removed - PrimaryNavigation.tsx is gone. This test
 * is the regression guard for that: any ShellView added in the future (beyond shell chrome -
 * home/chat/agent, which route through other entry points) must also gain a workspace card, or it
 * becomes silently unreachable in the UI.
 */
describe("Workspace hub covers every navigable ShellView", () => {
  it('has an onNavigate("<view>") card for every non-chrome ShellView', () => {
    const { liveShellViews } = checkShellViewBoundary(process.cwd());
    const source = readFileSync("apps/web/src/ContextualBusinessCards.tsx", "utf8");
    const navigatedViews = new Set(
      [...source.matchAll(/onNavigate\("([a-z0-9-]+)"\)/g)].map((match) => match[1])
    );

    // Shell chrome, not domain pages: "home" is the workspace root itself, "chat" is the
    // conversation surface the hub opens on top of. "products" and "network" open through their
    // own nested workspace card (onOpenCatalogue/onOpenNetworkSync) rather than a plain
    // onNavigate call.
    const shellChromeViews = new Set(["home", "chat"]);
    const nestedCardViews = new Set(["products", "network"]);

    const requiredViews = liveShellViews.filter(
      (view) => !shellChromeViews.has(view) && !nestedCardViews.has(view)
    );
    expect(requiredViews.length).toBeGreaterThan(0);

    const missing = requiredViews.filter((view) => !navigatedViews.has(view));
    expect(missing).toEqual([]);
  });
});
