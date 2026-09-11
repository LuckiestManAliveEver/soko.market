/**
 * Runtime Handoff Protocol domain (see docs/architecture/runtime-handoff-protocol.md).
 *
 * Like every other CP2 domain in this codebase, this class is an in-memory, synchronously
 * mutated store: Cp2Store methods never `await` between reading and writing these Maps, so a
 * single process can never interleave two calls against them. That is what makes
 * `allocateAndInsertCheckpoint` (the one shared version-allocation/task-head-move primitive
 * section 6.1 requires) safe without an explicit lock - see that method's docstring. Cross-process
 * safety (multiple API instances) is the same story as every other CP2 table: the
 * `cp2_runtime_handoffs_task_version_idx` unique index in migration 083 is the last-resort
 * arbiter, exactly like this repository's existing Postgres snapshot/LISTEN-NOTIFY sync model for
 * every other domain (see cp2/postgres-store.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  AuthSessionView,
  ConversationSummary,
  ResolvedRuntimeHandoff,
  RuntimeAction,
  RuntimeArtifactReference,
  RuntimeCheckpointCreateInput,
  RuntimeCheckpointResult,
  RuntimeContextReference,
  RuntimeDecision,
  RuntimeHandoff,
  RuntimeRejectedPath,
  RuntimeResumeInput,
  RuntimeResumeResult,
  RuntimeRollbackInput,
  RuntimeRollbackResult,
  RuntimeSwapInput,
  RuntimeSwapResult,
  RuntimeTaskHead,
  RuntimeTaskInstance,
  RuntimeTaskInstanceStatus,
  RuntimeTestResults
} from "@soko/shared-types";
import { Cp2Error } from "../../cp2-error.js";

export interface RuntimeOperationDedupRecord {
  id: string;
  operationType: string;
  idempotencyKey: string;
  result: unknown;
  createdAt: string;
}

export interface RuntimeHandoffSnapshot {
  runtimeHandoffs?: RuntimeHandoff[];
  runtimeTaskHeads?: RuntimeTaskHead[];
  runtimeTaskInstances?: RuntimeTaskInstance[];
  runtimeOperationDedup?: RuntimeOperationDedupRecord[];
}

/** The one resolved-binding shape this domain actually reads (a structural subset of
 *  ResolvedNativeRuntimeBinding from native-runtime/store.ts) - used instead of importing that
 *  domain's store module directly, which the repo's domain-isolation boundary check
 *  (scripts/check-boundaries.mjs) forbids for any `cp2/domains/*` file. Cp2Store (which is exempt
 *  from that check, and already imports the real NativeRuntimeBindingStore) supplies the actual
 *  object; it satisfies this interface structurally. */
export interface RuntimeHandoffNativeBindingResolution {
  agent: { id: string };
  selected: {
    model: { id: string };
    host: { id: string } | null;
    installation: { executionHostId: string } | null;
  };
}

/** The narrow slice of NativeRuntimeBindingStore's public API this domain depends on - see
 *  RuntimeHandoffNativeBindingResolution above for why this is a local interface rather than an
 *  import of the concrete class. */
export interface RuntimeHandoffNativeRuntimeAccess {
  validateCandidateExecutionChain(input: {
    agentId: string;
    modelId: string;
    executionHostId: string;
  }): void;
  materializeConversationBinding(input: {
    accountId: string;
    businessId: string | null;
    agentId: string;
    modelId: string;
    executionHostId: string;
    updatedBy: string;
    now: Date;
  }): { id: string };
  resolveBindingForConversation(
    bindingId: string,
    conversationId: string
  ): RuntimeHandoffNativeBindingResolution;
}

export interface RuntimeHandoffDomainDeps {
  conversations: ReadonlyMap<string, ConversationSummary>;
  requireAnySession: (sessionId: string | null, now: Date) => AuthSessionView;
  nativeRuntimeBindings: RuntimeHandoffNativeRuntimeAccess;
  /** The provider-neutral global default binding's id (native-runtime/store.ts's
   *  globalDefaultRuntimeBindingId), used only as the legacy-bootstrap fallback when a
   *  conversation predates the native runtime graph and has no explicit runtimeBindingId yet. */
  defaultRuntimeBindingId: string;
  setConversationRuntimeBinding: (conversationId: string, runtimeBindingId: string, now: Date) => void;
  recordAuditEvent: (input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }) => void;
}

type RuntimeRef = { agentId: string; modelId: string; executionHostId: string };

export class RuntimeHandoffDomain {
  private readonly handoffs = new Map<string, RuntimeHandoff>();
  private readonly taskHeads = new Map<string, RuntimeTaskHead>();
  private readonly taskInstances = new Map<string, RuntimeTaskInstance>();
  private readonly operationDedup = new Map<string, RuntimeOperationDedupRecord>();

  constructor(private readonly deps: RuntimeHandoffDomainDeps) {}

  // ---------------------------------------------------------------------------------------------
  // Resolution (section 5) and legacy bootstrap (section 20)
  // ---------------------------------------------------------------------------------------------

  resolveHandoff(
    sessionId: string | null,
    taskId: string,
    now: Date = new Date()
  ): ResolvedRuntimeHandoff {
    const { conversation, session } = this.requireConversation(sessionId, taskId, now);
    let taskHead = this.taskHeads.get(taskId);
    if (taskHead === undefined) {
      taskHead = this.bootstrapLegacyHandoff(conversation, session.account.id, now).taskHead;
    }
    const activeHandoff = this.handoffs.get(taskHead.activeHandoffId);
    if (activeHandoff === undefined) {
      throw new Cp2Error(
        500,
        "RUNTIME_HANDOFF_HEAD_CORRUPT",
        "Task head points at a checkpoint that no longer exists."
      );
    }
    const runtimeInstance = this.taskInstances.get(taskId) ?? null;
    const isRuntimeStale =
      runtimeInstance !== null && runtimeInstance.activeHandoffId !== taskHead.activeHandoffId;
    return {
      taskId,
      conversationId: conversation.id,
      activeHandoff,
      taskHead,
      runtimeInstance,
      isRuntimeStale
    };
  }

  getHandoffById(
    sessionId: string | null,
    taskId: string,
    handoffId: string,
    now: Date = new Date()
  ): RuntimeHandoff {
    const { conversation } = this.requireConversation(sessionId, taskId, now);
    const handoff = this.handoffs.get(handoffId);
    if (handoff === undefined || handoff.taskId !== conversation.id) {
      throw new Cp2Error(404, "RUNTIME_HANDOFF_NOT_FOUND", "Checkpoint was not found for this task.");
    }
    return handoff;
  }

  getHandoffByVersion(
    sessionId: string | null,
    taskId: string,
    version: number,
    now: Date = new Date()
  ): RuntimeHandoff {
    const { conversation } = this.requireConversation(sessionId, taskId, now);
    const handoff = [...this.handoffs.values()].find(
      (candidate) => candidate.taskId === conversation.id && candidate.checkpointVersion === version
    );
    if (handoff === undefined) {
      throw new Cp2Error(404, "RUNTIME_HANDOFF_NOT_FOUND", "No checkpoint exists at that version.");
    }
    return handoff;
  }

  // ---------------------------------------------------------------------------------------------
  // Checkpoint creation (section 6)
  // ---------------------------------------------------------------------------------------------

  createCheckpoint(
    sessionId: string | null,
    input: RuntimeCheckpointCreateInput,
    now: Date = new Date()
  ): RuntimeCheckpointResult {
    return this.withIdempotency("checkpoint", input.idempotencyKey, () => {
      const resolved = this.resolveHandoff(sessionId, input.taskId, now);
      const actorId = this.resolveActorId(sessionId, now);
      const promote = input.promote === true;
      if (promote) {
        this.requireMatchingHead(input.expectedHandoffId, resolved.taskHead, true);
      } else if (input.expectedHandoffId !== undefined) {
        this.requireMatchingHead(input.expectedHandoffId, resolved.taskHead, false);
      }
      const previous = resolved.activeHandoff;
      const { handoff, taskHead } = this.allocateAndInsertCheckpoint({
        taskId: input.taskId,
        conversationId: resolved.conversationId,
        parentHandoffId: previous.id,
        goal: input.goal ?? previous.goal,
        currentState: input.currentState ?? previous.currentState,
        completedActions: input.completedActions ?? previous.completedActions,
        decisions: input.decisions ?? previous.decisions,
        rejectedPaths: input.rejectedPaths ?? previous.rejectedPaths,
        pendingActions: input.pendingActions ?? previous.pendingActions,
        nextAction: input.nextAction === undefined ? previous.nextAction : input.nextAction,
        relevantContext: input.relevantContext ?? previous.relevantContext,
        artifacts: input.artifacts ?? previous.artifacts,
        tests: {
          passed: input.testsPassed ?? previous.tests.passed,
          failed: input.testsFailed ?? previous.tests.failed,
          pending: input.testsPending ?? previous.tests.pending
        },
        runtime: previous.runtime,
        now,
        promote
      });
      this.deps.recordAuditEvent({
        type: "runtime_handoff.checkpoint_created",
        aggregateType: "task",
        aggregateId: input.taskId,
        actorId,
        occurredAt: now.toISOString(),
        payload: { handoffId: handoff.id, promoted: promote }
      });
      return { handoff, taskHead, promoted: promote };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Swap (sections 8-12): Prepare -> Commit -> Activate
  // ---------------------------------------------------------------------------------------------

  performSwap(
    sessionId: string | null,
    input: RuntimeSwapInput,
    now: Date = new Date()
  ): RuntimeSwapResult {
    return this.withIdempotency(`swap:${input.dimension}`, input.idempotencyKey, () => {
      // ---- Prepare (11.1): read-only, no authoritative state changes ----
      const resolved = this.resolveHandoff(sessionId, input.taskId, now);
      const actorId = this.resolveActorId(sessionId, now);
      this.requireMatchingHead(input.expectedHandoffId, resolved.taskHead, true);
      const current = resolved.activeHandoff.runtime;
      const candidate: RuntimeRef = {
        agentId: input.dimension === "agent" ? input.targetId : current.agentId,
        modelId: input.dimension === "model" ? input.targetId : current.modelId,
        executionHostId: input.dimension === "host" ? input.targetId : current.executionHostId
      };
      // Reuses the same agent/model/host compatibility rules turn-time resolution enforces
      // (section 10) rather than re-implementing them. Throws (leaving the old runtime fully
      // authoritative - nothing below has run yet) if the candidate chain is not viable.
      this.deps.nativeRuntimeBindings.validateCandidateExecutionChain(candidate);

      // ---- Commit (11.2): one small synchronous unit; no I/O, no provider calls ----
      const conversation = this.requireConversationRecord(input.taskId);
      this.requireMatchingHead(input.expectedHandoffId, this.requireTaskHead(input.taskId), true);
      const binding = this.deps.nativeRuntimeBindings.materializeConversationBinding({
        accountId: conversation.accountId,
        businessId: conversation.activeShopId,
        agentId: candidate.agentId,
        modelId: candidate.modelId,
        executionHostId: candidate.executionHostId,
        updatedBy: actorId,
        now
      });
      const previous = resolved.activeHandoff;
      const { handoff, taskHead } = this.allocateAndInsertCheckpoint({
        taskId: input.taskId,
        conversationId: conversation.id,
        parentHandoffId: previous.id,
        goal: previous.goal,
        currentState: previous.currentState,
        completedActions: previous.completedActions,
        decisions: previous.decisions,
        rejectedPaths: previous.rejectedPaths,
        pendingActions: previous.pendingActions,
        nextAction: previous.nextAction,
        relevantContext: previous.relevantContext,
        artifacts: previous.artifacts,
        tests: previous.tests,
        runtime: candidate,
        now,
        promote: true
      });
      this.deps.setConversationRuntimeBinding(conversation.id, binding.id, now);
      this.setTaskInstanceHandoff(input.taskId, handoff.id, "STARTING", candidate, now, null);

      // ---- Activate (11.3): confirm the new chain actually resolves. A failure here never
      // undoes the commit above - the checkpoint and task head stay authoritative regardless
      // (section 12) - it only changes the runtime instance's own lifecycle status. ----
      let activationFailed = false;
      let activationError: string | null = null;
      let runtimeInstance: RuntimeTaskInstance;
      try {
        this.deps.nativeRuntimeBindings.resolveBindingForConversation(binding.id, conversation.id);
        runtimeInstance = this.setTaskInstanceHandoff(input.taskId, handoff.id, "READY", candidate, now, null);
      } catch (error) {
        activationFailed = true;
        activationError = error instanceof Cp2Error ? error.message : "Runtime activation failed.";
        runtimeInstance = this.setTaskInstanceHandoff(
          input.taskId,
          handoff.id,
          "FAILED",
          candidate,
          now,
          activationError
        );
      }

      this.deps.recordAuditEvent({
        type: `runtime_handoff.swap_${input.dimension}`,
        aggregateType: "task",
        aggregateId: input.taskId,
        actorId,
        occurredAt: now.toISOString(),
        payload: {
          handoffId: handoff.id,
          bindingId: binding.id,
          targetId: input.targetId,
          activationFailed
        }
      });

      return { handoff, taskHead, runtimeInstance, activationFailed, activationError };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Rollback (section 14) - moves the head only; never touches handoff history or binding.
  // ---------------------------------------------------------------------------------------------

  rollback(
    sessionId: string | null,
    input: RuntimeRollbackInput,
    now: Date = new Date()
  ): RuntimeRollbackResult {
    return this.withIdempotency("rollback", input.idempotencyKey, () => {
      const resolved = this.resolveHandoff(sessionId, input.taskId, now);
      const actorId = this.resolveActorId(sessionId, now);
      this.requireMatchingHead(input.expectedHandoffId, resolved.taskHead, true);
      const target = this.handoffs.get(input.targetHandoffId);
      if (target === undefined || target.taskId !== input.taskId) {
        throw new Cp2Error(
          404,
          "RUNTIME_HANDOFF_NOT_FOUND",
          "Target checkpoint was not found for this task."
        );
      }
      const taskHead: RuntimeTaskHead = {
        ...resolved.taskHead,
        activeHandoffId: target.id,
        updatedAt: now.toISOString()
      };
      this.taskHeads.set(input.taskId, taskHead);
      this.deps.recordAuditEvent({
        type: "runtime_handoff.rollback",
        aggregateType: "task",
        aggregateId: input.taskId,
        actorId,
        occurredAt: now.toISOString(),
        payload: { fromHandoffId: resolved.activeHandoff.id, toHandoffId: target.id }
      });
      return { taskHead, activeHandoff: target };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Resume (section 13)
  // ---------------------------------------------------------------------------------------------

  resume(
    sessionId: string | null,
    input: RuntimeResumeInput,
    now: Date = new Date()
  ): RuntimeResumeResult {
    const bootstrapped = !this.taskHeads.has(input.taskId);
    const resolved = this.resolveHandoff(sessionId, input.taskId, now);
    const actorId = this.resolveActorId(sessionId, now);
    const runtimeInstance = this.setTaskInstanceHandoff(
      input.taskId,
      resolved.activeHandoff.id,
      "RUNNING",
      resolved.activeHandoff.runtime,
      now,
      null
    );
    this.deps.recordAuditEvent({
      type: "runtime_handoff.resumed",
      aggregateType: "task",
      aggregateId: input.taskId,
      actorId,
      occurredAt: now.toISOString(),
      payload: { handoffId: resolved.activeHandoff.id, nextAction: resolved.activeHandoff.nextAction }
    });
    return {
      taskHead: resolved.taskHead,
      activeHandoff: resolved.activeHandoff,
      runtimeInstance,
      bootstrapped
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private requireConversation(
    sessionId: string | null,
    taskId: string,
    now: Date
  ): { conversation: ConversationSummary; session: AuthSessionView } {
    const session = this.deps.requireAnySession(sessionId, now);
    const conversation = this.deps.conversations.get(taskId);
    if (conversation === undefined) {
      throw new Cp2Error(404, "RUNTIME_TASK_NOT_FOUND", "Task was not found.");
    }
    if (conversation.accountId !== session.account.id) {
      throw new Cp2Error(403, "RUNTIME_TASK_FORBIDDEN", "This task belongs to another account.");
    }
    return { conversation, session };
  }

  /** The authenticated caller's account id. Always derived from the session server-side - never
   *  accepted as a client-supplied `actorId` field, which would let a caller forge audit trail
   *  attribution. Cheap to call a second time alongside `resolveHandoff`/`requireConversation`
   *  since this whole domain runs synchronously against in-memory state. */
  private resolveActorId(sessionId: string | null, now: Date): string {
    return this.deps.requireAnySession(sessionId, now).account.id;
  }

  private requireConversationRecord(taskId: string): ConversationSummary {
    const conversation = this.deps.conversations.get(taskId);
    if (conversation === undefined) {
      throw new Cp2Error(404, "RUNTIME_TASK_NOT_FOUND", "Task was not found.");
    }
    return conversation;
  }

  private requireTaskHead(taskId: string): RuntimeTaskHead {
    const taskHead = this.taskHeads.get(taskId);
    if (taskHead === undefined) {
      throw new Cp2Error(404, "RUNTIME_TASK_HEAD_NOT_FOUND", "Task has no runtime state yet.");
    }
    return taskHead;
  }

  /** Optimistic concurrency (section 7). `required` distinguishes a caller that must supply
   *  `expectedHandoffId` (any mutation that moves the head) from one where it is merely checked
   *  if present. */
  private requireMatchingHead(
    expectedHandoffId: string | undefined,
    taskHead: RuntimeTaskHead,
    required: boolean
  ): void {
    if (expectedHandoffId === undefined) {
      if (required) {
        throw new Cp2Error(
          400,
          "RUNTIME_EXPECTED_HANDOFF_REQUIRED",
          "expectedHandoffId is required for this operation."
        );
      }
      return;
    }
    if (expectedHandoffId !== taskHead.activeHandoffId) {
      throw new Cp2Error(
        409,
        "RUNTIME_HANDOFF_CONFLICT",
        "The task head has moved since expectedHandoffId was read.",
        false,
        { expectedHandoffId, actualHandoffId: taskHead.activeHandoffId }
      );
    }
  }

  private bootstrapLegacyHandoff(
    conversation: ConversationSummary,
    actorId: string,
    now: Date
  ): { handoff: RuntimeHandoff; taskHead: RuntimeTaskHead } {
    let runtime: RuntimeRef;
    try {
      runtime = this.currentRuntimeRefForConversation(conversation);
    } catch (error) {
      throw error instanceof Cp2Error
        ? new Cp2Error(
            503,
            "RUNTIME_LEGACY_BOOTSTRAP_UNAVAILABLE",
            "This task predates the Runtime Handoff Protocol and its current runtime binding " +
              "cannot be resolved, so no checkpoint can be bootstrapped yet.",
            error.retryable,
            error.details
          )
        : error;
    }
    const emptyTests: RuntimeTestResults = { passed: [], failed: [], pending: [] };
    const handoff = this.insertHandoff({
      taskId: conversation.id,
      conversationId: conversation.id,
      parentHandoffId: null,
      goal: "Continue this conversation.",
      currentState:
        "Bootstrapped from pre-existing conversation/runtime-binding state (no prior checkpoint).",
      completedActions: [],
      decisions: [],
      rejectedPaths: [],
      pendingActions: [],
      nextAction: null,
      relevantContext: [],
      artifacts: [],
      tests: emptyTests,
      runtime,
      checkpointVersion: 1,
      schemaVersion: 1,
      now
    });
    const taskHead: RuntimeTaskHead = {
      taskId: conversation.id,
      activeHandoffId: handoff.id,
      nextCheckpointVersion: 2,
      updatedAt: now.toISOString()
    };
    this.taskHeads.set(taskHead.taskId, taskHead);
    this.deps.recordAuditEvent({
      type: "runtime_handoff.legacy_bootstrapped",
      aggregateType: "task",
      aggregateId: conversation.id,
      actorId,
      occurredAt: now.toISOString(),
      payload: { handoffId: handoff.id }
    });
    return { handoff, taskHead };
  }

  private currentRuntimeRefForConversation(conversation: ConversationSummary): RuntimeRef {
    const bindingId = conversation.runtimeBindingId ?? this.deps.defaultRuntimeBindingId;
    const resolved = this.deps.nativeRuntimeBindings.resolveBindingForConversation(
      bindingId,
      conversation.id
    );
    const executionHostId =
      resolved.selected.host?.id ?? resolved.selected.installation?.executionHostId ?? null;
    if (executionHostId === null) {
      throw new Cp2Error(
        503,
        "RUNTIME_MODELS_UNAVAILABLE",
        "No available execution host exists for this conversation's runtime."
      );
    }
    return {
      agentId: resolved.agent.id,
      modelId: resolved.selected.model.id,
      executionHostId
    };
  }

  private insertHandoff(input: {
    taskId: string;
    conversationId: string;
    parentHandoffId: string | null;
    goal: string;
    currentState: string;
    completedActions: RuntimeAction[];
    decisions: RuntimeDecision[];
    rejectedPaths: RuntimeRejectedPath[];
    pendingActions: RuntimeAction[];
    nextAction: string | null;
    relevantContext: RuntimeContextReference[];
    artifacts: RuntimeArtifactReference[];
    tests: RuntimeTestResults;
    runtime: RuntimeRef;
    checkpointVersion: number | null;
    schemaVersion: number;
    now: Date;
  }): RuntimeHandoff {
    const handoff: RuntimeHandoff = {
      id: randomUUID(),
      taskId: input.taskId,
      conversationId: input.conversationId,
      parentHandoffId: input.parentHandoffId,
      goal: input.goal,
      currentState: input.currentState,
      completedActions: input.completedActions,
      decisions: input.decisions,
      rejectedPaths: input.rejectedPaths,
      pendingActions: input.pendingActions,
      nextAction: input.nextAction,
      relevantContext: input.relevantContext,
      artifacts: input.artifacts,
      tests: input.tests,
      runtime: input.runtime,
      checkpointVersion: input.checkpointVersion,
      schemaVersion: input.schemaVersion,
      createdAt: input.now.toISOString()
    };
    this.handoffs.set(handoff.id, handoff);
    return handoff;
  }

  /**
   * The single shared version-allocation + task-head-move primitive (protocol doc section 6.1).
   * Both checkpoint-creation-with-promotion and swap commit call this instead of each
   * reimplementing their own locking - see the class docstring for why a synchronous read-then-
   * write here is already atomic within one process.
   */
  private allocateAndInsertCheckpoint(input: {
    taskId: string;
    conversationId: string;
    parentHandoffId: string | null;
    goal: string;
    currentState: string;
    completedActions: RuntimeAction[];
    decisions: RuntimeDecision[];
    rejectedPaths: RuntimeRejectedPath[];
    pendingActions: RuntimeAction[];
    nextAction: string | null;
    relevantContext: RuntimeContextReference[];
    artifacts: RuntimeArtifactReference[];
    tests: RuntimeTestResults;
    runtime: RuntimeRef;
    now: Date;
    promote: boolean;
  }): { handoff: RuntimeHandoff; taskHead: RuntimeTaskHead } {
    const existingHead = this.taskHeads.get(input.taskId);
    const nextVersion = existingHead?.nextCheckpointVersion ?? 1;
    const handoff = this.insertHandoff({
      taskId: input.taskId,
      conversationId: input.conversationId,
      parentHandoffId: input.parentHandoffId,
      goal: input.goal,
      currentState: input.currentState,
      completedActions: input.completedActions,
      decisions: input.decisions,
      rejectedPaths: input.rejectedPaths,
      pendingActions: input.pendingActions,
      nextAction: input.nextAction,
      relevantContext: input.relevantContext,
      artifacts: input.artifacts,
      tests: input.tests,
      runtime: input.runtime,
      checkpointVersion: nextVersion,
      schemaVersion: 1,
      now: input.now
    });
    const promoteHead = input.promote || existingHead === undefined;
    const taskHead: RuntimeTaskHead = {
      taskId: input.taskId,
      activeHandoffId: promoteHead ? handoff.id : (existingHead as RuntimeTaskHead).activeHandoffId,
      nextCheckpointVersion: nextVersion + 1,
      updatedAt: input.now.toISOString()
    };
    this.taskHeads.set(input.taskId, taskHead);
    return { handoff, taskHead };
  }

  private setTaskInstanceHandoff(
    taskId: string,
    activeHandoffId: string,
    status: RuntimeTaskInstanceStatus,
    runtime: RuntimeRef,
    now: Date,
    lastError: string | null
  ): RuntimeTaskInstance {
    const instance: RuntimeTaskInstance = {
      taskId,
      activeHandoffId,
      status,
      agentId: runtime.agentId,
      modelId: runtime.modelId,
      executionHostId: runtime.executionHostId,
      lastError,
      updatedAt: now.toISOString()
    };
    this.taskInstances.set(taskId, instance);
    return instance;
  }

  /** Idempotency (section 6.2). Synchronous check-then-write, atomic for the same reason
   *  `allocateAndInsertCheckpoint` is - see the class docstring. */
  private withIdempotency<T>(
    operationType: string,
    idempotencyKey: string | null | undefined,
    run: () => T
  ): T {
    if (idempotencyKey === null || idempotencyKey === undefined || idempotencyKey.trim() === "") {
      return run();
    }
    const dedupKey = `${operationType}:${idempotencyKey}`;
    const existing = this.operationDedup.get(dedupKey);
    if (existing !== undefined) {
      return existing.result as T;
    }
    const result = run();
    this.operationDedup.set(dedupKey, {
      id: createHash("sha256").update(dedupKey).digest("hex"),
      operationType,
      idempotencyKey,
      result,
      createdAt: new Date().toISOString()
    });
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Snapshot lifecycle (matches every other CP2 domain's clear/restore/mapGetter shape)
  // ---------------------------------------------------------------------------------------------

  clear(): void {
    this.handoffs.clear();
    this.taskHeads.clear();
    this.taskInstances.clear();
    this.operationDedup.clear();
  }

  restore(snapshot: RuntimeHandoffSnapshot): void {
    this.clear();
    for (const record of snapshot.runtimeHandoffs ?? []) this.handoffs.set(record.id, record);
    for (const record of snapshot.runtimeTaskHeads ?? []) this.taskHeads.set(record.taskId, record);
    for (const record of snapshot.runtimeTaskInstances ?? []) {
      this.taskInstances.set(record.taskId, record);
    }
    for (const record of snapshot.runtimeOperationDedup ?? []) {
      this.operationDedup.set(`${record.operationType}:${record.idempotencyKey}`, record);
    }
  }

  get handoffsMap(): Map<string, RuntimeHandoff> {
    return this.handoffs;
  }
  get taskHeadsMap(): Map<string, RuntimeTaskHead> {
    return this.taskHeads;
  }
  get taskInstancesMap(): Map<string, RuntimeTaskInstance> {
    return this.taskInstances;
  }
  get operationDedupMap(): Map<string, RuntimeOperationDedupRecord> {
    return this.operationDedup;
  }
}
