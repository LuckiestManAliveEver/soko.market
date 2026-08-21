import type { AgentRouteSummary, RuntimePlannedAction } from "@soko/shared-types";

import type { AgentRuntimeDomainDeps } from "./store.js";

export function executeNetworkCapability(
  deps: AgentRuntimeDomainDeps,
  input: {
    sessionId: string | null;
    action: RuntimePlannedAction;
    now: Date;
  }
): AgentRouteSummary {
  return deps.createAgentRoute({
    sessionId: input.sessionId,
    requestText: String(input.action.input.requestText ?? ""),
    ...(typeof input.action.input.targetNodeId === "string"
      ? { targetNodeId: input.action.input.targetNodeId }
      : {}),
    now: input.now
  });
}
