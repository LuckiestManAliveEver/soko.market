// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PublicStorefrontSummary } from "../apps/web/src/soko-application-shared";
import { MarketplaceModeCard } from "../apps/web/src/MarketplaceModeCard";

const otherShop: PublicStorefrontSummary = {
  agentId: "soko.amina-fresh",
  sokoId: "soko.amina-fresh",
  commerceAddress: "amina-fresh@soko.market",
  businessName: "Amina Fresh",
  presence: { status: "online", updatedAt: new Date(0).toISOString() },
  products: []
};

const noop = () => {};

describe("MarketplaceModeCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the public commerce address for both the owner's own shop and the directory listing", () => {
    act(() => {
      root = createRoot(host);
      root.render(
        <MarketplaceModeCard
          businessName="Mama Mboga"
          hasBusiness
          isAuthenticated
          isIntro={false}
          isLoadingStorefronts={false}
          productCount={3}
          publicStorefronts={[otherShop]}
          sokoId="soko.mama-mboga"
          buyFeed={null}
          isSearchingBuyFeed={false}
          buyCart={[]}
          isCheckingOut={false}
          onOpenStore={noop}
          onCompleteIntro={noop}
          onPrompt={noop}
          onRefreshStorefronts={noop}
          onSell={noop}
          onSearchBuyFeed={noop}
          onAddToCart={noop}
          onRemoveFromCart={noop}
          onCheckout={noop}
          onSignUp={noop}
        />
      );
    });

    // "Your shop" line - derived client-side from the raw sokoId prop.
    expect(host.textContent).toContain("mama-mboga@soko.market");
    // Directory listing of another merchant - carried on the resolved PublicStorefrontSummary.
    expect(host.textContent).toContain("amina-fresh@soko.market");
    expect(host.textContent).not.toContain("soko.mama-mboga");
    expect(host.textContent).not.toContain("soko.amina-fresh");
  });
});
