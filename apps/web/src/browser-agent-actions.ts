import type { BrowserAgentAction } from "./browser-inference-types";

export function parseBrowserAgentAction(value: unknown): BrowserAgentAction | null {
  if (typeof value !== "object" || value === null) return null;
  const action = value as { type?: unknown; message?: unknown; query?: unknown; reason?: unknown };
  if (
    action.type === "CHAT_REPLY" &&
    typeof action.message === "string" &&
    action.message.trim().length > 0 &&
    action.message.length <= 4_000
  ) {
    return { type: "CHAT_REPLY", message: action.message.trim() };
  }
  if (
    action.type === "SEARCH_PRODUCTS" &&
    typeof action.query === "string" &&
    action.query.trim().length > 0 &&
    action.query.length <= 300
  ) {
    return { type: "SEARCH_PRODUCTS", query: action.query.trim() };
  }
  if (
    action.type === "ESCALATE" &&
    typeof action.reason === "string" &&
    action.reason.trim().length > 0 &&
    action.reason.length <= 500
  ) {
    return { type: "ESCALATE", reason: action.reason.trim() };
  }
  return null;
}
