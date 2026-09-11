import { describe, expect, it } from "vitest";
import type {
  AccountSummary,
  AiModelSummary,
  ConversationSummary,
  UserSummary
} from "../packages/shared-types/src";
import { Cp2Error } from "../services/api/src/cp2/cp2-error";
import {
  RuntimeHandoffDomain,
  type RuntimeHandoffDomainDeps
} from "../services/api/src/cp2/domains/runtime-handoff/store";
import {
  NativeRuntimeBindingStore,
  globalDefaultRuntimeBindingId
} from "../services/api/src/cp2/domains/native-runtime/store";

// This suite exercises RuntimeHandoffDomain directly against a hand-built deps object rather than
// through the full HTTP/Fastify stack (see tests/runtime-handoff-protocol.test.ts for the REST
// surface) - it is faster to write precise transaction/concurrency/activation-failure scenarios
// this way, and it tests the same production class either way.

function buildModel(id: string, overrides: Partial<AiModelSummary> = {}): AiModelSummary {
  return {
    id,
    label: id,
    provider: "soko",
    description: "Test model",
    capabilities: ["chat"],
    available: true,
    source: "builtin",
    format: "remote",
    license: null,
    licenseUrl: null,
    modelCardUrl: null,
    downloadUrl: null,
    fileName: null,
    fileSizeBytes: null,
    minimumMemoryGb: null,
    recommended: false,
    ...overrides
  } as AiModelSummary;
}

function buildConversation(id: string, accountId: string): ConversationSummary {
  const now = new Date().toISOString();
  return {
    id,
    accountId,
    kind: "personal",
    activeShopId: null,
    runtimeBindingId: globalDefaultRuntimeBindingId,
    createdAt: now,
    updatedAt: now
  };
}

interface Harness {
  domain: RuntimeHandoffDomain;
  conversations: Map<string, ConversationSummary>;
  native: NativeRuntimeBindingStore;
  auditEvents: Array<{ type: string; aggregateId: string; actorId: string; payload: Record<string, unknown> }>;
  sessionIdFor(accountId: string): string;
}

/** sessionId === accountId in this stub - `requireAnySession` below just echoes it back as the
 *  authenticated account, since the real session/account machinery is exercised elsewhere
 *  (tests/runtime-handoff-protocol.test.ts) and isn't what this suite is testing. */
function buildHarness(depsOverrides: Partial<RuntimeHandoffDomainDeps> = {}): Harness {
  const conversations = new Map<string, ConversationSummary>();
  const native = new NativeRuntimeBindingStore();
  const auditEvents: Harness["auditEvents"] = [];
  const deps: RuntimeHandoffDomainDeps = {
    conversations,
    requireAnySession: (sessionId) => {
      if (sessionId === null || sessionId.length === 0) {
        throw new Cp2Error(401, "AUTH_REQUIRED", "Sign in required.");
      }
      const account: AccountSummary = {
        id: sessionId,
        primaryAuthChannel: "device",
        primaryAuthDestination: sessionId,
        identityLevel: "device"
      };
      const user: UserSummary = {
        id: `${sessionId}:user`,
        accountId: sessionId,
        displayName: "Test user",
        language: "en"
      };
      return {
        account,
        user,
        session: { id: sessionId, expiresAt: new Date(Date.now() + 60_000).toISOString() }
      };
    },
    nativeRuntimeBindings: native,
    setConversationRuntimeBinding: (conversationId, runtimeBindingId, now) => {
      const conversation = conversations.get(conversationId);
      if (conversation === undefined) return;
      conversations.set(conversationId, {
        ...conversation,
        runtimeBindingId,
        updatedAt: now.toISOString()
      });
    },
    recordAuditEvent: (input) =>
      auditEvents.push({
        type: input.type,
        aggregateId: input.aggregateId,
        actorId: input.actorId,
        payload: input.payload
      }),
    ...depsOverrides
  };
  return {
    domain: new RuntimeHandoffDomain(deps),
    conversations,
    native,
    auditEvents,
    sessionIdFor: (accountId) => accountId
  };
}

/** Materializes an available primary model (+ host + installation) on the global default binding,
 *  and creates+registers one conversation pointed at it, ready for immediate use. */
function seedConversation(harness: Harness, modelId: string): { conversationId: string; accountId: string } {
  const accountId = `acct-${modelId}`;
  const now = new Date().toISOString();
  harness.native.activateGlobalDefaultModel({
    model: buildModel(modelId),
    executionTarget: "backend",
    checkedAt: now,
    updatedBy: "system"
  });
  const conversationId = `conv-${modelId}`;
  harness.conversations.set(conversationId, buildConversation(conversationId, accountId));
  return { conversationId, accountId };
}

describe("RuntimeHandoffDomain", () => {
  it("bootstraps a legacy handoff (section 20) the first time a task with no prior checkpoint is resolved", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-a");
    const resolved = harness.domain.resolveHandoff(harness.sessionIdFor(accountId), conversationId);

    expect(resolved.activeHandoff.parentHandoffId).toBeNull();
    expect(resolved.activeHandoff.checkpointVersion).toBe(1);
    expect(resolved.taskHead.activeHandoffId).toBe(resolved.activeHandoff.id);
    expect(resolved.taskHead.nextCheckpointVersion).toBe(2);
    expect(resolved.isRuntimeStale).toBe(false);
    expect(resolved.runtimeInstance).toBeNull();
    expect(harness.auditEvents.some((event) => event.type === "runtime_handoff.legacy_bootstrapped")).toBe(
      true
    );
  });

  it("rejects resolving a task that belongs to another account", () => {
    const harness = buildHarness();
    const { conversationId } = seedConversation(harness, "model-b");
    expect(() => harness.domain.resolveHandoff("someone-else", conversationId)).toThrow(Cp2Error);
  });

  it("creates immutable, parent-linked checkpoints with atomically increasing versions, and does not move the head unless promoted", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-c");
    const sessionId = harness.sessionIdFor(accountId);
    const bootstrap = harness.domain.resolveHandoff(sessionId, conversationId);

    const unpromoted = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      goal: "Unpromoted checkpoint",
      currentState: "still working"
    });
    expect(unpromoted.promoted).toBe(false);
    expect(unpromoted.handoff.checkpointVersion).toBe(2);
    expect(unpromoted.handoff.parentHandoffId).toBe(bootstrap.activeHandoff.id);
    // Head must not have moved.
    expect(harness.domain.resolveHandoff(sessionId, conversationId).taskHead.activeHandoffId).toBe(
      bootstrap.activeHandoff.id
    );

    const promoted = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      goal: "Promoted checkpoint",
      currentState: "done with step 2",
      expectedHandoffId: bootstrap.activeHandoff.id,
      promote: true
    });
    expect(promoted.promoted).toBe(true);
    expect(promoted.handoff.checkpointVersion).toBe(3);
    expect(promoted.taskHead.activeHandoffId).toBe(promoted.handoff.id);
    expect(harness.domain.resolveHandoff(sessionId, conversationId).taskHead.activeHandoffId).toBe(
      promoted.handoff.id
    );

    // Immutability: the row returned for v1 (the bootstrap) is unchanged by later checkpoints.
    const v1Again = harness.domain.getHandoffByVersion(sessionId, conversationId, 1);
    expect(v1Again).toEqual(bootstrap.activeHandoff);
  });

  it("rejects promotion when expectedHandoffId does not match the current head (optimistic concurrency, section 7)", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-d");
    const sessionId = harness.sessionIdFor(accountId);
    harness.domain.resolveHandoff(sessionId, conversationId);

    expect(() =>
      harness.domain.createCheckpoint(sessionId, {
        taskId: conversationId,
        promote: true,
        expectedHandoffId: "stale-handoff-id"
      })
    ).toThrow(Cp2Error);
    try {
      harness.domain.createCheckpoint(sessionId, {
        taskId: conversationId,
        promote: true,
        expectedHandoffId: "stale-handoff-id"
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Cp2Error);
      expect((error as Cp2Error).statusCode).toBe(409);
      expect((error as Cp2Error).code).toBe("RUNTIME_HANDOFF_CONFLICT");
    }
  });

  it("requires expectedHandoffId when promoting (section 7)", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-e");
    const sessionId = harness.sessionIdFor(accountId);
    harness.domain.resolveHandoff(sessionId, conversationId);
    expect(() =>
      harness.domain.createCheckpoint(sessionId, { taskId: conversationId, promote: true })
    ).toThrow(Cp2Error);
  });

  it("swaps the model end-to-end: task/conversation id unchanged, new checkpoint resumes from nextAction, transcript is never touched", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-f");
    const sessionId = harness.sessionIdFor(accountId);

    // Install a second, distinct model on the *same* execution host as the current one (a pure
    // model-dimension swap keeps agent/host fixed) via the same global-default-slot helper used to
    // seed the conversation, which is why this reuses activateGlobalDefaultModel rather than
    // activateVerifiedModel (which would provision its own, different host).
    const now = new Date().toISOString();
    harness.native.activateGlobalDefaultModel({
      model: buildModel("model-f-replacement"),
      executionTarget: "backend",
      checkedAt: now,
      updatedBy: "system"
    });

    const before = harness.domain.resolveHandoff(sessionId, conversationId);
    harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: before.activeHandoff.id,
      nextAction: "Summarize the last three orders",
      pendingActions: [{ id: "a1", description: "Summarize orders" }]
    });
    const preSwap = harness.domain.resolveHandoff(sessionId, conversationId);

    const result = harness.domain.performSwap(sessionId, {
      taskId: conversationId,
      dimension: "model",
      targetId: "model-f-replacement",
      expectedHandoffId: preSwap.activeHandoff.id
    });

    expect(result.activationFailed).toBe(false);
    expect(result.handoff.taskId).toBe(conversationId);
    expect(result.handoff.conversationId).toBe(conversationId);
    expect(result.handoff.runtime.modelId).toBe("model-f-replacement");
    expect(result.handoff.nextAction).toBe("Summarize the last three orders");
    expect(result.handoff.pendingActions).toEqual(preSwap.activeHandoff.pendingActions);
    expect(result.handoff.parentHandoffId).toBe(preSwap.activeHandoff.id);
    expect(result.runtimeInstance.status).toBe("READY");
    expect(result.runtimeInstance.activeHandoffId).toBe(result.handoff.id);

    const resolvedAfter = harness.domain.resolveHandoff(sessionId, conversationId);
    expect(resolvedAfter.taskHead.activeHandoffId).toBe(result.handoff.id);
    expect(resolvedAfter.isRuntimeStale).toBe(false);
  });

  it("swaps the agent end-to-end without mutating conversation/task identity", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-g");
    const sessionId = harness.sessionIdFor(accountId);
    const now = new Date().toISOString();
    harness.native.activateVerifiedModel({
      agentId: "second-agent",
      agentName: "Second agent",
      businessId: null,
      accountId,
      model: buildModel("model-g"),
      executionTarget: "backend",
      fallbackModel: null,
      updatedBy: "system",
      checkedAt: now
    });
    const before = harness.domain.resolveHandoff(sessionId, conversationId);
    const result = harness.domain.performSwap(sessionId, {
      taskId: conversationId,
      dimension: "agent",
      targetId: "second-agent",
      expectedHandoffId: before.activeHandoff.id
    });
    expect(result.handoff.runtime.agentId).toBe("second-agent");
    expect(result.handoff.taskId).toBe(conversationId);
    expect(result.activationFailed).toBe(false);
  });

  it("never mutates a shared runtime binding in place when swapping (section 9)", () => {
    const harness = buildHarness();
    const { conversationId: conv1, accountId } = seedConversation(harness, "model-h");
    const sessionId = harness.sessionIdFor(accountId);
    // A second conversation on the same account, sharing the same starting binding.
    const conv2 = "conv-model-h-2";
    harness.conversations.set(conv2, buildConversation(conv2, accountId));
    const sharedBindingId = harness.conversations.get(conv1)?.runtimeBindingId;
    expect(harness.conversations.get(conv2)?.runtimeBindingId).toBe(sharedBindingId);
    const sharedBindingBefore = harness.native.bindingsMap.get(sharedBindingId as string);

    const now = new Date().toISOString();
    harness.native.activateVerifiedModel({
      agentId: "isolated-agent",
      agentName: "Isolated agent",
      businessId: null,
      accountId,
      model: buildModel("model-h-alt"),
      executionTarget: "backend",
      fallbackModel: null,
      updatedBy: "system",
      checkedAt: now
    });
    const before = harness.domain.resolveHandoff(sessionId, conv1);
    harness.domain.performSwap(sessionId, {
      taskId: conv1,
      dimension: "agent",
      targetId: "isolated-agent",
      expectedHandoffId: before.activeHandoff.id
    });

    // conv1 moved; conv2, which shared the pre-swap binding, must be completely untouched.
    expect(harness.conversations.get(conv1)?.runtimeBindingId).not.toBe(sharedBindingId);
    expect(harness.conversations.get(conv2)?.runtimeBindingId).toBe(sharedBindingId);
    expect(harness.native.bindingsMap.get(sharedBindingId as string)).toEqual(sharedBindingBefore);
  });

  it("leaves the old runtime fully authoritative when a swap's candidate chain fails compatibility validation (Prepare-phase failure)", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-i");
    const sessionId = harness.sessionIdFor(accountId);
    const before = harness.domain.resolveHandoff(sessionId, conversationId);

    expect(() =>
      harness.domain.performSwap(sessionId, {
        taskId: conversationId,
        dimension: "model",
        targetId: "does-not-exist",
        expectedHandoffId: before.activeHandoff.id
      })
    ).toThrow(Cp2Error);

    const after = harness.domain.resolveHandoff(sessionId, conversationId);
    expect(after.taskHead.activeHandoffId).toBe(before.activeHandoff.id);
    expect(after.activeHandoff.runtime).toEqual(before.activeHandoff.runtime);
  });

  it("represents runtime activation failure independently of task/checkpoint state (section 12) without rolling back the commit", () => {
    const auditEvents: Harness["auditEvents"] = [];
    const conversations = new Map<string, ConversationSummary>();
    const native = new NativeRuntimeBindingStore();
    // Legacy-bootstrap (resolveHandoff, before any swap) is the *first* resolveBindingForConversation
    // call and must succeed normally; the swap's own Activate-phase resolution is the second call -
    // that is the one this test simulates failing, to prove a runtime start failure never unwinds an
    // already-committed checkpoint/task-head (section 12).
    let resolveCalls = 0;
    const failingNative: RuntimeHandoffDomainDeps["nativeRuntimeBindings"] = Object.assign(
      Object.create(Object.getPrototypeOf(native)),
      native,
      {
        resolveBindingForConversation: (bindingId: string, conversationId: string) => {
          resolveCalls += 1;
          if (resolveCalls > 1) {
            throw new Cp2Error(503, "RUNTIME_MODELS_UNAVAILABLE", "Simulated activation failure.");
          }
          return native.resolveBindingForConversation(bindingId, conversationId);
        }
      }
    );
    const accountId = "acct-activation-fail";
    const domain = new RuntimeHandoffDomain({
      conversations,
      requireAnySession: (sessionId) => {
        if (sessionId === null) throw new Cp2Error(401, "AUTH_REQUIRED", "Sign in required.");
        return {
          account: {
            id: sessionId,
            primaryAuthChannel: "device",
            primaryAuthDestination: sessionId,
            identityLevel: "device"
          },
          user: { id: `${sessionId}:user`, accountId: sessionId, displayName: "T", language: "en" },
          session: { id: sessionId, expiresAt: new Date(Date.now() + 60_000).toISOString() }
        };
      },
      nativeRuntimeBindings: failingNative,
      setConversationRuntimeBinding: (conversationId, runtimeBindingId, now) => {
        const conversation = conversations.get(conversationId);
        if (conversation === undefined) return;
        conversations.set(conversationId, { ...conversation, runtimeBindingId, updatedAt: now.toISOString() });
      },
      recordAuditEvent: (input) =>
        auditEvents.push({
          type: input.type,
          aggregateId: input.aggregateId,
          actorId: input.actorId,
          payload: input.payload
        })
    });
    const now = new Date().toISOString();
    native.activateGlobalDefaultModel({
      model: buildModel("model-j"),
      executionTarget: "backend",
      checkedAt: now,
      updatedBy: "system"
    });
    native.activateVerifiedModel({
      agentId: "activation-fail-agent",
      agentName: "Activation fail agent",
      businessId: null,
      accountId,
      model: buildModel("model-j-alt"),
      executionTarget: "backend",
      fallbackModel: null,
      updatedBy: "system",
      checkedAt: now
    });
    const conversationId = "conv-activation-fail";
    conversations.set(conversationId, buildConversation(conversationId, accountId));
    const sessionId = accountId;
    const before = domain.resolveHandoff(sessionId, conversationId);

    const result = domain.performSwap(sessionId, {
      taskId: conversationId,
      dimension: "agent",
      targetId: "activation-fail-agent",
      expectedHandoffId: before.activeHandoff.id
    });

    expect(result.activationFailed).toBe(true);
    expect(result.activationError).toContain("Simulated activation failure");
    expect(result.runtimeInstance.status).toBe("FAILED");
    // The checkpoint and task head are still authoritative - a runtime start failure never
    // invalidates them.
    const after = domain.resolveHandoff(sessionId, conversationId);
    expect(after.taskHead.activeHandoffId).toBe(result.handoff.id);
    expect(after.activeHandoff.id).toBe(result.handoff.id);
    // But the runtime instance now disagrees with the (still valid) head about health, which is
    // exactly what drift detection means to catch downstream.
    expect(after.runtimeInstance?.status).toBe("FAILED");
  });

  it("detects runtime drift when the runtime instance's checkpoint lags the task head", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-k");
    const sessionId = harness.sessionIdFor(accountId);
    harness.domain.resume(sessionId, { taskId: conversationId });
    const stale = harness.domain.resolveHandoff(sessionId, conversationId);
    expect(stale.isRuntimeStale).toBe(false);

    harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: stale.activeHandoff.id
    });

    const drifted = harness.domain.resolveHandoff(sessionId, conversationId);
    expect(drifted.taskHead.activeHandoffId).not.toBe(drifted.runtimeInstance?.activeHandoffId);
    expect(drifted.isRuntimeStale).toBe(true);
  });

  it("rolls back the head to an earlier checkpoint without mutating any handoff row or the binding (section 14)", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-l");
    const sessionId = harness.sessionIdFor(accountId);
    const h1 = harness.domain.resolveHandoff(sessionId, conversationId).activeHandoff;
    const h2 = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: h1.id,
      currentState: "step 2"
    }).handoff;
    const h3 = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: h2.id,
      currentState: "step 3"
    }).handoff;
    const bindingBeforeRollback = harness.conversations.get(conversationId)?.runtimeBindingId;

    const rollback = harness.domain.rollback(sessionId, {
      taskId: conversationId,
      targetHandoffId: h2.id,
      expectedHandoffId: h3.id
    });

    expect(rollback.taskHead.activeHandoffId).toBe(h2.id);
    expect(rollback.activeHandoff).toEqual(h2);
    expect(harness.domain.getHandoffByVersion(sessionId, conversationId, 3).currentState).toBe(
      "step 3"
    );
    // Binding/runtime configuration is untouched by rollback.
    expect(harness.conversations.get(conversationId)?.runtimeBindingId).toBe(bindingBeforeRollback);
  });

  it("is idempotent for repeated swap requests carrying the same idempotency key (section 6.2)", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-m");
    const sessionId = harness.sessionIdFor(accountId);
    const now = new Date().toISOString();
    harness.native.activateVerifiedModel({
      agentId: "idem-agent",
      agentName: "Idempotency agent",
      businessId: null,
      accountId,
      model: buildModel("model-m-alt"),
      executionTarget: "backend",
      fallbackModel: null,
      updatedBy: "system",
      checkedAt: now
    });
    const before = harness.domain.resolveHandoff(sessionId, conversationId);
    const idempotencyKey = "retry-key-1";

    const first = harness.domain.performSwap(sessionId, {
      taskId: conversationId,
      dimension: "agent",
      targetId: "idem-agent",
      expectedHandoffId: before.activeHandoff.id,
      idempotencyKey
    });
    const second = harness.domain.performSwap(sessionId, {
      taskId: conversationId,
      dimension: "agent",
      targetId: "idem-agent",
      expectedHandoffId: before.activeHandoff.id,
      idempotencyKey
    });

    expect(second.handoff.id).toBe(first.handoff.id);
    expect(harness.domain.resolveHandoff(sessionId, conversationId).taskHead.nextCheckpointVersion).toBe(
      before.taskHead.nextCheckpointVersion + 1
    );
  });

  it("does not create duplicate promoted checkpoints for a repeated checkpoint request with the same idempotency key", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-n");
    const sessionId = harness.sessionIdFor(accountId);
    const before = harness.domain.resolveHandoff(sessionId, conversationId);
    const idempotencyKey = "checkpoint-retry-1";

    const first = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: before.activeHandoff.id,
      currentState: "checkpoint A",
      idempotencyKey
    });
    const second = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: before.activeHandoff.id,
      currentState: "checkpoint A",
      idempotencyKey
    });

    expect(second.handoff.id).toBe(first.handoff.id);
    expect(harness.domain.resolveHandoff(sessionId, conversationId).taskHead.nextCheckpointVersion).toBe(
      before.taskHead.nextCheckpointVersion + 1
    );
  });

  it("gives concurrent conflicting swaps against the same expected head exactly one winner and one 409 (no lost update)", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-o");
    const sessionId = harness.sessionIdFor(accountId);
    const now = new Date().toISOString();
    harness.native.activateVerifiedModel({
      agentId: "racer-a",
      agentName: "Racer A",
      businessId: null,
      accountId,
      model: buildModel("model-o-a"),
      executionTarget: "backend",
      fallbackModel: null,
      updatedBy: "system",
      checkedAt: now
    });
    harness.native.activateVerifiedModel({
      agentId: "racer-b",
      agentName: "Racer B",
      businessId: null,
      accountId,
      model: buildModel("model-o-b"),
      executionTarget: "backend",
      fallbackModel: null,
      updatedBy: "system",
      checkedAt: now
    });
    const before = harness.domain.resolveHandoff(sessionId, conversationId);

    const attempt = (targetId: string) => {
      try {
        return { ok: true as const, result: harness.domain.performSwap(sessionId, {
          taskId: conversationId,
          dimension: "agent",
          targetId,
          expectedHandoffId: before.activeHandoff.id
        }) };
      } catch (error) {
        return { ok: false as const, error };
      }
    };
    // This process is single-threaded and every domain call here is synchronous, so "concurrent"
    // dispatch collapses to sequential calls that both read the same pre-race expectedHandoffId -
    // exactly the scenario optimistic concurrency (section 7) exists to catch.
    const first = attempt("racer-a");
    const second = attempt("racer-b");

    const outcomes = [first, second];
    const winners = outcomes.filter((outcome) => outcome.ok);
    const losers = outcomes.filter((outcome) => !outcome.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { ok: false; error: unknown }).error).toBeInstanceOf(Cp2Error);
    expect(((losers[0] as { ok: false; error: unknown }).error as Cp2Error).statusCode).toBe(409);

    const finalVersions = [...harness.domain.resolveHandoff(sessionId, conversationId).taskHead ?
      [harness.domain.resolveHandoff(sessionId, conversationId).taskHead.activeHandoffId] : []];
    expect(finalVersions).toHaveLength(1);
  });

  it("allocates strictly increasing, unique checkpoint versions for a task across mixed checkpoint/swap/rollback operations", () => {
    const harness = buildHarness();
    const { conversationId, accountId } = seedConversation(harness, "model-p");
    const sessionId = harness.sessionIdFor(accountId);
    const now = new Date().toISOString();
    // Two more models on the *same* shared global-default host as the seeded one, so alternating
    // "model" swaps between them never trips the execution-host compatibility check.
    harness.native.activateGlobalDefaultModel({
      model: buildModel("model-p-alt"),
      executionTarget: "backend",
      checkedAt: now,
      updatedBy: "system"
    });
    void accountId;

    let head = harness.domain.resolveHandoff(sessionId, conversationId).activeHandoff;
    const versions = [head.checkpointVersion];
    const targets = ["model-p", "model-p-alt"];
    for (let i = 0; i < 4; i += 1) {
      const swap = harness.domain.performSwap(sessionId, {
        taskId: conversationId,
        dimension: "model",
        targetId: targets[i % targets.length] as string,
        expectedHandoffId: head.id
      });
      head = swap.handoff;
      versions.push(head.checkpointVersion);
    }
    const checkpointResult = harness.domain.createCheckpoint(sessionId, {
      taskId: conversationId,
      promote: true,
      expectedHandoffId: head.id,
      currentState: "final checkpoint"
    });
    head = checkpointResult.handoff;
    versions.push(head.checkpointVersion);
    const rollback = harness.domain.rollback(sessionId, {
      taskId: conversationId,
      targetHandoffId: (versions[1] !== undefined
        ? harness.domain.getHandoffByVersion(sessionId, conversationId, versions[1] as number)
        : head
      ).id,
      expectedHandoffId: head.id
    });
    // Rollback moves the head pointer but must not allocate a new version or duplicate one.
    expect(rollback.activeHandoff.checkpointVersion).toBe(versions[1]);

    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([...versions].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});
