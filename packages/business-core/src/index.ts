import { createEvent, type BusinessEvent } from "@soko/event-core";
import { invalid, type ValidationResult, valid } from "@soko/tool-core";

export interface ProductDraft {
  name: string;
  priceMinor: number;
  currency: "KES";
}

export function validateProductDraft(draft: ProductDraft): ValidationResult {
  const errors: string[] = [];

  if (draft.name.trim().length === 0) {
    errors.push("Product name is required.");
  }

  if (!Number.isInteger(draft.priceMinor) || draft.priceMinor < 0) {
    errors.push("Product price must be a non-negative integer minor-unit amount.");
  }

  if (draft.currency !== "KES") {
    errors.push("Only KES is enabled in the CP1 foundation.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function productDraftedEvent(input: {
  id: string;
  actorId: string;
  productId: string;
  draft: ProductDraft;
  occurredAt: string;
}): BusinessEvent<{ draft: ProductDraft }> {
  return createEvent({
    id: input.id,
    type: "product.drafted",
    aggregateId: input.productId,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      draft: input.draft
    }
  });
}
