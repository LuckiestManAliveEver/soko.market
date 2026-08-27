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
}): { provider: RuntimeModelProvider | undefined; binding: AgentModelBindingSummary | null } {
  const { nativeResolution, legacyBinding, shopRuntime } = input;
  const modelId =
    nativeResolution?.selected.model.id ?? legacyBinding?.modelId ?? input.requestedModelId;
  const configuredTarget = nativeResolution?.selected.model.configuration.executionTarget;
  const executionTarget: ModelExecutionTarget = isExecutionTarget(configuredTarget)
    ? configuredTarget
    : (legacyBinding?.executionTarget ?? "backend");
  const agentId = nativeResolution?.agent.id ?? legacyBinding?.agentId ?? shopRuntime.agentId;
  const shopId =
    nativeResolution?.binding.businessId ?? legacyBinding?.shopId ?? shopRuntime.shopId;
  const isBuiltIn =
    modelId === "sokoclaw-local" && nativeResolution?.selected.host?.type === "in-process";
  const adapter =
    !input.adapterResolverConfigured || isBuiltIn
      ? undefined
      : input.requireAdapter({ modelId, executionTarget, agentId, businessId: shopId });
  const provider =
    adapter === undefined
      ? input.runtimeModelProviderResolver === undefined
        ? input.runtimeModelProvider
        : input.runtimeModelProviderResolver(modelId)
      : runtimeProviderFromAdapter({ adapter, context: { modelId, agentId, shopId } });
  return { provider, binding: legacyBinding };
}

export function assertResolvedRuntimeAvailable(
  resolution: ResolvedNativeRuntimeBinding | null,
  trace: RuntimeModelTrace | null
): void {
  if (
    resolution === null ||
    resolution.selected.model.id === "sokoclaw-local" ||
    trace === null ||
    trace.status === "available"
  ) {
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
