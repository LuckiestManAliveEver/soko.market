export interface ClientInferenceFeatureFlags {
  clientFirst: boolean;
  browserWebGpu: boolean;
  browserWasm: boolean;
  nativeBridge: boolean;
  ownerNode: boolean;
  cloudFallback: boolean;
  maximumFallbacks: number;
}

export function readClientInferenceFeatureFlags(
  environment: Record<string, string | boolean | undefined> = import.meta.env
): ClientInferenceFeatureFlags {
  const clientFirst = environment.VITE_INFERENCE_CLIENT_FIRST === "true";
  return {
    clientFirst,
    browserWebGpu: clientFirst && environment.VITE_INFERENCE_BROWSER_WEBGPU_ENABLED !== "false",
    browserWasm: clientFirst && environment.VITE_INFERENCE_BROWSER_WASM_ENABLED !== "false",
    nativeBridge: clientFirst && environment.VITE_INFERENCE_NATIVE_BRIDGE_ENABLED === "true",
    ownerNode: clientFirst && environment.VITE_INFERENCE_OWNER_NODE_ENABLED === "true",
    cloudFallback: clientFirst && environment.VITE_INFERENCE_CLOUD_FALLBACK_ENABLED === "true",
    maximumFallbacks: positiveInteger(environment.VITE_INFERENCE_MAX_FALLBACKS, 2)
  };
}

function positiveInteger(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : fallback;
}
