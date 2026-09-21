import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles.css", "utf8");
const authMessage = readFileSync("apps/web/src/AuthenticationActionMessage.tsx", "utf8");
const lazyBoundary = readFileSync("apps/web/src/LazyModuleErrorBoundary.tsx", "utf8");

/**
 * Finds the declaration block(s) applying to `selector`, tolerating comma-separated selector
 * lists (e.g. ".foo strong,\n.foo p { ... }"). Returns every matching block's body concatenated,
 * since a stylesheet may target the same selector from more than one rule.
 */
function ruleBodies(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = withoutComments.match(/[^{}]+\{[^}]*\}/g) ?? [];
  const bodies = blocks
    .filter((block) => {
      const selectorList = block.slice(0, block.indexOf("{"));
      return selectorList
        .split(",")
        .map((entry) => entry.trim())
        .includes(selector);
    })
    .map((block) => block.slice(block.indexOf("{") + 1, block.lastIndexOf("}")));
  if (bodies.length === 0) {
    throw new Error(`Selector ${selector} not found in stylesheet`);
  }
  return bodies.join("\n");
}

describe("error and notification banners are hidden from the frontend UI", () => {
  it("hides the shared status/error banner (.app-action-notice) with display: none", () => {
    expect(ruleBodies(styles, ".app-action-notice")).toMatch(/display:\s*none/);
  });

  it("keeps AuthenticationActionMessage's message/auth-link logic intact (visual hide, not a removal)", () => {
    expect(authMessage).toContain("export function AuthenticationActionMessage(");
    expect(authMessage).toContain("getAuthenticationPromptTarget(message)");
  });

  it("keeps the lazy-module error box itself visible (not display: none)", () => {
    expect(ruleBodies(styles, ".lazy-module-error")).not.toMatch(/display:\s*none/);
  });

  it("hides the lazy-module error's message text (strong, p) but not the box", () => {
    expect(ruleBodies(styles, ".lazy-module-error strong")).toMatch(/display:\s*none/);
    expect(ruleBodies(styles, ".lazy-module-error p")).toMatch(/display:\s*none/);
  });

  it("keeps the lazy-module error's retry/reload button visible", () => {
    expect(ruleBodies(styles, ".lazy-module-error button")).not.toMatch(/display:\s*none/);
  });

  it("keeps LazyModuleErrorBoundary's catch/retry/reload logic and button labels intact", () => {
    expect(lazyBoundary).toContain("static getDerivedStateFromError(");
    expect(lazyBoundary).toContain("componentDidCatch(");
    expect(lazyBoundary).toContain("private tryAgain =");
    expect(lazyBoundary).toContain("private reload =");
    expect(lazyBoundary).toContain("Reload and try again");
    expect(lazyBoundary).toContain("Try again");
  });
});
