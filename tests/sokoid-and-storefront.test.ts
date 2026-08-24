import { describe, expect, it } from "vitest";
import {
  createFallbackSokoId,
  isSokoId,
  normalizeSokoId
} from "../apps/web/src/sokoid-and-storefront";

describe("readable Soko storefront IDs", () => {
  it("accepts and canonicalizes readable IDs", () => {
    expect(isSokoId("soko.janes-shop")).toBe(true);
    expect(isSokoId(" SOKO.JANES-SHOP ")).toBe(true);
    expect(normalizeSokoId(" SOKO.JANES-SHOP ")).toBe("soko.janes-shop");
    expect(isSokoId("soko.-janes-shop")).toBe(false);
    expect(isSokoId("soko.janes_shop")).toBe(false);
  });

  it("keeps legacy IDs usable and canonical", () => {
    expect(isSokoId("+254-A00000001")).toBe(true);
    expect(normalizeSokoId("+254-A00000001")).toBe("254A00000001");
  });

  it("uses a readable store-name fallback for old local owner records", () => {
    expect(createFallbackSokoId("business-1", "Jane's Café")).toBe("soko.janes-cafe");
  });
});
