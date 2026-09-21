import { describe, expect, it } from "vitest";
// Imported via the API's re-export (not the bare "@soko/shared-types" specifier) because this
// root-level tests/ directory has no direct dependency on that workspace package - only services/
// and apps/ do - so only a relative import through one of them resolves here at runtime.
import {
  commerceAddressFromSokoId,
  normalizeCommerceAddress,
  sokoIdFromCommerceAddress
} from "../services/api/src/cp2/text-normalization";

describe("commerceAddressFromSokoId", () => {
  it("strips the soko. prefix and appends @soko.market", () => {
    expect(commerceAddressFromSokoId("soko.mama-mboga")).toBe("mama-mboga@soko.market");
  });

  it("lowercases and trims", () => {
    expect(commerceAddressFromSokoId("  Soko.Mama-Mboga  ")).toBe("mama-mboga@soko.market");
  });
});

describe("sokoIdFromCommerceAddress", () => {
  it("recovers the sokoId from a commerce address", () => {
    expect(sokoIdFromCommerceAddress("mama-mboga@soko.market")).toBe("soko.mama-mboga");
  });

  it("also accepts a bare sokoId-shaped handle", () => {
    expect(sokoIdFromCommerceAddress("soko.mama-mboga")).toBe("soko.mama-mboga");
  });
});

describe("normalizeCommerceAddress", () => {
  it("round-trips through sokoId so it is idempotent regardless of input casing/whitespace", () => {
    expect(normalizeCommerceAddress("  MAMA-MBOGA@SOKO.MARKET  ")).toBe("mama-mboga@soko.market");
  });
});
