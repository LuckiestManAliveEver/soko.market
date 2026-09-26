import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkShellViewBoundary } from "../scripts/check-shellview-boundary.mjs";

/**
 * The Shop Hub (apps/web/src/ShopHub.tsx, "Go to my shop") is the only way to reach most domain
 * modules once the permanent tab bar is removed - PrimaryNavigation.tsx is gone. This test is the
 * regression guard for that: any ShellView added in the future (beyond shell chrome) must also
 * gain a surface on some hub module in shop-hub-surfaces.ts, or it becomes silently unreachable.
 */
describe("Shop Hub covers every navigable ShellView", () => {
  it('has a { kind: "view", view: "<view>" } surface for every non-chrome ShellView', () => {
    const { liveShellViews } = checkShellViewBoundary(process.cwd());
    const source = readFileSync("apps/web/src/shop-hub-surfaces.ts", "utf8");
    const navigatedViews = new Set(
      [...source.matchAll(/kind: "view", view: "([a-z0-9-]+)"/g)].map((match) => match[1])
    );

    // Shell chrome, not domain pages: "home" is the workspace root itself, "chat" is the
    // conversation surface the hub opens on top of. "products" and "network" open through their
    // own nested workspace views (catalogue/networkSync) rather than a plain view navigation.
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
