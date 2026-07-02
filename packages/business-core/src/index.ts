import { createEvent, type BusinessEvent } from "@soko/event-core";
import { invalid, type ValidationResult, valid } from "@soko/tool-core";

export interface BusinessActionDraft {
  actionType: string;
  actorId: string;
  aggregateId: string;
  aggregateType: string;
  requiresConfirmation: boolean;
}

export function validateBusinessActionDraft(draft: BusinessActionDraft): ValidationResult {
  const errors: string[] = [];

  if (draft.actionType.trim().length === 0) {
    errors.push("Action type is required.");
  }

  if (draft.actorId.trim().length === 0) {
    errors.push("Actor id is required.");
  }

  if (draft.aggregateId.trim().length === 0) {
    errors.push("Aggregate id is required.");
  }

  if (draft.aggregateType.trim().length === 0) {
    errors.push("Aggregate type is required.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function businessActionProposedEvent(input: {
  id: string;
  draft: BusinessActionDraft;
  occurredAt: string;
}): BusinessEvent<{ draft: BusinessActionDraft }> {
  return createEvent({
    id: input.id,
    type: "business_action.proposed",
    aggregateId: input.draft.aggregateId,
    aggregateType: input.draft.aggregateType,
    actorId: input.draft.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      draft: input.draft
    }
  });
}
