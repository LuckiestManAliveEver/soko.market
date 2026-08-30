import { parseRequestBody, parseString } from "../../route-helpers.js";
import type { RuntimeTurnBody } from "./routes.js";

export function parseRuntimeTurnBody(body: RuntimeTurnBody | null | undefined): {
  runtimeSessionId?: string;
  conversationId?: string;
  message: string;
  confirmationToken?: string;
} {
  const record = parseRequestBody(body);
  const runtimeSessionId =
    record.runtimeSessionId === undefined || record.runtimeSessionId === null
      ? undefined
      : parseString(record.runtimeSessionId, "runtimeSessionId");
  const conversationId =
    record.conversationId === undefined || record.conversationId === null
      ? undefined
      : parseString(record.conversationId, "conversationId");
  const confirmationToken =
    record.confirmationToken === undefined || record.confirmationToken === null
      ? undefined
      : parseString(record.confirmationToken, "confirmationToken");
  const parsed = {
    message: parseString(record.message, "message")
  };
  return {
    ...parsed,
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken })
  };
}
