/**
 * Runtime Handoff Protocol types.
 *
 * See docs/architecture/runtime-handoff-protocol.md for the full design. In short: a
 * `RuntimeHandoff` is an immutable, portable checkpoint of a task's in-flight execution state -
 * independent of conversation transcript, agent, model, execution host, provider, and runtime
 * process. Swapping any of those repoints execution to a new handoff instead of replaying chat
 * history.
 *
 * Soko has no separate `tasks` entity distinct from `conversations` (see
 * cp2/domains/native-runtime/store.ts): a conversation is the unit of runtime execution, so
 * `taskId` is always populated with the owning conversation's id today. The field stays named
 * `taskId` throughout so a future task/conversation split only has to add a real `tasks` table,
 * not rename this protocol.
 */

export type RuntimeSwapDimension = "agent" | "model" | "host";

export type RuntimeActionStatus = "pending" | "completed" | "failed";

/** A concrete unit of work the runtime has done, is doing, or intends to do. Deliberately narrow
 *  and extensible (an index signature of `unknown`) rather than untyped `Record<string, unknown>`
 *  blobs, per the protocol's "no `any`" requirement - callers get real field types for the parts
 *  every consumer needs, and can still round-trip caller-specific metadata. */
export interface RuntimeAction {
  id: string;
  description: string;
  status?: RuntimeActionStatus;
  metadata?: Record<string, unknown>;
}

export interface RuntimeDecision {
  id: string;
  description: string;
  rationale: string | null;
  decidedAt: string;
}

export interface RuntimeRejectedPath {
  id: string;
  description: string;
  reason: string;
}

export type RuntimeContextReferenceKind =
  "recall" | "message" | "document" | "artifact" | "external";

/** A pointer into durable state (recall, a conversation message, a stored document, ...) - never
 *  the content itself. Keeping this a reference, not a copy, is what keeps `recall` (long-term
 *  memory) and conversation transcripts out of the handoff row; see invariant 1.4 and section 19
 *  of the protocol design doc. */
export interface RuntimeContextReference {
  kind: RuntimeContextReferenceKind;
  refId: string;
  description?: string;
}

export interface RuntimeArtifactReference {
  id: string;
  kind: string;
  uri: string;
  description?: string;
}

export interface RuntimeTestResults {
  passed: string[];
  failed: string[];
  pending: string[];
}

/** The runtime binding snapshot a handoff was created under. References Soko's actual native
 *  runtime graph entities (cp2_native_runtime_agents / cp2_native_runtime_models /
 *  cp2_native_execution_hosts), not a generic `agents`/`models`/`execution_hosts` schema. */
export interface RuntimeHandoffRuntimeRef {
  agentId: string;
  modelId: string;
  executionHostId: string;
}

/** An immutable, portable checkpoint of one task's in-flight execution state. Never updated after
 *  creation (invariant 1.1) - a new state always means a new row, with `parentHandoffId` pointing
 *  at the previous one. Whether a given handoff is the task's *current* checkpoint is determined
 *  by `RuntimeTaskHead.activeHandoffId`, never by a field on this object. */
export interface RuntimeHandoff {
  id: string;
  taskId: string;
  conversationId: string;

  parentHandoffId: string | null;
  /** Additional ancestor checkpoints beyond `parentHandoffId`, populated only for a merge
   *  checkpoint (created by `mergeCheckpoints`/`POST .../merge`) that unifies two or more offline
   *  branches - see "Offline causal ancestry" in the protocol doc. Empty for every ordinary
   *  (non-merge) checkpoint. `parentHandoffId` plus this array together are the checkpoint's full
   *  causal ancestry; a merge's `parentHandoffId` is its first branch tip and this array holds the
   *  rest, so `[parentHandoffId, ...mergedFromHandoffIds]` is the complete parent set. */
  mergedFromHandoffIds: string[];

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

  runtime: RuntimeHandoffRuntimeRef;

  /** Cloud-authoritative ordering, assigned atomically by the task head's version counter when the
   *  checkpoint is created online, or by `syncOfflineCheckpoints`/`POST .../checkpoints/sync` when
   *  a checkpoint created offline is later synchronized (see "Offline causal ancestry" in the
   *  protocol doc). A handoff is only ever null here between offline creation and sync - once
   *  synced it is permanent, like every other field on an immutable handoff row. */
  checkpointVersion: number | null;
  schemaVersion: number;

  createdAt: string;
}

/** The authoritative mutable pointer for a task's current execution state (invariant 1.2).
 *  Never derive "which handoff is active" from a status field on a handoff row - this is the
 *  only place that answer lives. */
export interface RuntimeTaskHead {
  taskId: string;
  activeHandoffId: string;
  nextCheckpointVersion: number;
  updatedAt: string;
}

/** Runtime health is independent of task state (section 12) - a valid task head can coexist with
 *  a FAILED runtime instance. */
export type RuntimeTaskInstanceStatus =
  "STARTING" | "READY" | "RUNNING" | "DEGRADED" | "FAILED" | "STOPPED";

/** The checkpoint this task's current executor *believes* it is running, plus its lifecycle
 *  status. Comparing `activeHandoffId` here against `RuntimeTaskHead.activeHandoffId` for the
 *  same task is runtime drift detection (section 5/12). This is the closest Soko has to the
 *  protocol's generic "runtime_instances" concept for a per-task executing process; it is
 *  intentionally a new, narrow table rather than an extension of `cp2_runtime_sessions`, which is
 *  a distinct business/user-scoped agentic-planner concept (see invariant 1.4). */
export interface RuntimeTaskInstance {
  taskId: string;
  activeHandoffId: string | null;
  status: RuntimeTaskInstanceStatus;
  agentId: string | null;
  modelId: string | null;
  executionHostId: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** resolveHandoff()'s return shape - kept analogous to `resolveExecutionChain`/
 *  `resolveRuntimeBinding` so callers never reconstruct this state by hand across repositories. */
export interface ResolvedRuntimeHandoff {
  taskId: string;
  conversationId: string;
  activeHandoff: RuntimeHandoff;
  taskHead: RuntimeTaskHead;
  runtimeInstance: RuntimeTaskInstance | null;
  isRuntimeStale: boolean;
}

export interface RuntimeCheckpointCreateInput {
  taskId: string;
  goal?: string;
  currentState?: string;
  completedActions?: RuntimeAction[];
  decisions?: RuntimeDecision[];
  rejectedPaths?: RuntimeRejectedPath[];
  pendingActions?: RuntimeAction[];
  nextAction?: string | null;
  relevantContext?: RuntimeContextReference[];
  artifacts?: RuntimeArtifactReference[];
  testsPassed?: string[];
  testsFailed?: string[];
  testsPending?: string[];
  /** When true, also moves the task head to the newly created checkpoint (section 6, step 7).
   *  When false, the checkpoint is recorded in history without becoming authoritative. */
  promote?: boolean;
  /** Optimistic concurrency guard (section 7): required whenever `promote` is true. */
  expectedHandoffId?: string;
  idempotencyKey?: string | null;
}

// `actorId` is deliberately absent from every mutation input above and below: it is always the
// authenticated caller (resolved from the session, server-side), never a client-supplied field -
// see RuntimeHandoffDomain.resolveActorId in cp2/domains/runtime-handoff/store.ts.

export interface RuntimeCheckpointResult {
  handoff: RuntimeHandoff;
  taskHead: RuntimeTaskHead;
  promoted: boolean;
}

export interface RuntimeSwapInput {
  taskId: string;
  dimension: RuntimeSwapDimension;
  targetId: string;
  expectedHandoffId?: string;
  idempotencyKey?: string | null;
}

export interface RuntimeSwapResult {
  handoff: RuntimeHandoff;
  taskHead: RuntimeTaskHead;
  runtimeInstance: RuntimeTaskInstance;
  /** True when the DB commit (checkpoint + task head move) succeeded but the Activate phase
   *  (section 11.3) could not confirm the new runtime chain is actually usable. The handoff and
   *  task head remain valid either way - see section 12. */
  activationFailed: boolean;
  activationError: string | null;
}

export interface RuntimeRollbackInput {
  taskId: string;
  targetHandoffId: string;
  expectedHandoffId?: string;
  idempotencyKey?: string | null;
}

export interface RuntimeRollbackResult {
  taskHead: RuntimeTaskHead;
  activeHandoff: RuntimeHandoff;
}

export interface RuntimeResumeInput {
  taskId: string;
}

export interface RuntimeResumeResult {
  taskHead: RuntimeTaskHead;
  activeHandoff: RuntimeHandoff;
  runtimeInstance: RuntimeTaskInstance;
  /** True when this call had to synthesize the task's first handoff from legacy (pre-protocol)
   *  conversation/binding state because none existed yet (section 20). */
  bootstrapped: boolean;
}

// ---------------------------------------------------------------------------------------------
// Offline causal ancestry: a task can branch while offline (multiple checkpoints created locally
// off the same parent, on different devices or during a network partition) and later merge back
// into one canonical line. See "Offline causal ancestry" in the protocol doc.
// ---------------------------------------------------------------------------------------------

/** One checkpoint as created by an offline client: everything an online checkpoint has, minus
 *  `taskId`/`conversationId` (supplied by the sync call's context) and `checkpointVersion` (never
 *  client-assigned - see RuntimeHandoff.checkpointVersion). `id` and `createdAt` *are*
 *  client-supplied here, unlike every other mutation in this protocol: the client already used
 *  `id` as another offline checkpoint's `parentHandoffId` before syncing, and `createdAt` should
 *  reflect when the checkpoint actually happened offline, not when it happened to reach the
 *  server. Neither drives any authorization or ordering decision - `checkpointVersion` (assigned
 *  at sync time) is what cloud-authoritative ordering actually uses. */
export interface RuntimeOfflineCheckpointInput {
  id: string;
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
  runtime: RuntimeHandoffRuntimeRef;
  schemaVersion: number;
  createdAt: string;
}

export interface RuntimeOfflineSyncInput {
  taskId: string;
  /** Must be in causal order: a checkpoint's `parentHandoffId`, if not null, must already exist
   *  server-side (from a prior sync) or appear earlier in this same array. */
  checkpoints: RuntimeOfflineCheckpointInput[];
  /** When true, moves the task head to `promoteToHandoffId` (default: the last checkpoint in
   *  `checkpoints`) once every checkpoint in the batch is synced. */
  promote?: boolean;
  promoteToHandoffId?: string;
  expectedHandoffId?: string;
  idempotencyKey?: string | null;
}

export interface RuntimeOfflineSyncResult {
  /** One entry per input checkpoint, in the same order - each now carrying a server-assigned
   *  `checkpointVersion`. A checkpoint whose `id` already existed (a retried sync) is returned
   *  as-is rather than re-inserted. */
  syncedHandoffs: RuntimeHandoff[];
  taskHead: RuntimeTaskHead;
}

/** Unifies two or more branch tips (offline or online) into one new checkpoint.
 *  `branchHandoffIds[0]` becomes the merge checkpoint's `parentHandoffId`; the rest become
 *  `mergedFromHandoffIds`. The merged goal/state/actions/etc. are supplied explicitly by the
 *  caller (arbitrary N-way conflict resolution across divergent action lists is out of scope for
 *  this protocol) - omitted fields default to `branchHandoffIds[0]`'s. */
export interface RuntimeMergeInput {
  taskId: string;
  branchHandoffIds: string[];
  goal?: string;
  currentState?: string;
  completedActions?: RuntimeAction[];
  decisions?: RuntimeDecision[];
  rejectedPaths?: RuntimeRejectedPath[];
  pendingActions?: RuntimeAction[];
  nextAction?: string | null;
  relevantContext?: RuntimeContextReference[];
  artifacts?: RuntimeArtifactReference[];
  testsPassed?: string[];
  testsFailed?: string[];
  testsPending?: string[];
  expectedHandoffId: string;
  idempotencyKey?: string | null;
}

export interface RuntimeMergeResult {
  handoff: RuntimeHandoff;
  taskHead: RuntimeTaskHead;
}
