import type {
  AcceptedExecutionCandidate,
  ExecutionCandidateBase,
  ModelPreferenceCandidate,
  PlannerWeights,
  RuntimeHostCandidateInput
} from "./types.js";

/**
 * Fixed per-execution-target baselines for signals that are a property of *where* a model runs,
 * not of any one candidate's specific circumstances. Named and documented here (not inline in
 * scoreCandidate) so a reviewer can see the whole signal table in one place. These are distinct
 * from PlannerWeights, which control how much each *signal* (including these baselines) matters
 * relative to the others - these tables say what the raw [0, 1] signal value is for a given
 * execution target, before any weight is applied.
 */
const latencyBaselineByTarget: Record<ExecutionCandidateBase["executionTarget"], number> = {
  local: 1,
  backend: 0.6,
  cloud: 0.3
};

const privacyBaselineByTarget: Record<ExecutionCandidateBase["executionTarget"], number> = {
  local: 1,
  backend: 0.6,
  cloud: 0
};

/** Only cloud execution carries a marginal per-request cost in the current cost model. */
const costByTarget: Record<ExecutionCandidateBase["executionTarget"], number> = {
  local: 0,
  backend: 0,
  cloud: 1
};

export function scoreCandidate(input: {
  candidate: ExecutionCandidateBase;
  preference: ModelPreferenceCandidate;
  weights: PlannerWeights;
  host: RuntimeHostCandidateInput | null;
  requestOriginHostId: string | undefined;
  preferredHostId: string | undefined;
  minimumMemoryGbForModel: number | null;
}): AcceptedExecutionCandidate {
  const preferenceRank = modelPreferenceRankSignal(input.candidate.modelId, input.preference);
  const locality = localitySignal({
    hostId: input.candidate.hostId,
    executionTarget: input.candidate.executionTarget,
    requestOriginHostId: input.requestOriginHostId,
    preferredHostId: input.preferredHostId,
    executionPreference: input.preference.executionPreference
  });
  const hostHealth = hostHealthSignal(input.host, input.minimumMemoryGbForModel);
  const warmModel = warmModelSignal(input.candidate.modelId, input.host);
  const latency = latencyBaselineByTarget[input.candidate.executionTarget];
  const privacy = privacyBaselineByTarget[input.candidate.executionTarget];
  const costPenalty = costByTarget[input.candidate.executionTarget];

  const scoreBreakdown: Record<keyof PlannerWeights, number> = {
    modelPreferenceRank: preferenceRank * input.weights.modelPreferenceRank,
    locality: locality * input.weights.locality,
    hostHealth: hostHealth * input.weights.hostHealth,
    warmModel: warmModel * input.weights.warmModel,
    latency: latency * input.weights.latency,
    privacy: privacy * input.weights.privacy,
    costPenalty: -costPenalty * input.weights.costPenalty
  };

  const score = Object.values(scoreBreakdown).reduce((total, part) => total + part, 0);

  return {
    hostId: input.candidate.hostId,
    modelId: input.candidate.modelId,
    executionTarget: input.candidate.executionTarget,
    rejected: false,
    score,
    scoreBreakdown
  };
}

/** 1.0 for the top preferredModelIds entry, decaying toward 0.5 for later ones; fallbackModelIds
 *  start at 0.4 and decay toward 0.1; a model in neither list scores 0. */
function modelPreferenceRankSignal(modelId: string, preference: ModelPreferenceCandidate): number {
  const preferredIndex = preference.preferredModelIds.indexOf(modelId);
  if (preferredIndex >= 0) {
    return Math.max(0.5, 1 - preferredIndex * 0.1);
  }
  const fallbackIndex = preference.fallbackModelIds.indexOf(modelId);
  if (fallbackIndex >= 0) {
    return Math.max(0.1, 0.4 - fallbackIndex * 0.1);
  }
  return 0;
}

/**
 * Combines three independent reasons a candidate might score higher on "where it runs": it's on
 * the same host the request originated from, an operator explicitly named it as a soft-preferred
 * host, or the resolved preference's `executionPreference` policy favors this candidate's
 * execution target. The highest of the three applies (they are alternative reasons to prefer a
 * location, not additive bonuses for the same reason).
 */
function localitySignal(input: {
  hostId: string;
  executionTarget: ExecutionCandidateBase["executionTarget"];
  requestOriginHostId: string | undefined;
  preferredHostId: string | undefined;
  executionPreference: ModelPreferenceCandidate["executionPreference"];
}): number {
  const sameOrigin =
    input.requestOriginHostId !== undefined && input.hostId === input.requestOriginHostId ? 1 : 0;
  const preferredHost =
    input.preferredHostId !== undefined && input.hostId === input.preferredHostId ? 1 : 0;
  const policyAlignment = executionPreferenceAlignment(
    input.executionPreference,
    input.executionTarget
  );
  return Math.max(sameOrigin, preferredHost, policyAlignment);
}

/** How well a candidate's execution target matches the resolved preference's stated policy. */
function executionPreferenceAlignment(
  executionPreference: ModelPreferenceCandidate["executionPreference"],
  executionTarget: ExecutionCandidateBase["executionTarget"]
): number {
  if (executionPreference === "local-first") {
    return executionTarget === "local" ? 1 : executionTarget === "backend" ? 0.6 : 0;
  }
  if (executionPreference === "cloud-first") {
    return executionTarget === "cloud" ? 1 : executionTarget === "backend" ? 0.6 : 0;
  }
  return 0.5; // balanced: no directional preference
}

function hostHealthSignal(
  host: RuntimeHostCandidateInput | null,
  minimumMemoryGbForModel: number | null
): number {
  if (host === null) return 1; // cloud candidates have no host to assess
  if (host.availableMemoryGb === null || minimumMemoryGbForModel === null) return 0.5;
  if (minimumMemoryGbForModel <= 0) return 1;
  return Math.min(1, host.availableMemoryGb / (minimumMemoryGbForModel * 2));
}

function warmModelSignal(modelId: string, host: RuntimeHostCandidateInput | null): number {
  return host !== null && host.warmModelIds.includes(modelId) ? 1 : 0;
}
