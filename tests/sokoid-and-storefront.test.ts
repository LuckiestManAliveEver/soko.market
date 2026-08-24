import { describe, expect, it } from "vitest";
import { isSokoId, normalizeSokoId } from "../apps/web/src/sokoid-and-storefront";

describe("readable Soko storefront IDs", () => {
  it("accepts and canonicalizes readable IDs", () => {
    expect(isSokoId("soko.janes-shop")).toBe(true);
    expect(isSokoId(" SOKO.JANES-SHOP ")).toBe(true);
    expect(normalizeSokoId(" SOKO.JANES-SHOP ")).toBe("soko.janes-shop");
    expect(isSokoId("soko.-janes-shop")).toBe(false);
    expect(isSokoId("soko.janes_shop")).toBe(false);
    expect(isSokoId("254A00000001")).toBe(false);
  });
});
