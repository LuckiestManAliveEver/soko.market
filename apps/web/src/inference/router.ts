import type {
  DeviceInferenceCapabilities,
  InferenceProvider,
  InferenceRouteDecision,
  InferenceRoutingPolicy,
  InferenceRuntime
} from "@soko/shared-types";

export const defaultInferencePriority: InferenceRuntime[] = [
  "native-llama-cpp",
  "browser-webgpu",
  "browser-wasm",
  "owner-node",
  "cloud-fallback"
];

export interface InferenceRouteInput {
  modelId: string;
  capabilities: DeviceInferenceCapabilities;
  providers: InferenceProvider[];
  policy: InferenceRoutingPolicy;
  nativePermission: boolean;
  cloudConsent: boolean;
  modelMinimumMemoryClass?: "low" | "medium" | "high";
  modelApproximateSizeBytes?: number;
  providerHealth?: Partial<Record<string, "healthy" | "degraded" | "unavailable">>;
}

export class InferenceUnavailableError extends Error {
  readonly code = "INFERENCE_UNAVAILABLE";

  constructor(readonly reasons: string[]) {
    super("No permitted inference runtime is currently available.");
    this.name = "InferenceUnavailableError";
  }
}

export async function decideClientInferenceRoute(
  input: InferenceRouteInput
): Promise<InferenceRouteDecision> {
  const candidates: Array<{ provider: InferenceProvider; reason: string }> = [];
  const reasons: string[] = [];
  const priorities = distinctRuntimes(input.policy.priority);

  for (const runtime of priorities) {
    const providers = input.providers
      .filter((provider) => provider.runtime === runtime)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const provider of providers) {
      const rejection = await rejectionReason(input, provider);
      if (rejection === null) {
        candidates.push({
          provider,
          reason: routeReason(provider.runtime, input.capabilities, input.modelId)
        });
      } else {
        reasons.push(`${provider.id}: ${rejection}`);
      }
    }
  }

  const selected = candidates[0];
  if (selected === undefined) throw new InferenceUnavailableError(reasons);
  return {
    providerId: selected.provider.id,
    runtime: selected.provider.runtime,
    modelId: input.modelId,
    reason: selected.reason,
    fallbackProviderIds: candidates
      .slice(1, 1 + Math.max(0, input.policy.maximumFallbacks))
      .map(({ provider }) => provider.id)
  };
}

async function rejectionReason(
  input: InferenceRouteInput,
  provider: InferenceProvider
): Promise<string | null> {
  const runtime = provider.runtime;
  if (input.providerHealth?.[provider.id] === "unavailable")
    return "provider health is unavailable";
  if (
    runtime === "native-llama-cpp" &&
    (!input.nativePermission || !input.policy.allowNativeBridge)
  ) {
    return "native execution was not allowed";
  }
  if (runtime === "native-llama-cpp" && !input.capabilities.nativeBridge) {
    return "native bridge was not detected";
  }
  if (runtime === "browser-webgpu" && !input.capabilities.webgpu) return "WebGPU is unavailable";
  if (runtime === "browser-wasm" && !input.capabilities.wasm) return "WASM is unavailable";
  if (
    (runtime === "browser-webgpu" || runtime === "browser-wasm") &&
    !deviceMeetsMemoryRequirement(
      input.capabilities.estimatedMemoryClass,
      input.modelMinimumMemoryClass
    )
  ) {
    return "device memory class is below the model minimum";
  }
  if (
    (runtime === "browser-webgpu" || runtime === "browser-wasm") &&
    !input.capabilities.online &&
    input.policy.requireCachedBrowserModelWhenOffline &&
    !input.capabilities.cachedModelIds.includes(input.modelId)
  ) {
    return "the selected model is not cached for offline use";
  }
  if (
    runtime === "owner-node" &&
    (!input.policy.allowOwnerNode ||
      input.policy.privacyMode === "local-only" ||
      !input.capabilities.ownerNodeReachable ||
      !input.capabilities.online)
  ) {
    return "owner-node routing is unavailable or disallowed";
  }
  if (
    runtime === "cloud-fallback" &&
    (!input.policy.allowCloudFallback ||
      input.policy.privacyMode !== "cloud-with-consent" ||
      !input.capabilities.online ||
      !input.cloudConsent)
  ) {
    return "paid cloud fallback is disabled or lacks explicit consent";
  }
  if (!(await provider.isAvailable().catch(() => false))) return "provider is unavailable";
  if (!(await provider.supports(input.modelId).catch(() => false))) {
    return "model is not supported";
  }
  return null;
}

function distinctRuntimes(runtimes: InferenceRuntime[]): InferenceRuntime[] {
  return [...new Set(runtimes)];
}

function routeReason(
  runtime: InferenceRuntime,
  capabilities: DeviceInferenceCapabilities,
  modelId: string
): string {
  const cached = capabilities.cachedModelIds.includes(modelId);
  switch (runtime) {
    case "native-llama-cpp":
      return "An allowed installed native bridge is available.";
    case "browser-webgpu":
      return cached
        ? "The compatible model is cached and WebGPU is available."
        : "WebGPU is available for client-first inference.";
    case "browser-wasm":
      return cached
        ? "The compatible model is cached for the browser WASM fallback."
        : "WebAssembly is available as the CPU fallback.";
    case "owner-node":
      return "The authenticated shop-owner device is reachable.";
    case "cloud-fallback":
      return "The tenant enabled cloud fallback and the user explicitly consented.";
  }
}

function deviceMeetsMemoryRequirement(
  actual: DeviceInferenceCapabilities["estimatedMemoryClass"],
  required: InferenceRouteInput["modelMinimumMemoryClass"]
): boolean {
  if (required === undefined || actual === "unknown") return true;
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[actual] >= rank[required];
}
