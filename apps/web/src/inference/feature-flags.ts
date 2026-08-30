// Browser-local (WebGPU/WASM) and installed-app-native-bridge client inference flags were retired
// with the private on-device model architecture (see apps/web/src/browser-inference-* removal).
// The owner-node route survives: a shop-owned authenticated device (e.g. a merchant's own laptop)
// is still a legitimate client-side execution target, distinct from private per-browser inference.
export interface ClientInferenceFeatureFlags {
  ownerNode: boolean;
  maximumFallbacks: number;
}

export function readClientInferenceFeatureFlags(
  environment: Record<string, string | boolean | undefined> = import.meta.env
): ClientInferenceFeatureFlags {
  return {
    ownerNode: environment.VITE_INFERENCE_OWNER_NODE_ENABLED === "true",
    maximumFallbacks: positiveInteger(environment.VITE_INFERENCE_MAX_FALLBACKS, 3)
  };
}

function positiveInteger(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : fallback;
}
