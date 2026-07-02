import { describe, expect, it } from "vitest";
import {
  businessActionProposedEvent,
  validateBusinessActionDraft
} from "../packages/business-core/src";

describe("business core foundation", () => {
  it("validates a business action draft deterministically", () => {
    expect(
      validateBusinessActionDraft({
        actionType: "foundation.check",
        actorId: "owner-1",
        aggregateId: "foundation-1",
        aggregateType: "foundation",
        requiresConfirmation: false
      })
    ).toEqual({
      ok: true,
      errors: []
    });
  });

  it("creates immutable business events", () => {
    const event = businessActionProposedEvent({
      id: "00000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-02T00:00:00.000Z",
      draft: {
        actionType: "foundation.check",
        actorId: "owner-1",
        aggregateId: "foundation-1",
        aggregateType: "foundation",
        requiresConfirmation: false
      }
    });

    expect(event.type).toBe("business_action.proposed");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.draft)).toBe(true);
  });
});
