import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The commerce identity resolver (services/api/src/cp2/text-normalization.ts,
 * commerceAddressFromSokoId) introduced a friendlier public-facing "handle@soko.market" address
 * for a shop, meant to replace the raw internal sokoId ("soko.handle") wherever it was shown to a
 * human as the shop's identity/handle. PublicStorefrontChat.tsx and useNetworkState.ts render/share
 * that identity directly (not via a component prop, so they are not covered by a render test the
 * way PublicStorefrontPanel/StorefrontPreviewCard/MarketplaceModeCard/YourShopsPanel are) - this
 * pins their source to the fixed field/call so a future edit can't silently reintroduce the raw
 * sokoId there.
 */
describe("customer-facing shop identity display uses commerceAddress, not the raw sokoId", () => {
  const publicStorefrontChat = readFileSync("apps/web/src/PublicStorefrontChat.tsx", "utf8");
  const useNetworkState = readFileSync("apps/web/src/hooks/useNetworkState.ts", "utf8");

  it("PublicStorefrontChat's header, registration prompt, and return-visit hint show storefront.commerceAddress", () => {
    expect(publicStorefrontChat).toContain(
      "{storefront.commerceAddress} · {storefront.presence.status}"
    );
    expect(publicStorefrontChat).toContain(
      "Add their contact details or share ${storefront.commerceAddress} with them."
    );
    expect(publicStorefrontChat).toContain(
      "checkout when you are ready. Use {storefront.commerceAddress} any time you want to"
    );
    // createStorefrontUrl(storefront.sokoId) is a legitimate technical use (URL construction),
    // not a display, so sokoId may still appear here - only assert the three display sites above
    // no longer read storefront.sokoId directly.
  });

  it("useNetworkState's owner storefront share text uses commerceAddressFromSokoId(deps.business.sokoId)", () => {
    expect(useNetworkState).toContain(
      "Soko Shop ID ${commerceAddressFromSokoId(deps.business.sokoId)}."
    );
    expect(useNetworkState).not.toContain("Soko Shop ID ${deps.business.sokoId}.");
  });
});
