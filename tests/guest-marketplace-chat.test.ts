import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guest marketplace browsing gets its own small, dedicated conversation surface
 * (GuestMarketplaceChat) instead of the full owner ChatSurface shell - no session list, no
 * mic/attach/camera, and every result leads to signup rather than an unscoped write.
 */
describe("guest marketplace chat", () => {
  const component = readFileSync("apps/web/src/GuestMarketplaceChat.tsx", "utf8");
  const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
  const styles = readFileSync("apps/web/src/styles.css", "utf8");
  const statusResultCard = readFileSync("apps/web/src/StatusResultCard.tsx", "utf8");

  it("searches the real marketplace-wide feed, not the per-business storefront-agent path", () => {
    expect(component).toContain("`/buy/search?query=${encodeURIComponent(query)}`");
    expect(component).not.toContain("products.list");
    expect(component).not.toContain("/public/storefronts");
  });

  it("has no mic, attach, or camera controls in its composer - a guest has nothing to attach", () => {
    const composerBlock = component.slice(
      component.indexOf('<form className="guest-composer"'),
      component.indexOf("</form>") + "</form>".length
    );
    expect(composerBlock).not.toContain("mic");
    expect(composerBlock).not.toContain("attach");
    expect(composerBlock).not.toContain("camera");
    expect(composerBlock).toContain("<input");
    expect(composerBlock.match(/<(input|button)\b/gu)).toHaveLength(2);
  });

  it("shows a persistent guest banner with a Sign up action, reusing the existing warning tone", () => {
    expect(component).toContain('<div className="guest-chat-banner" role="status">');
    expect(component).toContain("Sign up");
    expect(styles).toContain(".guest-chat-banner {");
    expect(styles).toContain("#fff8df");
  });

  it("routes every result to signup instead of an unscoped write", () => {
    expect(component).toContain("isAuthenticated={false}");
    expect(component).toContain("onSignUp={props.onSignUp}");
    const signUpButtonBlock = statusResultCard.slice(
      statusResultCard.indexOf("props.onSignUp !== undefined"),
      statusResultCard.indexOf("Sign up to message this seller") + 30
    );
    expect(signUpButtonBlock).toContain("onClick={props.onSignUp}");
  });

  it("wires browseAsGuest()'s resulting state to this component instead of the full owner shell", () => {
    expect(application).toContain('import { GuestMarketplaceChat } from "./GuestMarketplaceChat";');
    expect(application).toContain(
      '!authBootstrapPending && !shouldShowAuth && session === null && mode === "marketplace"'
    );
    expect(application).toContain("isGuestBrowsing ? (");
    expect(application).toContain('<GuestMarketplaceChat onSignUp={() => openAuth("signup")} />');
    // isGuestBrowsing must also hide the outer shell chrome (header/mode bar), the same way the
    // auth screens already do, or the new surface would render underneath a redundant header.
    const isAuthScreenLine = application.slice(
      application.indexOf("const isAuthScreen ="),
      application.indexOf(";", application.indexOf("const isAuthScreen ="))
    );
    expect(isAuthScreenLine).toContain("isGuestBrowsing");
  });
});
