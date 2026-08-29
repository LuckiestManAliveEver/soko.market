import {
  isModelExecutionTarget,
  type AgentModelBindingSummary,
  type ModelExecutionTarget,
  type ResolvedNativeRuntimeBinding,
  type RuntimeModelTrace,
  type RuntimeModelProvider,
  type ShopAgentRuntime
} from "@soko/shared-types";

import {
  runtimeProviderFromAdapter,
  type ModelRuntimeAdapter
} from "../../../inference/model-runtime.js";
import { Cp2Error } from "../../cp2-error.js";

/**
 * Where a resolved execution target actually came from, for observability
 * (services/api/src/cp2/domains/agent-runtime/runtime-model-routing.ts logs this on every turn) and
 * for tests that need to assert the precedence rule fired correctly rather than just its output.
 */
export type ExecutionTargetResolutionSource =
  "explicit-native-configuration" | "explicit-native-host" | "legacy-binding";

export interface ExecutionTargetResolution {
  target: ModelExecutionTarget;
  source: ExecutionTargetResolutionSource;
}

// Split out so it can be unit-tested against each precedence branch (native configuration, native
// host, legacy binding, terminal failure) directly, without needing a full adapter/provider to
// exercise it.
//
// Deliberately has no final "else" branch that returns a default target: a model or binding that
// never declared where it runs is a routing failure, not an implicit "backend" default. Backend
// execution requires a deliberately configured, reachable host - silently assuming one manufactures
// a network dependency ("cannot currently be reached") that may not even exist in this deployment.
// See docs/architecture/provider-neutral-runtime.md.
export function resolveExecutionTarget(input: {
  nativeResolution: ResolvedNativeRuntimeBinding | null;
  legacyBinding: AgentModelBindingSummary | null;
  modelId: string;
  agentId: string;
}): ExecutionTargetResolution {
  // A model may be installed on more than one execution location. The selected host is therefore
  // authoritative; model.configuration.executionTarget is retained only as a compatibility
  // fallback for partially migrated rows without a concrete host.
  const hostType = input.nativeResolution?.selected.host?.type;
  if (isModelExecutionTarget(hostType)) {
    return { target: hostType, source: "explicit-native-host" };
  }
  const declaredTarget = input.nativeResolution?.selected.model.configuration.executionTarget;
  if (isModelExecutionTarget(declaredTarget)) {
    return { target: declaredTarget, source: "explicit-native-configuration" };
  }
  if (input.legacyBinding !== null) {
    return { target: input.legacyBinding.executionTarget, source: "legacy-binding" };
  }
  throw new Cp2Error(
    409,
    "NO_COMPATIBLE_EXECUTION_TARGET",
    "No execution target is configured for this model. Choose or reconfigure a model before sending an AI message.",
    false,
    {
      modelId: input.modelId,
      agentId: input.agentId,
      hasNativeResolution: input.nativeResolution !== null,
      hasLegacyBinding: input.legacyBinding !== null
    }
  );
}

export function resolveNativeRuntimeModelProvider(input: {
  shopRuntime: ShopAgentRuntime;
  requestedModelId: string;
  legacyBinding: AgentModelBindingSummary | null;
  nativeResolution: ResolvedNativeRuntimeBinding | null;
  requireAdapter: (input: {
    modelId: string;
    executionTarget: ModelExecutionTarget;
    agentId: string;
    businessId: string;
  }) => ModelRuntimeAdapter;
  adapterResolverConfigured: boolean;
  runtimeModelProvider?: RuntimeModelProvider;
  runtimeModelProviderResolver?: (modelId: string) => RuntimeModelProvider | undefined;
  attemptedRuntimeKeys?: ReadonlySet<string>;
  eligibleExecutionTargets?: ReadonlySet<ModelExecutionTarget>;
}): {
  provider: RuntimeModelProvider | undefined;
  binding: AgentModelBindingSummary | null;
  executionTarget: ModelExecutionTarget | undefined;
  resolutionSource: ExecutionTargetResolutionSource | null;
  runtimeKey: string | null;
  runtimeBindingId: string | null;
  resolvedModelId: string;
  executionHostId: string | null;
  fallbackIndex: number;
} {
  const nativeResolution = selectUnattemptedNativeResolution(
    input.nativeResolution,
    input.attemptedRuntimeKeys,
    input.eligibleExecutionTargets,
    input.legacyBinding !== null
  );
  const { legacyBinding, shopRuntime } = input;
  const modelId =
    nativeResolution?.selected.model.id ?? legacyBinding?.modelId ?? input.requestedModelId;
  const agentId = nativeResolution?.agent.id ?? legacyBinding?.agentId ?? shopRuntime.agentId;
  const shopId =
    nativeResolution?.binding.businessId ?? legacyBinding?.shopId ?? shopRuntime.shopId;

  if (!input.adapterResolverConfigured) {
    // No adapter-based execution path is wired up at all - callers in this shape (a handful of
    // tests driving `runtimeModelProvider`/`runtimeModelProviderResolver` directly, bypassing the
    // execution-target/adapter system entirely) never consult the resolved target to route
    // anything, so there is nothing to fail routing over. Still resolve it best-effort, since it
    // only feeds observability (telemetry, trace) here, never a real network call.
    const provider =
      input.runtimeModelProviderResolver === undefined
        ? input.runtimeModelProvider
        : input.runtimeModelProviderResolver(modelId);
    const bestEffort = tryResolveExecutionTarget({
      nativeResolution,
      legacyBinding,
      modelId,
      agentId
    });
    return {
      provider,
      binding: legacyBinding,
      executionTarget: bestEffort?.target,
      resolutionSource: bestEffort?.source ?? null,
      runtimeKey:
        bestEffort === null
          ? null
          : runtimeCandidateKey(
              modelId,
              nativeResolution?.selected.host?.id ?? null,
              bestEffort.target
            ),
      runtimeBindingId: nativeResolution?.binding.id ?? legacyBinding?.id ?? null,
      resolvedModelId: modelId,
      executionHostId: nativeResolution?.selected.host?.id ?? null,
      fallbackIndex:
        nativeResolution?.selected.bindingModel.role === "fallback"
          ? nativeResolution.fallbacks.findIndex(
              (candidate) => candidate.bindingModel.id === nativeResolution.selected.bindingModel.id
            ) + 1
          : 0
    };
  }

  const { target: executionTarget, source: resolutionSource } = resolveExecutionTarget({
    nativeResolution,
    legacyBinding,
    modelId,
    agentId
  });
  const runtimeKey = runtimeCandidateKey(
    modelId,
    nativeResolution?.selected.host?.id ?? null,
    executionTarget
  );
  if (input.attemptedRuntimeKeys?.has(runtimeKey)) {
    throw new Cp2Error(
      503,
      "RUNTIME_MODELS_UNAVAILABLE",
      "No unattempted compatible runtime remains for this request.",
      true
    );
  }
  const adapter = input.requireAdapter({ modelId, executionTarget, agentId, businessId: shopId });
  const provider = runtimeProviderFromAdapter({ adapter, context: { modelId, agentId, shopId } });
  return {
    provider,
    binding: legacyBinding,
    executionTarget,
    resolutionSource,
    runtimeKey,
    runtimeBindingId: nativeResolution?.binding.id ?? legacyBinding?.id ?? null,
    resolvedModelId: modelId,
    executionHostId: nativeResolution?.selected.host?.id ?? null,
    fallbackIndex:
      nativeResolution?.selected.bindingModel.role === "fallback"
        ? nativeResolution.fallbacks.findIndex(
            (candidate) => candidate.bindingModel.id === nativeResolution.selected.bindingModel.id
          ) + 1
        : 0
  };
}

function selectUnattemptedNativeResolution(
  resolution: ResolvedNativeRuntimeBinding | null,
  attempted: ReadonlySet<string> | undefined,
  eligibleTargets: ReadonlySet<ModelExecutionTarget> | undefined,
  hasLegacyFallback: boolean
): ResolvedNativeRuntimeBinding | null {
  if (resolution === null) return null;
  const candidates = [resolution.primary, ...resolution.fallbacks].filter(
    (candidate, index, all) =>
      candidate.available &&
      all.findIndex((other) => other.bindingModel.id === candidate.bindingModel.id) === index
  );
  const selected = candidates.find((candidate) => {
    const target = candidate.host?.type ?? candidate.model.configuration.executionTarget;
    return (
      isModelExecutionTarget(target) &&
      (eligibleTargets === undefined || eligibleTargets.has(target)) &&
      !attempted?.has(runtimeCandidateKey(candidate.model.id, candidate.host?.id ?? null, target))
    );
  });
  if (selected === undefined) {
    // No unattempted/eligible native candidate remains. Only degrade to null (letting the caller's
    // legacyBinding get a chance) when a legacy binding actually exists as an alternative - a legacy
    // binding stays a valid, currently-working escape hatch when every native role targets
    // something this request can't reach (e.g. a local-only binding resolved from a server context)
    // or has already failed this turn. Without a legacy binding there is nothing left to try, so
    // this must still throw: the "no adapter resolver configured" test-bypass branch above has no
    // attemptedRuntimeKeys check of its own and relies entirely on this throw to stop a retry loop
    // from re-invoking the exact same provider after it already failed once.
    if (hasLegacyFallback) return null;
    throw new Cp2Error(
      503,
      "RUNTIME_MODELS_UNAVAILABLE",
      "No unattempted compatible runtime remains for this request.",
      true
    );
  }
  return {
    ...resolution,
    selected,
    fallbackUsed: selected.bindingModel.role === "fallback",
    fallbackReason:
      selected.bindingModel.role === "fallback"
        ? attempted !== undefined && attempted.size > 0
          ? "PREVIOUS_EXECUTION_ATTEMPT_FAILED"
          : "PRIMARY_EXECUTION_TARGET_NOT_REACHABLE_FROM_SERVER"
        : resolution.fallbackReason
  };
}

function runtimeCandidateKey(
  modelId: string,
  executionHostId: string | null,
  target: ModelExecutionTarget
): string {
  return `${modelId}:${executionHostId ?? "unbound"}:${target}`;
}

function tryResolveExecutionTarget(
  input: Parameters<typeof resolveExecutionTarget>[0]
): ExecutionTargetResolution | null {
  try {
    return resolveExecutionTarget(input);
  } catch (error) {
    if (error instanceof Cp2Error) return null;
    throw error;
  }
}

export function assertResolvedRuntimeAvailable(
  resolution: ResolvedNativeRuntimeBinding | null,
  trace: RuntimeModelTrace | null
): void {
  if (resolution === null || trace === null || trace.status === "available") {
    return;
  }
  throw new Cp2Error(
    trace.status === "timeout" ? 504 : 503,
    "AGENT_MODEL_UNAVAILABLE",
    "The resolved runtime model could not complete this message.",
    true,
    {
      runtimeBindingId: resolution.binding.id,
      agentId: resolution.agent.id,
      modelId: resolution.selected.model.id,
      executionHostId: resolution.selected.host?.id ?? null,
      installationId: resolution.selected.installation?.id ?? null,
      fallbackReason: resolution.fallbackReason,
      runtimeErrorCode: trace.errorCode
    }
  );
}
