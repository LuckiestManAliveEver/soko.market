import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("apps/web/src/styles.css", "utf8");
const authMessage = readFileSync("apps/web/src/AuthenticationActionMessage.tsx", "utf8");
const lazyBoundary = readFileSync("apps/web/src/LazyModuleErrorBoundary.tsx", "utf8");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (match === null) {
    throw new Error(`Selector ${selector} not found in stylesheet`);
  }
  return match[1];
}

describe("error and notification banners are hidden from the frontend UI", () => {
  it("hides the shared status/error banner (.app-action-notice) with display: none", () => {
    expect(ruleBody(styles, ".app-action-notice")).toMatch(/display:\s*none/);
  });

  it("hides the lazy-module load error banner (.lazy-module-error) with display: none", () => {
    expect(ruleBody(styles, ".lazy-module-error")).toMatch(/display:\s*none/);
  });

  it("keeps AuthenticationActionMessage's message/auth-link logic intact (visual hide, not a removal)", () => {
    expect(authMessage).toContain("export function AuthenticationActionMessage(");
    expect(authMessage).toContain("getAuthenticationPromptTarget(message)");
  });

  it("keeps LazyModuleErrorBoundary's catch/retry/reload logic intact (visual hide, not a removal)", () => {
    expect(lazyBoundary).toContain("static getDerivedStateFromError(");
    expect(lazyBoundary).toContain("componentDidCatch(");
    expect(lazyBoundary).toContain("private tryAgain =");
    expect(lazyBoundary).toContain("private reload =");
  });
});
