import type {
  AgentModelBindingSummary,
  ModelExecutionTarget,
  ResolvedNativeRuntimeBinding,
  RuntimeModelTrace,
  RuntimeModelProvider,
  ShopAgentRuntime
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
  | "explicit-native-configuration"
  | "explicit-native-host"
  | "legacy-binding";

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
  const declaredTarget = input.nativeResolution?.selected.model.configuration.executionTarget;
  if (isExecutionTarget(declaredTarget)) {
    return { target: declaredTarget, source: "explicit-native-configuration" };
  }
  // `configuration` is an untyped bag (Record<string, unknown>): a model row written before this
  // field existed, or restored from a partial snapshot, can lack it even though the model resolved
  // to a concrete, available host (resolveBinding in native-runtime/store.ts only ever selects an
  // `available` candidate, and `available` implies a non-null host). That host's `type` was stamped
  // by upsertVerifiedHost with the exact target the host was created for, so reading it here is
  // still a genuine explicit signal recovered from durable state, not a guess.
  const hostType = input.nativeResolution?.selected.host?.type;
  if (isExecutionTarget(hostType)) {
    return { target: hostType, source: "explicit-native-host" };
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
}): {
  provider: RuntimeModelProvider | undefined;
  binding: AgentModelBindingSummary | null;
  executionTarget: ModelExecutionTarget | undefined;
  resolutionSource: ExecutionTargetResolutionSource | null;
} {
  const { nativeResolution, legacyBinding, shopRuntime } = input;
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
    const bestEffort = tryResolveExecutionTarget({ nativeResolution, legacyBinding, modelId, agentId });
    return {
      provider,
      binding: legacyBinding,
      executionTarget: bestEffort?.target,
      resolutionSource: bestEffort?.source ?? null
    };
  }

  const { target: executionTarget, source: resolutionSource } = resolveExecutionTarget({
    nativeResolution,
    legacyBinding,
    modelId,
    agentId
  });
  const adapter = input.requireAdapter({ modelId, executionTarget, agentId, businessId: shopId });
  const provider = runtimeProviderFromAdapter({ adapter, context: { modelId, agentId, shopId } });
  return { provider, binding: legacyBinding, executionTarget, resolutionSource };
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

function isExecutionTarget(value: unknown): value is ModelExecutionTarget {
  return (
    value === "backend" ||
    value === "browser-local" ||
    value === "installed-app" ||
    value === "remote-shop-device" ||
    value === "openai"
  );
}
