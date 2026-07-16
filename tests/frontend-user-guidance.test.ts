import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  USER_FACING_ERROR_MESSAGE,
  getUserFacingErrorMessage
} from "../apps/web/src/user-facing-error";

describe("frontend user guidance", () => {
  it("never exposes backend error details", () => {
    expect(getUserFacingErrorMessage(new Error("runtime.turn_failed: private backend event"))).toBe(
      "YOU'VE JUST EXPERIENCED AN ERROR, ASK THE AGENT FOR HELP"
    );
    expect(USER_FACING_ERROR_MESSAGE).not.toContain("runtime.turn_failed");
  });

  it("keeps Messages beside Marketplace as a pill and labels the network card My Network", () => {
    const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
    const styles = readFileSync("apps/web/src/styles.css", "utf8");
    const marketplaceIndex = application.indexOf('data-testid="marketplace-button"');
    const messagesIndex = application.indexOf('data-testid="messages-button"');
    const sellIndex = application.indexOf('data-testid="sell-button"');

    expect(marketplaceIndex).toBeGreaterThan(-1);
    expect(messagesIndex).toBeGreaterThan(marketplaceIndex);
    expect(messagesIndex).toBeLessThan(sellIndex);
    expect(styles).toContain(".header-action-button.messages");
    expect(application).toContain('title: "My Network"');
  });

  it("accepts only Markdown files in the protected context-file importer", () => {
    const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
    expect(application).toContain('accept=".md,.markdown,text/markdown"');
    expect(application).toContain("Markdown context files");
  });
});
