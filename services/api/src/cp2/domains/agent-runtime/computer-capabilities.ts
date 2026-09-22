import type { ClientWorkspaceFileTransfer, RuntimePlannedAction } from "@soko/shared-types";

import type { AgentRuntimeDomainDeps } from "./store.js";

/**
 * ComputerRuntime capability dispatch (docs/architecture/computer-runtime.md). Mirrors
 * executeReceiptCapability/executeCommerceCapability's shape exactly: this function only coerces
 * `RuntimePlannedAction.input` into a typed call against an already-injected domain method -
 * authorization, policy classification, control-mode enforcement, and approval gating all live in
 * services/api/src/cp2/domains/computer-runtime/store.ts, reached through those deps closures,
 * never here.
 */
export function executeComputerCapability(
  deps: AgentRuntimeDomainDeps,
  input: {
    sessionId: string | null;
    businessId: string;
    conversationId?: string;
    workspaceFiles?: ClientWorkspaceFileTransfer[];
    action: RuntimePlannedAction;
    now: Date;
  }
): unknown {
  const { sessionId, businessId, now } = input;
  const computerSessionId = String(input.action.input.computerSessionId ?? "");

  switch (input.action.toolName) {
    case "computer.session.create":
      return deps.computerSessionCreate({
        sessionId,
        businessId,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        ...(typeof input.action.input.profileId === "string"
          ? { profileId: input.action.input.profileId }
          : {}),
        ...(typeof input.action.input.startUrl === "string"
          ? { startUrl: input.action.input.startUrl }
          : {}),
        now
      });

    case "computer.session.resume":
      return deps.computerSessionResume({ sessionId, businessId, computerSessionId, now });

    case "computer.navigate":
      return deps.computerNavigate({
        sessionId,
        businessId,
        computerSessionId,
        url: String(input.action.input.url ?? ""),
        now
      });

    case "computer.observe":
      return deps.computerObserve({ sessionId, businessId, computerSessionId, now });

    case "computer.click":
      return deps.computerClick({
        sessionId,
        businessId,
        computerSessionId,
        targetDescription: String(input.action.input.targetDescription ?? ""),
        ...(typeof input.action.input.targetRef === "string"
          ? { targetRef: input.action.input.targetRef }
          : {}),
        now
      });

    case "computer.type":
      return deps.computerType({
        sessionId,
        businessId,
        computerSessionId,
        targetDescription: String(input.action.input.targetDescription ?? ""),
        ...(typeof input.action.input.targetRef === "string"
          ? { targetRef: input.action.input.targetRef }
          : {}),
        text: String(input.action.input.text ?? ""),
        ...(typeof input.action.input.submit === "boolean"
          ? { submit: input.action.input.submit }
          : {}),
        now
      });

    case "computer.scroll":
      return deps.computerScroll({
        sessionId,
        businessId,
        computerSessionId,
        direction: input.action.input.direction === "up" ? "up" : "down",
        ...(typeof input.action.input.amountPx === "number"
          ? { amountPx: input.action.input.amountPx }
          : {}),
        now
      });

    case "computer.upload":
      return deps.computerUpload({
        sessionId,
        businessId,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        computerSessionId,
        targetDescription: String(input.action.input.targetDescription ?? ""),
        attachmentId: String(input.action.input.attachmentId ?? ""),
        now
      });

    case "computer.control.take":
      return deps.computerControlTake({ sessionId, businessId, computerSessionId, now });

    case "computer.control.release":
      return deps.computerControlRelease({ sessionId, businessId, computerSessionId, now });

    case "computer.checkpoint":
      return deps.computerCheckpoint({ sessionId, businessId, computerSessionId, now });

    case "computer.suspend":
      return deps.computerSuspend({ sessionId, businessId, computerSessionId, now });

    case "computer.close":
      return deps.computerClose({ sessionId, businessId, computerSessionId, now });

    default:
      return null;
  }
}
