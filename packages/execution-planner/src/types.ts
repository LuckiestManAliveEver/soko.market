import type {
  InferenceChunk,
  InferenceRequest,
  ModelExecutionPreference,
  ModelPreferenceScope,
  ModelQualityPreference,
  RuntimeHostSummary,
  RuntimeModelInstallationSummary
} from "@soko/shared-types";

/**
 * The Execution Planner is a pure, standalone library (docs/architecture/
 * agent-execution-fabric-phase1.md). It has no network calls or DB writes anywhere in this
 * module or in scoring.ts/precedence.ts/registry-reconciliation.ts - every function here takes
 * already-fetched plain data and returns a plain result. Gathering that data from Cp2Store,
 * ExecutionFabricStore, and OwnerNodeBroker, and doing anything with the resulting ExecutionPlan,
 * is explicitly out of scope for this phase (no live call site exists anywhere in the repo that
 * imports this package).
 */

/** A single candidate model preference record, at one precedence level, as already fetched. */
export interface ModelPreferenceCandidate {
  scope: ModelPreferenceScope;
  preferredModelIds: string[];
  fallbackModelIds: string[];
  requiredCapabilities: string[];
  executionPreference: ModelExecutionPreference;
  qualityPreference: ModelQualityPreference;
  allowCloudFallback: boolean;
  maxCostPerRequest: number | null;
  maxLatencyMs: number | null;
  minimumContextWindow: number | null;
}

/** One level's override, or absence of one, in precedence order. `null` means "not set at this level". */
export interface PrecedenceInput {
  request: ModelPreferenceCandidate | null;
  conversation: ModelPreferenceCandidate | null;
  agent: ModelPreferenceCandidate | null;
  user: ModelPreferenceCandidate | null;
  system: ModelPreferenceCandidate;
}

export type PrecedenceLevel = "request" | "conversation" | "agent" | "user" | "system";

/** A reconciled catalog entry - the planner's single view of "what models exist and what can they do". */
export interface ReconciledModel {
  id: string;
  label: string;
  executionTarget: "local" | "backend" | "cloud";
  capabilities: string[];
  contextWindow: number | null;
  minimumMemoryGb: number | null;
  /** Which source registry contributed this entry: both, only one, or reconciled from a conflict. */
  sources: Array<"aiModelRegistry" | "runtimeModels">;
}

/**
 * A genuine disagreement between the two source registries for the same model id - not merely one
 * source having a field the other lacks. Surfaced, never silently resolved (task requirement).
 */
export interface ModelRegistryConflict {
  modelId: string;
  field: string;
  aiModelRegistryValue: unknown;
  runtimeModelsValue: unknown;
}

export interface ModelRegistryReconciliation {
  models: ReconciledModel[];
  conflicts: ModelRegistryConflict[];
}

/** A RuntimeHost plus its installations and transient (non-persisted) liveness/warmth signals. */
export interface RuntimeHostCandidateInput {
  host: RuntimeHostSummary;
  installations: RuntimeModelInstallationSummary[];
  /** From OwnerNodeBroker.listPresence()/isReachable() at call time - never persisted (see RuntimeHostSummary doc comment). */
  online: boolean;
  /** Model ids this host currently has loaded in memory, if known - transient, supplied by the caller. */
  warmModelIds: string[];
  availableMemoryGb: number | null;
}

export type CandidateRejectionReason =
  | "INSUFFICIENT_MEMORY"
  | "MODEL_NOT_INSTALLED"
  | "CLOUD_FALLBACK_DISABLED"
  | "HOST_OFFLINE"
  | "CONTEXT_WINDOW_TOO_SMALL"
  | "TOOL_CAPABILITY_MISMATCH"
  | "REQUIRED_HOST_MISMATCH";

export interface ExecutionCandidateBase {
  hostId: string | "cloud";
  modelId: string;
  executionTarget: "local" | "backend" | "cloud";
}

export interface AcceptedExecutionCandidate extends ExecutionCandidateBase {
  rejected: false;
  score: number;
  scoreBreakdown: Record<keyof PlannerWeights, number>;
}

export interface RejectedExecutionCandidate extends ExecutionCandidateBase {
  rejected: true;
  rejectionReason: CandidateRejectionReason;
}

export type ExecutionCandidate = AcceptedExecutionCandidate | RejectedExecutionCandidate;

/**
 * Weights are a named, documented config object - no inline magic numbers in scoring.ts. Every
 * weight is a non-negative multiplier applied to a [0, 1]-normalized signal before summing; the
 * candidate with the highest total wins (selectCandidate, deterministic tie-break by hostId then
 * modelId).
 */
export interface PlannerWeights {
  /** How high this model ranks in the resolved preference's preferredModelIds/fallbackModelIds list. */
  modelPreferenceRank: number;
  /** Local execution (on the same device the request originated from) over remote. */
  locality: number;
  /** Host liveness/capacity headroom. */
  hostHealth: number;
  /** The model is already loaded in memory on the candidate host (warmModelIds). */
  warmModel: number;
  /** Lower declared/estimated latency scores higher. */
  latency: number;
  /** Local/on-device execution scores higher than sending data off-device. */
  privacy: number;
  /** Subtracted, not added - higher cost lowers the score. */
  costPenalty: number;
}

export const defaultPlannerWeights: PlannerWeights = {
  modelPreferenceRank: 3,
  locality: 1,
  hostHealth: 1,
  warmModel: 1.5,
  latency: 1,
  privacy: 0.5,
  costPenalty: 2
};

export interface ExecutionPlan {
  generatedAt: string;
  resolvedPreference: ModelPreferenceCandidate;
  resolvedPrecedenceLevel: PrecedenceLevel;
  selected: AcceptedExecutionCandidate | null;
  alternatives: AcceptedExecutionCandidate[];
  rejected: RejectedExecutionCandidate[];
}

/** Hard constraints. A required host that has no viable candidate makes the whole plan empty
 *  (selected: null) rather than silently falling back to a different host - see planner.ts. */
export interface PlannerConstraints {
  requiredHostId?: string;
  preferredHostId?: string;
  requiresToolCalling?: boolean;
}

export interface PlannerInput {
  precedence: PrecedenceInput;
  hosts: RuntimeHostCandidateInput[];
  registry: ReconciledModel[];
  constraints: PlannerConstraints;
  weights: PlannerWeights;
  requestOriginHostId?: string;
}

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md). Reused verbatim rather than
 * inventing a second wire/event protocol: `RuntimeRequest` is `InferenceRequest` and `RuntimeEvent`
 * is `InferenceChunk` - the one streaming shape every existing live runtime (browser-webgpu,
 * browser-wasm, native-llama-cpp, owner-node, cloud-fallback) already produces
 * (packages/shared-types/src/index.ts, consumed by apps/web/src/inference/executor.ts). A
 * RuntimeAdapter wraps a specific ALREADY-EXISTING execution path (never a new execution
 * capability) behind this one contract so a plan's selected candidate can be executed without the
 * caller knowing which concrete runtime backs it.
 */
export type RuntimeRequest = InferenceRequest;
export type RuntimeEvent = InferenceChunk;

export interface RuntimeAdapter {
  canExecute(plan: ExecutionPlan): Promise<boolean>;
  execute(plan: ExecutionPlan, request: RuntimeRequest): AsyncIterable<RuntimeEvent>;
  cancel?(runtimeSessionId: string): Promise<void>;
}

/**
 * The full set of ways a plan can fail to be executable, spanning both planning time (every
 * `CandidateRejectionReason` from filterCandidates) and two additional whole-plan/execution-time
 * states that are not about any one candidate: `NO_COMPATIBLE_MODEL` (every candidate was
 * rejected, or none were ever generated) and `EXECUTION_HOST_LOST` (a candidate was accepted and
 * selected, but the adapter that was supposed to run it failed/disappeared at execution time -
 * this can never be produced by the pure planner itself, only by a caller's adapter-execution
 * loop after planning has finished).
 */
export type PlannerErrorCode =
  | CandidateRejectionReason
  | "NO_COMPATIBLE_MODEL"
  | "NO_RUNTIME_HOST"
  | "EXECUTION_HOST_LOST";

export interface PlannerError {
  code: PlannerErrorCode;
  modelId: string | null;
  hostId: string | "cloud" | null;
}
