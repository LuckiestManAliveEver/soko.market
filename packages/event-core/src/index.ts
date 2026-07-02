export type EventRiskLevel = "low" | "medium" | "high" | "critical";

export interface BusinessEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  actorId: string;
  risk: EventRiskLevel;
  occurredAt: string;
  payload: Readonly<TPayload>;
}

export function createEvent<TPayload extends Record<string, unknown>>(
  event: BusinessEvent<TPayload>
): BusinessEvent<TPayload> {
  return Object.freeze({
    ...event,
    payload: Object.freeze({ ...event.payload })
  });
}
