export type EventRiskLevel = "low" | "medium" | "high" | "critical";

export type DeepReadonly<TValue> = TValue extends (...args: never[]) => unknown
  ? TValue
  : TValue extends readonly unknown[]
    ? ReadonlyArray<DeepReadonly<TValue[number]>>
    : TValue extends object
      ? { readonly [TKey in keyof TValue]: DeepReadonly<TValue[TKey]> }
      : TValue;

export interface BusinessEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  actorId: string;
  risk: EventRiskLevel;
  occurredAt: string;
  payload: DeepReadonly<TPayload>;
}

export type BusinessEventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  Omit<BusinessEvent<TPayload>, "payload"> & {
    payload: TPayload;
  };

export function createEvent<TPayload extends Record<string, unknown>>(
  event: BusinessEventInput<TPayload>
): BusinessEvent<TPayload> {
  const frozenEvent = {
    ...event,
    payload: deepFreeze({ ...event.payload })
  };

  return deepFreeze(frozenEvent) as BusinessEvent<TPayload>;
}

function deepFreeze<TValue>(value: TValue): DeepReadonly<TValue> {
  if (value === null || typeof value !== "object") {
    return value as DeepReadonly<TValue>;
  }

  for (const propertyName of Reflect.ownKeys(value)) {
    const propertyValue = (value as Record<PropertyKey, unknown>)[propertyName];
    deepFreeze(propertyValue);
  }

  return Object.freeze(value) as DeepReadonly<TValue>;
}
