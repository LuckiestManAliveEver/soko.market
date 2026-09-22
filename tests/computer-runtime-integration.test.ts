/**
 * Integration coverage for the full dispatch chain: executeRuntimeCapability (the single canonical
 * dispatcher every capability in this codebase goes through) -> executeComputerCapability -> the
 * real AgentRuntimeDomainDeps closures (as wired in services/api/src/cp2/store.ts, reproduced here
 * against a real ComputerRuntimeDomain + fake provider) -> ComputerRuntimeDomain -> provider.
 * Unlike tests/computer-runtime-domain.test.ts (which calls ComputerRuntimeDomain directly), this
 * proves the glue code in computer-capabilities.ts/store.ts's deps wiring is itself correct -
 * the exact "Agent -> capability router -> ComputerRuntime -> provider -> observation -> result"
 * path the task brief's vertical-slice section describes.
 */
import { describe, expect, it } from "vitest";
import type {
  ComputerActionResult,
  ComputerObservation,
  ComputerProviderCheckpoint,
  ComputerRuntimeProvider,
  ComputerSession,
  CreateSessionInput
} from "../packages/computer-runtime/src";
import { ComputerRuntimeDomain } from "../services/api/src/cp2/domains/computer-runtime/store.js";
import type { ComputerRuntimeDomainDeps } from "../services/api/src/cp2/domains/computer-runtime/store.js";
import { executeRuntimeCapability } from "../services/api/src/cp2/domains/agent-runtime/capabilities.js";
import type { AgentRuntimeDomainDeps } from "../services/api/src/cp2/domains/agent-runtime/domain-deps.js";
import type { RuntimeCheckpointResult, RuntimePlannedAction } from "@soko/shared-types";

const now = new Date("2026-01-01T00:00:00.000Z");
const BUSINESS = "biz-1";
const CONVERSATION = "conv-1";

class FakeProvider implements ComputerRuntimeProvider {
  readonly kind = "fake";
  clickCalls = 0;

  async createSession(input: CreateSessionInput): Promise<ComputerSession> {
    return {
      id: input.sessionId,
      businessId: input.businessId,
      accountId: input.accountId,
      conversationId: input.conversationId,
      profileId: input.profileId,
      status: "READY",
      controlMode: "AGENT",
      currentUrl: input.startUrl,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastCheckpointId: null
    };
  }
  async resumeSession(sessionId: string): Promise<ComputerSession> {
    return this.createSession({
      sessionId,
      businessId: BUSINESS,
      accountId: "acct-1",
      conversationId: CONVERSATION,
      profileId: null,
      startUrl: null
    });
  }
  async navigate(input: { sessionId: string; url: string }): Promise<ComputerObservation> {
    return this.observation(input.sessionId, input.url);
  }
  async observe(input: { sessionId: string }): Promise<ComputerObservation> {
    return this.observation(input.sessionId, "https://supplier.example/product/42");
  }
  async click(input: { sessionId: string }): Promise<ComputerActionResult> {
    this.clickCalls += 1;
    return {
      sessionId: input.sessionId,
      status: "EXECUTED",
      observation: this.observation(input.sessionId, "https://supplier.example/order/confirmed")
    };
  }
  async type(input: { sessionId: string }): Promise<ComputerActionResult> {
    return {
      sessionId: input.sessionId,
      status: "EXECUTED",
      observation: this.observation(input.sessionId, "https://supplier.example")
    };
  }
  async scroll(input: { sessionId: string }): Promise<ComputerActionResult> {
    return { sessionId: input.sessionId, status: "EXECUTED", observation: null };
  }
  async upload(input: { sessionId: string }): Promise<ComputerActionResult> {
    return { sessionId: input.sessionId, status: "EXECUTED", observation: null };
  }
  async checkpoint(sessionId: string): Promise<ComputerProviderCheckpoint> {
    return { sessionId, opaqueState: "{}", capturedAt: now.toISOString() };
  }
  async suspend(): Promise<void> {}
  async resume(): Promise<void> {}
  async close(): Promise<void> {}

  private observation(sessionId: string, url: string): ComputerObservation {
    return {
      sessionId,
      url,
      title: "Product 42",
      screenshotDataUrl: null,
      contentSummary: "Price: KSh 1,800 per crate. In stock: 42.",
      interactiveElements: [
        { ref: "buy-btn", role: "button", name: "Place order", sensitive: false }
      ],
      capturedAt: now.toISOString()
    };
  }
}

let checkpointSeq = 0;
function fakeCheckpoint(taskId: string): RuntimeCheckpointResult {
  checkpointSeq += 1;
  const id = `handoff-${checkpointSeq}`;
  return {
    handoff: {
      id,
      taskId,
      conversationId: taskId,
      parentHandoffId: null,
      mergedFromHandoffIds: [],
      goal: "test",
      currentState: "test",
      completedActions: [],
      decisions: [],
      rejectedPaths: [],
      pendingActions: [],
      nextAction: null,
      relevantContext: [],
      artifacts: [],
      tests: { passed: [], failed: [], pending: [] },
      runtime: { agentId: "agent-1", modelId: "model-1", executionHostId: "host-1" },
      checkpointVersion: checkpointSeq,
      schemaVersion: 1,
      createdAt: now.toISOString()
    },
    taskHead: {
      taskId,
      activeHandoffId: id,
      nextCheckpointVersion: checkpointSeq + 1,
      updatedAt: now.toISOString()
    },
    promoted: false
  };
}

/** Reproduces the exact wiring services/api/src/cp2/store.ts's constructor sets up between
 *  ComputerRuntimeDomain and AgentRuntimeDomainDeps, against a real domain instance. */
function buildAgentRuntimeComputerDeps(): {
  deps: AgentRuntimeDomainDeps;
  provider: FakeProvider;
  domain: ComputerRuntimeDomain;
} {
  const provider = new FakeProvider();
  const fakeActor = { account: { id: "acct-1" }, user: { id: "user-1" } } as unknown as ReturnType<
    ComputerRuntimeDomainDeps["requireAuthenticatedActor"]
  >;
  const domainDeps: ComputerRuntimeDomainDeps = {
    requireAuthorizedSession: () => fakeActor,
    requireAuthenticatedActor: () => fakeActor,
    provider,
    checkpointTask: (_sessionId, input) => fakeCheckpoint(input.taskId),
    recordAuditEvent: () => undefined,
    encryptSecret: (v) => `enc:${v}`,
    decryptSecret: (v) => v.replace(/^enc:/, ""),
    createConversationMessage: () => undefined,
    resolveAttachment: async () => ({
      filename: "f.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("x")
    }),
    onMetric: () => undefined
  };
  const domain = new ComputerRuntimeDomain(domainDeps);

  const computerDeps: Pick<
    AgentRuntimeDomainDeps,
    | "computerSessionCreate"
    | "computerSessionResume"
    | "computerNavigate"
    | "computerObserve"
    | "computerClick"
    | "computerType"
    | "computerScroll"
    | "computerUpload"
    | "computerControlTake"
    | "computerControlRelease"
    | "computerCheckpoint"
    | "computerSuspend"
    | "computerClose"
  > = {
    computerSessionCreate: (input) =>
      domain.createSession(
        input.sessionId,
        input.businessId,
        input.conversationId,
        input,
        input.now
      ),
    computerSessionResume: (input) =>
      domain.resumeSession(input.sessionId, input.businessId, input.computerSessionId, input.now),
    computerNavigate: (input) =>
      domain.navigate(input.sessionId, input.businessId, input, input.now),
    computerObserve: (input) => domain.observe(input.sessionId, input.businessId, input, input.now),
    computerClick: (input) => domain.click(input.sessionId, input.businessId, input, input.now),
    computerType: (input) => domain.type(input.sessionId, input.businessId, input, input.now),
    computerScroll: (input) => domain.scroll(input.sessionId, input.businessId, input, input.now),
    computerUpload: (input) =>
      domain.upload(input.sessionId, input.businessId, input.conversationId, input, input.now),
    computerControlTake: (input) =>
      domain.takeControl(input.sessionId, input.businessId, input.computerSessionId, input.now),
    computerControlRelease: (input) =>
      domain.releaseControl(input.sessionId, input.businessId, input.computerSessionId, input.now),
    computerCheckpoint: (input) =>
      domain.checkpointSession(
        input.sessionId,
        input.businessId,
        input.computerSessionId,
        input.now
      ),
    computerSuspend: (input) =>
      domain.suspendSession(input.sessionId, input.businessId, input.computerSessionId, input.now),
    computerClose: (input) =>
      domain.closeSession(input.sessionId, input.businessId, input.computerSessionId, input.now)
  };
  const deps = computerDeps as unknown as AgentRuntimeDomainDeps;

  return { deps, provider, domain };
}

function plannedAction(toolName: string, input: Record<string, unknown>): RuntimePlannedAction {
  return {
    id: `action-${toolName}-${Math.random()}`,
    toolName: toolName as RuntimePlannedAction["toolName"],
    risk: "low",
    requiresConfirmation: false,
    status: "safe_to_execute",
    input,
    validationErrors: [],
    confirmationToken: null,
    executedAt: null
  };
}

describe("integration: agent -> capability router -> ComputerRuntime -> provider -> result", () => {
  it("creates a session then observes a real (faked) page through the full dispatch chain", async () => {
    const { deps } = buildAgentRuntimeComputerDeps();

    const created = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.session.create", { startUrl: "https://supplier.example" }),
      now
    })) as ComputerSession;
    expect(created.status).toBe("READY");

    const observed = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.observe", { computerSessionId: created.id }),
      now
    })) as ComputerActionResult;

    expect(observed.status).toBe("EXECUTED");
    expect(observed.observation?.contentSummary).toContain("KSh 1,800");
  });
});

describe("integration: consequential action -> approval -> RuntimeHandoff -> resume -> execute", () => {
  it("pauses a consequential click for approval via the dispatcher, then executes exactly once after approving through the domain's REST-route entry point", async () => {
    const { deps, provider, domain } = buildAgentRuntimeComputerDeps();

    const created = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.session.create", {}),
      now
    })) as ComputerSession;

    const clickResult = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.click", {
        computerSessionId: created.id,
        targetDescription: "Place order"
      }),
      now
    })) as ComputerActionResult;

    expect(clickResult.status).toBe("AWAITING_APPROVAL");
    expect(provider.clickCalls).toBe(0);

    // The approval REST route (services/api/src/cp2/domains/computer-runtime/routes.ts) calls
    // Cp2Store.decideComputerApproval -> ComputerRuntimeDomain.decideApproval directly, not
    // through the capability dispatcher (task brief: approve/reject is a conventional UI action,
    // not a natural-language chat turn) - exercised here against the same domain instance the
    // deps closures above share, proving the checkpoint-then-approve-then-execute-once chain.
    const approved = await domain.decideApproval(
      null,
      BUSINESS,
      clickResult.approvalId!,
      "approve",
      now
    );
    expect(approved.status).toBe("EXECUTED");
    expect(provider.clickCalls).toBe(1);

    // Replaying the same approval id must never execute a second time.
    await expect(
      domain.decideApproval(null, BUSINESS, clickResult.approvalId!, "approve", now)
    ).rejects.toMatchObject({ code: "COMPUTER_APPROVAL_ALREADY_DECIDED" });
    expect(provider.clickCalls).toBe(1);
  });
});

describe("integration: browser -> human takeover -> agent action rejected -> human releases -> observation refresh -> agent resumes", () => {
  it("rejects an agent action while human-controlled, then resumes cleanly after release", async () => {
    const { deps, provider } = buildAgentRuntimeComputerDeps();

    const created = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.session.create", {}),
      now
    })) as ComputerSession;

    const taken = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.control.take", { computerSessionId: created.id }),
      now
    })) as ComputerSession;
    expect(taken.controlMode).toBe("HUMAN");

    await expect(
      executeRuntimeCapability(deps, {
        sessionId: null,
        businessId: BUSINESS,
        conversationId: CONVERSATION,
        action: plannedAction("computer.click", {
          computerSessionId: created.id,
          targetDescription: "search"
        }),
        now
      })
    ).rejects.toMatchObject({ code: "COMPUTER_CONTROL_NOT_AGENT" });
    expect(provider.clickCalls).toBe(0);

    const released = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.control.release", { computerSessionId: created.id }),
      now
    })) as ComputerSession;
    expect(released.controlMode).toBe("AGENT");

    const resumedClick = (await executeRuntimeCapability(deps, {
      sessionId: null,
      businessId: BUSINESS,
      conversationId: CONVERSATION,
      action: plannedAction("computer.click", {
        computerSessionId: created.id,
        targetDescription: "search"
      }),
      now
    })) as ComputerActionResult;
    expect(resumedClick.status).toBe("EXECUTED");
    expect(provider.clickCalls).toBe(1);
  });
});
