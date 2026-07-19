import type {
  BrowserDeviceTier,
  BrowserInferenceBackend,
  BrowserModelDescriptor
} from "./browser-inference-types";

export const browserLocalInferenceDeploymentEnabled =
  import.meta.env.VITE_BROWSER_LOCAL_INFERENCE_ENABLED === "true";

export const browserModelRegistry: readonly BrowserModelDescriptor[] = [
  {
    id: "smollm2-360m-instruct-browser",
    displayName: "SmolLM2 360M browser assistant",
    provider: "browser-local",
    architecture: "LlamaForCausalLM",
    modelUrl: "https://huggingface.co/onnx-community/SmolLM2-360M-Instruct-ONNX",
    modelFormat: "ONNX",
    quantization: "q4",
    approximateDownloadBytes: 400_000_000,
    approximateRuntimeMemoryBytes: 850_000_000,
    contextWindowTokens: 2_048,
    minimumDeviceTier: "low",
    supportedBackends: ["webgpu", "wasm"],
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/main/LICENSE",
    enabled: true
  }
];

const tierRank: Record<BrowserDeviceTier, number> = { low: 0, medium: 1, high: 2 };

export function listBrowserModels(): BrowserModelDescriptor[] {
  return browserModelRegistry.filter((model) => model.enabled).map((model) => ({ ...model }));
}

export function getBrowserModel(modelId: string): BrowserModelDescriptor | null {
  const model = browserModelRegistry.find((candidate) => candidate.id === modelId);
  return model?.enabled === true ? { ...model } : null;
}

export function browserModelSupports(
  model: BrowserModelDescriptor,
  tier: BrowserDeviceTier,
  backend: BrowserInferenceBackend
): boolean {
  return (
    backend !== "none" &&
    model.supportedBackends.includes(backend) &&
    tierRank[tier] >= tierRank[model.minimumDeviceTier]
  );
}

export function assertApprovedBrowserModelUrl(modelUrl: string): string {
  const url = new URL(modelUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "huggingface.co" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.pathname.startsWith("/onnx-community/")
  ) {
    throw new Error("The browser model URL is not on Soko's approved model origin.");
  }
  return url.pathname.replace(/^\/+|\/+$/g, "");
}
