import { beforeEach, describe, expect, it } from "vitest";
import type {
  ClickInput,
  ComputerActionResult,
  ComputerObservation,
  ComputerProviderCheckpoint,
  ComputerRuntimeProvider,
  ComputerSession,
  CreateSessionInput,
  NavigateInput,
  ObserveInput,
  ScrollInput,
  TypeInput,
  UploadInput
} from "../packages/computer-runtime/src";
import type {
  ComputerRuntimeDomainDeps,
  StoredComputerApproval
} from "../services/api/src/cp2/domains/computer-runtime/store.js";
import { ComputerRuntimeDomain } from "../services/api/src/cp2/domains/computer-runtime/store.js";
import { Cp2Error } from "../services/api/src/cp2/cp2-error.js";
import type {
  AuthenticatedActorView,
  RuntimeCheckpointResult,
  RuntimeContextReference
} from "@soko/shared-types";

const now = () => new Date("2026-01-01T00:00:00.000Z");

interface Actor {
  accountId: string;
  userId: string;
}

const bizOneOwner: Actor = { accountId: "acct-1", userId: "user-1" };
const bizTwoOwner: Actor = { accountId: "acct-2", userId: "user-2" };
const businessOwners: Record<string, Actor> = { "biz-1": bizOneOwner, "biz-2": bizTwoOwner };
const sessionActors: Record<string, Actor> = {
  "session-biz-1": bizOneOwner,
  "session-biz-2": bizTwoOwner
};

function actorView(actor: Actor): AuthenticatedActorView {
  return {
    account: { id: actor.accountId } as AuthenticatedActorView["account"],
    user: { id: actor.userId } as AuthenticatedActorView["user"]
  };
}

class FakeProvider implements ComputerRuntimeProvider {
  readonly kind = "fake";
  calls: string[] = [];
  observationOverride: ComputerObservation | null = null;
  clickResultOverride: ComputerActionResult | null = null;
  clickShouldThrow = false;
  /** When set, click() awaits this before resolving - lets a test simulate a human takeover
   *  racing an in-flight agent action. */
  clickGate: Promise<void> | null = null;

  async createSession(input: CreateSessionInput): Promise<ComputerSession> {
    this.calls.push("createSession");
    return {
      id: input.sessionId,
      businessId: input.businessId,
      accountId: input.accountId,
      conversationId: input.conversationId,
      profileId: input.profileId,
      status: "READY",
      controlMode: "AGENT",
      currentUrl: input.startUrl,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      lastCheckpointId: null
    };
  }

  async resumeSession(sessionId: string): Promise<ComputerSession> {
    this.calls.push("resumeSession");
    return {
      id: sessionId,
      businessId: "",
      accountId: "",
      conversationId: "",
      profileId: null,
      status: "READY",
      controlMode: "AGENT",
      currentUrl: null,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      lastCheckpointId: null
    };
  }

  async navigate(input: NavigateInput): Promise<ComputerObservation> {
    this.calls.push("navigate");
    return this.observation(input.sessionId, input.url);
  }

  async observe(input: ObserveInput): Promise<ComputerObservation> {
    this.calls.push("observe");
    return (
      this.observationOverride ?? this.observation(input.sessionId, "https://example.com/current")
    );
  }

  async click(input: ClickInput): Promise<ComputerActionResult> {
    this.calls.push("click");
    if (this.clickGate !== null) await this.clickGate;
    if (this.clickShouldThrow) throw new Error("worker exploded mid-click");
    return (
      this.clickResultOverride ?? {
        sessionId: input.sessionId,
        status: "EXECUTED",
        observation: this.observation(input.sessionId, "https://example.com/after-click")
      }
    );
  }

  async type(input: TypeInput): Promise<ComputerActionResult> {
    this.calls.push("type");
    return {
      sessionId: input.sessionId,
      status: "EXECUTED",
      observation: this.observation(input.sessionId, "https://example.com/after-type")
    };
  }

  async scroll(input: ScrollInput): Promise<ComputerActionResult> {
    this.calls.push("scroll");
    return { sessionId: input.sessionId, status: "EXECUTED", observation: null };
  }

  async upload(input: UploadInput): Promise<ComputerActionResult> {
    this.calls.push("upload");
    return {
      sessionId: input.sessionId,
      status: "EXECUTED",
      observation: this.observation(input.sessionId, "https://example.com/after-upload")
    };
  }

  async checkpoint(sessionId: string): Promise<ComputerProviderCheckpoint> {
    this.calls.push("checkpoint");
    return { sessionId, opaqueState: `state-for-${sessionId}`, capturedAt: now().toISOString() };
  }

  async suspend(): Promise<void> {
    this.calls.push("suspend");
  }

  async resume(): Promise<void> {
    this.calls.push("resume");
  }

  async close(): Promise<void> {
    this.calls.push("close");
  }

  private observation(sessionId: string, url: string): ComputerObservation {
    return {
      sessionId,
      url,
      title: "Example",
      screenshotDataUrl: null,
      contentSummary: "Example page content.",
      interactiveElements: [
        { ref: "send-btn", role: "button", name: "Send", sensitive: false },
        { ref: "password-field", role: "textbox", name: "Password", sensitive: true }
      ],
      capturedAt: now().toISOString()
    };
  }
}

let checkpointCounter = 0;

function fakeCheckpointResult(taskId: string): RuntimeCheckpointResult {
  checkpointCounter += 1;
  const id = `handoff-${checkpointCounter}`;
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
      checkpointVersion: checkpointCounter,
      schemaVersion: 1,
      createdAt: now().toISOString()
    },
    taskHead: {
      taskId,
      activeHandoffId: id,
      nextCheckpointVersion: checkpointCounter + 1,
      updatedAt: now().toISOString()
    },
    promoted: false
  };
}

interface Harness {
  domain: ComputerRuntimeDomain;
  provider: FakeProvider;
  audits: {
    type: string;
    aggregateId: string;
    actorId: string;
    payload: Record<string, unknown>;
  }[];
  metrics: unknown[];
  checkpointCalls: {
    taskId: string;
    nextAction?: string | null;
    relevantContext?: RuntimeContextReference[];
  }[];
  conversationMessages: unknown[];
  encrypted: Map<string, string>;
}

function createHarness(overrides: Partial<ComputerRuntimeDomainDeps> = {}): Harness {
  const provider = new FakeProvider();
  const audits: Harness["audits"] = [];
  const metrics: unknown[] = [];
  const checkpointCalls: Harness["checkpointCalls"] = [];
  const conversationMessages: unknown[] = [];
  const encrypted = new Map<string, string>();

  const deps: ComputerRuntimeDomainDeps = {
    requireAuthorizedSession: (_sessionId, businessId) => {
      const actor = businessOwners[businessId];
      if (actor === undefined)
        throw new Cp2Error(403, "FORBIDDEN", "Not a member of this business.");
      return actorView(actor);
    },
    requireAuthenticatedActor: (sessionId) => {
      const actor = sessionId === null ? undefined : sessionActors[sessionId];
      if (actor === undefined) throw new Cp2Error(401, "UNAUTHENTICATED", "No session.");
      return actorView(actor);
    },
    provider,
    checkpointTask: (_sessionId, input) => {
      checkpointCalls.push(input);
      return fakeCheckpointResult(input.taskId);
    },
    recordAuditEvent: (input) =>
      audits.push({
        type: input.type,
        aggregateId: input.aggregateId,
        actorId: input.actorId,
        payload: input.payload
      }),
    encryptSecret: (value) => {
      const token = `enc-${encrypted.size}`;
      encrypted.set(token, value);
      return token;
    },
    decryptSecret: (value) => encrypted.get(value) ?? "",
    createConversationMessage: (input) => {
      conversationMessages.push(input);
      return null;
    },
    resolveAttachment: async () => ({
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("fake-pdf-bytes")
    }),
    onMetric: (event) => metrics.push(event),
    ...overrides
  };

  return {
    domain: new ComputerRuntimeDomain(deps),
    provider,
    audits,
    metrics,
    checkpointCalls,
    conversationMessages,
    encrypted
  };
}

const CONVERSATION_1 = "conv-biz-1";

describe("ComputerRuntimeDomain - session lifecycle", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it("requires an active conversation to create a session", async () => {
    await expect(harness.domain.createSession(null, "biz-1", undefined, {}, now())).rejects.toThrow(
      /conversation/i
    );
  });

  it("creates a session and posts a computer-session conversation message", async () => {
    const session = await harness.domain.createSession(
      null,
      "biz-1",
      CONVERSATION_1,
      { startUrl: "https://example.com" },
      now()
    );
    expect(session.status).toBe("READY");
    expect(session.controlMode).toBe("AGENT");
    expect(session.conversationId).toBe(CONVERSATION_1);
    expect(harness.conversationMessages).toHaveLength(1);
    expect(harness.conversationMessages[0]).toMatchObject({
      content: { type: "computer-session", computerSessionId: session.id }
    });
    expect(harness.metrics).toContainEqual({ type: "session_created" });
  });

  it("rejects a navigation-policy-blocked startUrl before ever calling the provider", async () => {
    await expect(
      harness.domain.createSession(
        null,
        "biz-1",
        CONVERSATION_1,
        { startUrl: "http://169.254.169.254/latest/meta-data/" },
        now()
      )
    ).rejects.toThrow(/blocked/i);
    expect(harness.provider.calls).toHaveLength(0);
  });
});

describe("ComputerRuntimeDomain - tenant isolation (security)", () => {
  it("rejects access to another business's session (404, not a leak through a different error)", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());

    await expect(
      harness.domain.navigate(
        null,
        "biz-2",
        { computerSessionId: session.id, url: "https://example.com" },
        now()
      )
    ).rejects.toMatchObject({ code: "COMPUTER_SESSION_NOT_FOUND" });
  });

  it("rejects access to another account's saved profile", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const profile = await harness.domain.saveSessionAsProfile(
      null,
      "biz-1",
      session.id,
      { label: "Instagram", site: "instagram.com" },
      now()
    );

    expect(() => harness.domain.disconnectProfile("session-biz-2", profile.id, now())).toThrow(
      expect.objectContaining({ code: "COMPUTER_PROFILE_NOT_FOUND" })
    );
  });

  it("never exposes another business's session by iterating - creating two businesses' sessions keeps them scoped", async () => {
    const harness = createHarness();
    const sessionOne = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const sessionTwo = await harness.domain.createSession(null, "biz-2", "conv-biz-2", {}, now());

    const viewOne = harness.domain.getSessionView(null, "biz-1", sessionOne.id, now());
    expect(viewOne.session.id).toBe(sessionOne.id);
    expect(() => harness.domain.getSessionView(null, "biz-1", sessionTwo.id, now())).toThrow(
      expect.objectContaining({ code: "COMPUTER_SESSION_NOT_FOUND" })
    );
  });
});

describe("ComputerRuntimeDomain - action policy classification", () => {
  let harness: Harness;
  let sessionId: string;

  beforeEach(async () => {
    harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    sessionId = session.id;
  });

  it("executes an ordinary click immediately (READ/MUTATE, no approval)", async () => {
    const result = await harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: sessionId, targetDescription: "search results tab" },
      now()
    );
    expect(result.status).toBe("EXECUTED");
    expect(harness.provider.calls).toContain("click");
  });

  it("pauses a consequential click for approval without calling the provider", async () => {
    const result = await harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: sessionId, targetDescription: "Send button" },
      now()
    );
    expect(result.status).toBe("AWAITING_APPROVAL");
    expect(result.approvalId).toBeDefined();
    expect(harness.provider.calls).not.toContain("click");
    expect(harness.metrics).toContainEqual({ type: "approval_requested" });
  });

  it("blocks typing into a field flagged sensitive by the last observation, without calling the provider", async () => {
    // Prime lastObservation with a sensitive "Password" element via an observe() call.
    await harness.domain.observe(null, "biz-1", { computerSessionId: sessionId }, now());

    await expect(
      harness.domain.type(
        null,
        "biz-1",
        { computerSessionId: sessionId, targetDescription: "Password", text: "hunter2" },
        now()
      )
    ).rejects.toMatchObject({ code: "COMPUTER_ACTION_BLOCKED" });
    expect(harness.provider.calls).not.toContain("type");
  });

  it("does not let a second consequential action pile up a second approval on the same session", async () => {
    const first = await harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: sessionId, targetDescription: "Delete account" },
      now()
    );
    const second = await harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: sessionId, targetDescription: "Place order" },
      now()
    );
    expect(second.status).toBe("AWAITING_APPROVAL");
    expect(second.approvalId).toBe(first.approvalId);
  });
});

describe("ComputerRuntimeDomain - approvals (security: binding, replay, expiry)", () => {
  async function proposeConsequentialClick(harness: Harness, sessionId: string) {
    const result = await harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: sessionId, targetDescription: "Send button" },
      now()
    );
    return result.approvalId!;
  }

  it("approves and executes exactly once", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    const result = await harness.domain.decideApproval(null, "biz-1", approvalId, "approve", now());
    expect(result.status).toBe("EXECUTED");
    expect(harness.provider.calls).toContain("click");
    expect(harness.metrics).toContainEqual({ type: "approval_approved" });
  });

  it("rejects a replayed approve call on an already-decided approval", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    await harness.domain.decideApproval(null, "biz-1", approvalId, "approve", now());
    const clicksAfterFirstApproval = harness.provider.calls.filter((c) => c === "click").length;

    await expect(
      harness.domain.decideApproval(null, "biz-1", approvalId, "approve", now())
    ).rejects.toMatchObject({
      code: "COMPUTER_APPROVAL_ALREADY_DECIDED"
    });
    // The action must never execute twice.
    expect(harness.provider.calls.filter((c) => c === "click").length).toBe(
      clicksAfterFirstApproval
    );
  });

  it("rejects an approve call for a forged/unknown approval id", async () => {
    const harness = createHarness();
    await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());

    await expect(
      harness.domain.decideApproval(null, "biz-1", "not-a-real-approval-id", "approve", now())
    ).rejects.toMatchObject({ code: "COMPUTER_APPROVAL_NOT_FOUND" });
  });

  it("rejects approving a pending approval from the wrong business", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    await expect(
      harness.domain.decideApproval(null, "biz-2", approvalId, "approve", now())
    ).rejects.toMatchObject({
      code: "COMPUTER_APPROVAL_NOT_FOUND"
    });
  });

  it("expires an approval past its TTL and refuses to execute it", async () => {
    const harness = createHarness({ approvalTtlMs: 1000 });
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    const muchLater = new Date(now().getTime() + 60_000);
    await expect(
      harness.domain.decideApproval(null, "biz-1", approvalId, "approve", muchLater)
    ).rejects.toMatchObject({ code: "COMPUTER_APPROVAL_EXPIRED" });
    expect(harness.provider.calls).not.toContain("click");
  });

  it("rejecting an approval never calls the provider", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    const result = await harness.domain.decideApproval(null, "biz-1", approvalId, "reject", now());
    expect(result.status).toBe("REJECTED");
    expect(harness.provider.calls).not.toContain("click");
    expect(harness.metrics).toContainEqual({ type: "approval_rejected" });
  });

  it("refuses to execute an approval whose stored action was tampered with after proposal (hash mismatch)", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    // Simulate a corrupted/tampered row: the stored action no longer matches its own actionHash.
    const stored: StoredComputerApproval = harness.domain.approvalsMap.get(approvalId)!;
    harness.domain.approvalsMap.set(approvalId, {
      ...stored,
      action: { ...stored.action, targetDescription: "Delete all customer data" }
    });

    await expect(
      harness.domain.decideApproval(null, "biz-1", approvalId, "approve", now())
    ).rejects.toMatchObject({
      code: "COMPUTER_APPROVAL_HASH_MISMATCH"
    });
    expect(harness.provider.calls).not.toContain("click");
  });

  it("surfaces OUTCOME_UNKNOWN, not a silent retry, when the provider throws during an approved execution", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    const approvalId = await proposeConsequentialClick(harness, session.id);

    harness.provider.clickShouldThrow = true;
    const result = await harness.domain.decideApproval(null, "biz-1", approvalId, "approve", now());
    expect(result.status).toBe("OUTCOME_UNKNOWN");

    // Exactly one click attempt - never retried automatically.
    expect(harness.provider.calls.filter((c) => c === "click").length).toBe(1);

    // And the approval can never be re-decided into a second execution attempt.
    await expect(
      harness.domain.decideApproval(null, "biz-1", approvalId, "approve", now())
    ).rejects.toMatchObject({
      code: "COMPUTER_APPROVAL_ALREADY_DECIDED"
    });
  });
});

describe("ComputerRuntimeDomain - control ownership (task brief §11)", () => {
  it("takes control atomically and then rejects agent actions", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());

    const taken = harness.domain.takeControl(null, "biz-1", session.id, now());
    expect(taken.controlMode).toBe("HUMAN");
    expect(harness.metrics).toContainEqual({ type: "human_takeover" });

    await expect(
      harness.domain.click(
        null,
        "biz-1",
        { computerSessionId: session.id, targetDescription: "anything" },
        now()
      )
    ).rejects.toMatchObject({ code: "COMPUTER_CONTROL_NOT_AGENT" });
  });

  it("releasing control refreshes the observation and hands control back to the agent", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    harness.domain.takeControl(null, "biz-1", session.id, now());

    const released = await harness.domain.releaseControl(null, "biz-1", session.id, now());
    expect(released.controlMode).toBe("AGENT");
    expect(harness.provider.calls).toContain("observe");
    expect(harness.checkpointCalls.length).toBeGreaterThan(0);

    const result = await harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: session.id, targetDescription: "search results tab" },
      now()
    );
    expect(result.status).toBe("EXECUTED");
  });

  it("rejects releasing control when the agent already has it", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    await expect(
      harness.domain.releaseControl(null, "biz-1", session.id, now())
    ).rejects.toMatchObject({
      code: "COMPUTER_NOT_HUMAN_CONTROLLED"
    });
  });

  it("discards an in-flight agent action's result if a human takes control mid-action, never overwriting human-driven state", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());

    let releaseGate: () => void = () => undefined;
    harness.provider.clickGate = new Promise((resolve) => {
      releaseGate = resolve;
    });

    const inFlightClick = harness.domain.click(
      null,
      "biz-1",
      { computerSessionId: session.id, targetDescription: "search results tab" },
      now()
    );

    // Human takes control while the click above is still awaiting the provider.
    const taken = harness.domain.takeControl(null, "biz-1", session.id, now());
    expect(taken.controlMode).toBe("HUMAN");

    releaseGate();
    const result = await inFlightClick;

    expect(result.status).toBe("REJECTED");
    expect(result.reason).toMatch(/control changed/i);

    // The session must still show HUMAN control - the stale agent action never flipped it back.
    const view = harness.domain.getSessionView(null, "biz-1", session.id, now());
    expect(view.session.controlMode).toBe("HUMAN");
  });
});

describe("ComputerRuntimeDomain - profiles", () => {
  it("saves a session's browser state as an encrypted profile, never storing plaintext", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());

    const profile = await harness.domain.saveSessionAsProfile(
      null,
      "biz-1",
      session.id,
      { label: "Instagram", site: "instagram.com" },
      now()
    );
    expect(profile.site).toBe("instagram.com");
    expect(profile).not.toHaveProperty("encryptedState");

    const stored = [...harness.domain.profilesMap.values()][0]!;
    expect(stored.encryptedState).not.toBeNull();
    expect(stored.encryptedState).not.toContain(`state-for-${session.id}`);
    expect(harness.encrypted.get(stored.encryptedState!)).toBe(`state-for-${session.id}`);
  });

  it("lists only the authenticated account's own profiles", async () => {
    const harness = createHarness();
    const sessionOne = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());
    await harness.domain.saveSessionAsProfile(
      null,
      "biz-1",
      sessionOne.id,
      { label: "Instagram", site: "instagram.com" },
      now()
    );

    const listedByOwner = harness.domain.listProfiles("session-biz-1", now());
    expect(listedByOwner).toHaveLength(1);
    const listedByOther = harness.domain.listProfiles("session-biz-2", now());
    expect(listedByOther).toHaveLength(0);
  });
});

describe("ComputerRuntimeDomain - RuntimeHandoff integration", () => {
  it("checkpoints reference the computer session and carry the session's conversation as taskId", async () => {
    const harness = createHarness();
    const session = await harness.domain.createSession(null, "biz-1", CONVERSATION_1, {}, now());

    await harness.domain.checkpointSession(null, "biz-1", session.id, now());

    expect(harness.checkpointCalls.length).toBeGreaterThan(0);
    const call = harness.checkpointCalls[harness.checkpointCalls.length - 1]!;
    expect(call.taskId).toBe(CONVERSATION_1);
    expect(call.relevantContext?.[0]).toMatchObject({
      kind: "computer_session",
      refId: session.id
    });

    const view = harness.domain.getSessionView(null, "biz-1", session.id, now());
    expect(view.session.lastCheckpointId).not.toBeNull();
  });
});
