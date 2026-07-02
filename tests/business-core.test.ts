import { describe, expect, it } from "vitest";
import { productDraftedEvent, validateProductDraft } from "../packages/business-core/src";

describe("business core foundation", () => {
  it("validates a product draft deterministically", () => {
    expect(
      validateProductDraft({
        name: "Maize flour",
        priceMinor: 18000,
        currency: "KES"
      })
    ).toEqual({
      ok: true,
      errors: []
    });
  });

  it("creates immutable business events", () => {
    const event = productDraftedEvent({
      id: "00000000-0000-4000-8000-000000000001",
      actorId: "owner-1",
      productId: "product-1",
      occurredAt: "2026-07-02T00:00:00.000Z",
      draft: {
        name: "Beans",
        priceMinor: 25000,
        currency: "KES"
      }
    });

    expect(event.type).toBe("product.drafted");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
  });
});
