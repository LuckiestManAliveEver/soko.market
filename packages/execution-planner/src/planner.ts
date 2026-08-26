import { resolveModelPreference } from "./precedence.js";
import { scoreCandidate } from "./scoring.js";
import type {
  AcceptedExecutionCandidate,
  CandidateRejectionReason,
  ExecutionCandidateBase,
  ExecutionPlan,
  ModelPreferenceCandidate,
  PlannerInput,
  ReconciledModel,
  RejectedExecutionCandidate,
  RuntimeHostCandidateInput
} from "./types.js";

/**
 * The pure, standalone Execution Planner (docs/architecture/agent-execution-fabric-phase1.md).
 * No network calls or DB writes anywhere in this function or anything it calls - `input` is
 * already-fetched plain data; `planExecution` only computes. There is no live call site anywhere
 * in the repo that invokes this - `decideInferenceRoute`
 * (apps/web/src/browser-inference-routing.ts) is still what serves production chat traffic.
 *
 * Named stages, in order, matching the brief exactly (each is also individually exported so tests
 * can exercise a single stage in isolation without running the whole pipeline):
 *   resolveAgent -> resolveModelPreference -> discoverHosts -> generateCandidates ->
 *   filterCandidates -> scoreCandidates -> selectCandidate -> buildExecutionPlan
 *
 * "resolveAgent" has no separate function here: by the time `input` is constructed, the caller has
 * already resolved which agent this plan is for and used that to select which preference records
 * and hosts to pass in (input.precedence.agent, input.hosts already scoped to the right
 * tenant/account) - there is nothing left for a pure function to "resolve" from an agent id alone
 * without doing the DB lookups this package deliberately does not do. This mirrors how "discover
 * hosts" is `input.hosts` itself (already fetched and already scoped) rather than a lookup this
 * function performs.
 */
export function planExecution(input: PlannerInput): ExecutionPlan {
  const { preference, level } = resolveModelPreference(input.precedence);
  const hosts = discoverHosts(input.hosts);
  const rawCandidates = generateCandidates(hosts, input.registry);
  const { accepted, rejected } = filterCandidates(rawCandidates, {
    preference,
    hosts,
    registry: input.registry,
    constraints: input.constraints
  });
  const scored = scoreCandidates(accepted, {
    preference,
    hosts,
    registry: input.registry,
    weights: input.weights,
    requestOriginHostId: input.requestOriginHostId,
    preferredHostId: input.constraints.preferredHostId
  });
  const selected = selectCandidate(scored);
  return buildExecutionPlan({ preference, level, selected, scored, rejected });
}

/** Pure pass-through today - kept as its own named stage because a later phase's caller will do
 *  real tenant/account scoping here before handing hosts to the planner; nothing to compute yet
 *  when the input is already scoped. */
export function discoverHosts(hosts: RuntimeHostCandidateInput[]): RuntimeHostCandidateInput[] {
  return hosts;
}

interface RawCandidate {
  hostId: string;
  host: RuntimeHostCandidateInput | null;
  modelId: string;
  model: ReconciledModel;
}

/**
 * Enumerates every (host, installed local model) pair, plus one non-host-bound candidate per
 * registry entry whose executionTarget is "backend" or "cloud" (these represent the platform's
 * own private inference and the operator-configured cloud fallback respectively - neither is tied
 * to a specific RuntimeHost). Nothing is filtered or scored here; every enumerable pairing becomes
 * a raw candidate so filterCandidates can reject it with a specific, visible reason instead of it
 * never having existed.
 */
export function generateCandidates(
  hosts: RuntimeHostCandidateInput[],
  registry: ReconciledModel[]
): RawCandidate[] {
  const byId = new Map(registry.map((model) => [model.id, model]));
  const candidates: RawCandidate[] = [];

  for (const host of hosts) {
    for (const installation of host.installations) {
      const model = byId.get(installation.modelId);
      if (model === undefined) continue; // installed model id not in the reconciled registry at all
      candidates.push({ hostId: host.host.id, host, modelId: model.id, model });
    }
  }

  for (const model of registry) {
    if (model.executionTarget === "backend" || model.executionTarget === "cloud") {
      candidates.push({ hostId: "cloud", host: null, modelId: model.id, model });
    }
  }

  return candidates;
}

export function filterCandidates(
  candidates: RawCandidate[],
  context: {
    preference: ModelPreferenceCandidate;
    hosts: RuntimeHostCandidateInput[];
    registry: ReconciledModel[];
    constraints: PlannerInput["constraints"];
  }
): { accepted: RawCandidate[]; rejected: RejectedExecutionCandidate[] } {
  const accepted: RawCandidate[] = [];
  const rejected: RejectedExecutionCandidate[] = [];

  for (const candidate of candidates) {
    const reason = rejectionReasonFor(candidate, context);
    if (reason === null) {
      accepted.push(candidate);
    } else {
      rejected.push({
        hostId: candidate.hostId,
        modelId: candidate.modelId,
        executionTarget: candidate.model.executionTarget,
        rejected: true,
        rejectionReason: reason
      });
    }
  }

  return { accepted, rejected };
}

function rejectionReasonFor(
  candidate: RawCandidate,
  context: {
    preference: ModelPreferenceCandidate;
    constraints: PlannerInput["constraints"];
  }
): CandidateRejectionReason | null {
  const { requiredHostId, requiresToolCalling } = context.constraints;

  if (requiredHostId !== undefined && candidate.hostId !== requiredHostId) {
    return "REQUIRED_HOST_MISMATCH";
  }
  if (candidate.host !== null && !candidate.host.online) {
    return "HOST_OFFLINE";
  }
  if (candidate.model.executionTarget === "cloud" && !context.preference.allowCloudFallback) {
    return "CLOUD_FALLBACK_DISABLED";
  }
  if (requiresToolCalling === true && !candidate.model.capabilities.includes("tool-routing")) {
    return "TOOL_CAPABILITY_MISMATCH";
  }
  if (
    context.preference.minimumContextWindow !== null &&
    candidate.model.contextWindow !== null &&
    candidate.model.contextWindow < context.preference.minimumContextWindow
  ) {
    return "CONTEXT_WINDOW_TOO_SMALL";
  }
  if (
    candidate.host !== null &&
    candidate.host.availableMemoryGb !== null &&
    candidate.model.minimumMemoryGb !== null &&
    candidate.host.availableMemoryGb < candidate.model.minimumMemoryGb
  ) {
    return "INSUFFICIENT_MEMORY";
  }
  return null;
}

export function scoreCandidates(
  accepted: RawCandidate[],
  context: {
    preference: ModelPreferenceCandidate;
    hosts: RuntimeHostCandidateInput[];
    registry: ReconciledModel[];
    weights: PlannerInput["weights"];
    requestOriginHostId: string | undefined;
    preferredHostId: string | undefined;
  }
): AcceptedExecutionCandidate[] {
  return accepted.map((candidate) => {
    const base: ExecutionCandidateBase = {
      hostId: candidate.hostId,
      modelId: candidate.modelId,
      executionTarget: candidate.model.executionTarget
    };
    return scoreCandidate({
      candidate: base,
      preference: context.preference,
      weights: context.weights,
      host: candidate.host,
      requestOriginHostId: context.requestOriginHostId,
      preferredHostId: context.preferredHostId,
      minimumMemoryGbForModel: candidate.model.minimumMemoryGb
    });
  });
}

/** Highest score wins. Deterministic tie-break: hostId then modelId, ascending - so the same
 *  input always produces the same selection, never an arbitrary array-order artifact. */
export function selectCandidate(
  scored: AcceptedExecutionCandidate[]
): AcceptedExecutionCandidate | null {
  if (scored.length === 0) return null;
  return [...scored].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.hostId !== right.hostId) return left.hostId.localeCompare(right.hostId);
    return left.modelId.localeCompare(right.modelId);
  })[0]!;
}

export function buildExecutionPlan(input: {
  preference: ModelPreferenceCandidate;
  level: ExecutionPlan["resolvedPrecedenceLevel"];
  selected: AcceptedExecutionCandidate | null;
  scored: AcceptedExecutionCandidate[];
  rejected: RejectedExecutionCandidate[];
}): ExecutionPlan {
  return {
    generatedAt: new Date().toISOString(),
    resolvedPreference: input.preference,
    resolvedPrecedenceLevel: input.level,
    selected: input.selected,
    alternatives: input.scored.filter((candidate) => candidate !== input.selected),
    rejected: input.rejected
  };
}
