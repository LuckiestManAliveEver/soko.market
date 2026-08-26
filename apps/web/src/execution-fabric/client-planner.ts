import {
  defaultPlannerWeights,
  planExecution,
  type ExecutionPlan,
  type ModelPreferenceCandidate,
  type PlannerInput,
  type ReconciledModel,
  type RuntimeHostCandidateInput
} from "@soko/execution-planner";
import type { InferenceProvider, InferenceRouteDecision, RuntimeModelInstallationSummary } from "@soko/shared-types";
import { defaultOfflineAiModels, type LocalAiModel } from "../ai-model-manager.js";

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §2). Client-side counterpart to the
 * server's `reconcileLiveModelRegistries()` - there is no analogous "two registries disagree"
 * problem to reconcile in the browser (the client only ever sees its own local model catalog,
 * `defaultOfflineAiModels`, the client's copy of the same on-device model list `aiModelRegistry`
 * mirrors server-side), so this is a direct mapping rather than a reconciliation.
 */
function reconciledModelsFromClientCatalog(): ReconciledModel[] {
  return defaultOfflineAiModels.map((model) => ({
    id: model.id,
    label: model.label,
    executionTarget: "local",
    capabilities: model.capabilities,
    contextWindow: null,
    minimumMemoryGb: model.minimumMemoryGb,
    sources: ["aiModelRegistry"]
  }));
}

/**
 * A synthetic, never-persisted `RuntimeHostCandidateInput` representing "this browser" - built
 * fresh from already-available client state on every call, never written to
 * ExecutionFabricStore/any HTTP route. There is exactly one such host client-side; unlike the
 * server path, cross-device `RuntimeHost` presence (the owner-node broker) is explicitly out of
 * scope for this phase (Phase 3) and never appears here.
 */
function thisDeviceHost(installedModels: LocalAiModel[]): RuntimeHostCandidateInput {
  const installations: RuntimeModelInstallationSummary[] = installedModels
    .filter(
      (model) => model.installationStatus === "INSTALLED" && model.compatibilityStatus === "COMPATIBLE"
    )
    .map((model) => ({
      id: model.id,
      runtimeHostId: "this-device",
      accountId: "local",
      modelId: model.modelId,
      status: "installed",
      installedAt: model.installedAt,
      updatedAt: model.installedAt
    }));
  return {
    host: {
      id: "this-device",
      accountId: "local",
      ownerId: "local",
      name: "This device",
      trustLevel: "owner-verified",
      brokerNodeId: null,
      declaredRuntimes: [],
      maxConcurrentJobs: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    installations,
    online: true,
    warmModelIds: [],
    availableMemoryGb: null
  };
}

/**
 * Plans a single chat turn's execution entirely client-side. Only ever produces "local" candidates
 * (this device's installed models) - unlike the server's planner integration, it never sees
 * backend/cloud candidates (there is no client-side registry entry for them here), so a plan with
 * `selected: null` from this function means "no usable local model", not "no model anywhere";
 * the caller falls through to the existing `decideClientInferenceRoute`/`executeInferenceRoute`
 * chain for backend/cloud exactly as it does today.
 */
export function planBrowserExecution(input: {
  installedModels: LocalAiModel[];
  preference: ModelPreferenceCandidate;
}): ExecutionPlan {
  const plannerInput: PlannerInput = {
    precedence: {
      request: null,
      conversation: null,
      agent: null,
      user: null,
      system: input.preference
    },
    hosts: [thisDeviceHost(input.installedModels)],
    registry: reconciledModelsFromClientCatalog(),
    constraints: {},
    weights: defaultPlannerWeights
  };
  return planExecution(plannerInput);
}

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §8's now-closed follow-up). Pure
 * helper extracted specifically so `useChatRuntimeState.ts` - the single largest, most heavily
 * stateful client chat-execution hook in the app - only ever has to call one already-tested,
 * one-line function rather than carry planner logic inline where it could not be unit-tested in
 * isolation. Builds an `InferenceRouteDecision` (the exact shape `decideClientInferenceRoute`
 * already produces and `executeInferenceRoute` already knows how to run) from a browser-local
 * `ExecutionPlan`, matching the plan's selected model to whichever already-built browser
 * `InferenceProvider` (browser-webgpu or browser-wasm) is present in `providers` - it never
 * constructs a provider itself. Returns `null` whenever there is no usable local candidate or no
 * matching provider, so the caller's existing fallthrough to `decideClientInferenceRoute` is
 * untouched in every case this function can't confidently resolve.
 */
export function planBrowserExecutionRoute(input: {
  installedModels: LocalAiModel[];
  preferredModelId: string | null;
  providers: InferenceProvider[];
}): InferenceRouteDecision | null {
  if (input.preferredModelId === null) return null;
  const plan = planBrowserExecution({
    installedModels: input.installedModels,
    preference: {
      scope: "system",
      preferredModelIds: [input.preferredModelId],
      fallbackModelIds: [],
      requiredCapabilities: [],
      executionPreference: "local-first",
      qualityPreference: "balanced",
      allowCloudFallback: false,
      maxCostPerRequest: null,
      maxLatencyMs: null,
      minimumContextWindow: null
    }
  });
  if (plan.selected === null) return null;
  const provider = input.providers.find(
    (candidate) => candidate.runtime === "browser-webgpu" || candidate.runtime === "browser-wasm"
  );
  if (provider === undefined) return null;
  return {
    providerId: provider.id,
    runtime: provider.runtime,
    modelId: plan.selected.modelId,
    reason: "execution-fabric-planner",
    fallbackProviderIds: []
  };
}
