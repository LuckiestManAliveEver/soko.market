import type {
  BrowserDeviceTier,
  BrowserInferenceBackend,
  BrowserInferenceCapability,
  BrowserModelDescriptor,
  BrowserModelExecutionOutcome,
  BrowserModelOption,
  BrowserTaskBudget
} from "./browser-inference-types";

export const browserLocalInferenceDeploymentEnabled =
  import.meta.env.VITE_BROWSER_LOCAL_INFERENCE_ENABLED === "true" &&
  import.meta.env.VITE_INFERENCE_CLIENT_FIRST !== "false";

export const browserModelRegistry: readonly BrowserModelDescriptor[] = [
  {
    manifestVersion: 3,
    id: "smollm2-135m-instruct-browser",
    modelFamilyId: "smollm2-135m-instruct",
    displayName: "SmolLM2 135M Lite",
    provider: "browser-local",
    runtimeAdapter: "transformers-js",
    runtimeAdapterVersion: "3.8.1",
    runtimeModelId: "onnx-community/SmolLM2-135M-Instruct-ONNX",
    architecture: "LlamaForCausalLM",
    modelUrl: "https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX",
    modelRevision: "b8a5c0f",
    modelFormat: "ONNX",
    quantization: "q4",
    pipeline: "text-generation",
    dtypeByBackend: { webgpu: "q4", wasm: "q4" },
    promptTemplateId: "smollm2-instruct-v1",
    approximateDownloadBytes: 190_000_000,
    approximateRuntimeMemoryBytes: 500_000_000,
    contextWindowTokens: 2_048,
    recommendedContextTokens: { low: 768, medium: 1_024, high: 1_536 },
    recommendedOutputTokens: { low: 64, medium: 96, high: 128 },
    maximumGenerationTimeMs: { low: 45_000, medium: 60_000, high: 75_000 },
    taskClasses: ["short-chat", "classification", "field-extraction", "summarization"],
    readinessPrompt: "Reply with only the word READY.",
    readinessMaxTokens: 8,
    supportedRuntimes: ["browser-webgpu", "browser-wasm"],
    minimumDeviceTier: "low",
    supportedBackends: ["webgpu", "wasm"],
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/blob/main/LICENSE",
    enabled: true
  },
  {
    manifestVersion: 3,
    id: "smollm2-360m-instruct-browser",
    modelFamilyId: "smollm2-360m-instruct",
    displayName: "SmolLM2 360M",
    provider: "browser-local",
    runtimeAdapter: "transformers-js",
    runtimeAdapterVersion: "3.8.1",
    runtimeModelId: "onnx-community/SmolLM2-360M-Instruct-ONNX",
    architecture: "LlamaForCausalLM",
    modelUrl: "https://huggingface.co/onnx-community/SmolLM2-360M-Instruct-ONNX",
    modelRevision: "9bc69bf",
    modelFormat: "ONNX",
    quantization: "q4",
    pipeline: "text-generation",
    dtypeByBackend: { webgpu: "q4", wasm: "q4" },
    promptTemplateId: "smollm2-instruct-v1",
    approximateDownloadBytes: 400_000_000,
    approximateRuntimeMemoryBytes: 850_000_000,
    contextWindowTokens: 2_048,
    recommendedContextTokens: { low: 768, medium: 1_536, high: 2_048 },
    recommendedOutputTokens: { low: 64, medium: 128, high: 160 },
    maximumGenerationTimeMs: { low: 45_000, medium: 75_000, high: 90_000 },
    taskClasses: ["short-chat", "classification", "field-extraction", "summarization"],
    readinessPrompt: "Reply with only the word READY.",
    readinessMaxTokens: 8,
    supportedRuntimes: ["browser-webgpu", "browser-wasm"],
    minimumDeviceTier: "low",
    supportedBackends: ["webgpu", "wasm"],
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/main/LICENSE",
    enabled: true
  },
  {
    manifestVersion: 3,
    id: "qwen2.5-0.5b-instruct-browser",
    modelFamilyId: "qwen2.5-0.5b-instruct",
    displayName: "Qwen2.5 0.5B",
    provider: "browser-local",
    runtimeAdapter: "transformers-js",
    runtimeAdapterVersion: "3.8.1",
    runtimeModelId: "onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
    architecture: "Qwen2ForCausalLM",
    modelUrl: "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct-ONNX",
    modelRevision: "4b32b4541cf2de9d0c0a85125e8fe8d9943f7982",
    modelFormat: "ONNX",
    quantization: "q4",
    pipeline: "text-generation",
    dtypeByBackend: { webgpu: "q4" },
    promptTemplateId: "qwen2.5-instruct-v1",
    approximateDownloadBytes: 800_000_000,
    approximateRuntimeMemoryBytes: 1_500_000_000,
    contextWindowTokens: 2_048,
    recommendedContextTokens: { low: 512, medium: 1_024, high: 2_048 },
    recommendedOutputTokens: { low: 48, medium: 96, high: 160 },
    maximumGenerationTimeMs: { low: 45_000, medium: 75_000, high: 90_000 },
    taskClasses: ["short-chat", "classification", "field-extraction", "summarization"],
    readinessPrompt: "Reply with only the word READY.",
    readinessMaxTokens: 8,
    supportedRuntimes: ["browser-webgpu"],
    minimumDeviceTier: "high",
    supportedBackends: ["webgpu"],
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE",
    enabled: true
  },
  {
    manifestVersion: 3,
    id: "smollm2-360m-instruct-webllm",
    modelFamilyId: "smollm2-360m-instruct",
    displayName: "SmolLM2 360M · WebLLM",
    provider: "browser-local",
    runtimeAdapter: "webllm",
    runtimeAdapterVersion: "0.2.84",
    runtimeModelId: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    runtimeLibraryRevision: "025bcaf3780fa8254f5e5efd3bfea0a5397248f4",
    architecture: "LlamaForCausalLM",
    modelUrl: "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f16_1-MLC",
    modelRevision: "3a622fd89e0216e8bb10c410c007c786baa8a033",
    modelFormat: "MLC",
    quantization: "q4f16_1",
    pipeline: "text-generation",
    dtypeByBackend: { webgpu: "q4" },
    promptTemplateId: "smollm2-instruct-v1",
    approximateDownloadBytes: 260_000_000,
    approximateRuntimeMemoryBytes: 450_000_000,
    contextWindowTokens: 2_048,
    recommendedContextTokens: { low: 512, medium: 1_024, high: 1_536 },
    recommendedOutputTokens: { low: 48, medium: 96, high: 128 },
    maximumGenerationTimeMs: { low: 45_000, medium: 60_000, high: 75_000 },
    taskClasses: ["short-chat", "classification", "field-extraction", "summarization"],
    readinessPrompt: "Reply with only the word READY.",
    readinessMaxTokens: 8,
    supportedRuntimes: ["browser-webgpu"],
    minimumDeviceTier: "medium",
    supportedBackends: ["webgpu"],
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/main/LICENSE",
    enabled: true
  },
  {
    manifestVersion: 3,
    id: "qwen2.5-0.5b-instruct-webllm",
    modelFamilyId: "qwen2.5-0.5b-instruct",
    displayName: "Qwen2.5 0.5B · WebLLM",
    provider: "browser-local",
    runtimeAdapter: "webllm",
    runtimeAdapterVersion: "0.2.84",
    runtimeModelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    runtimeLibraryRevision: "025bcaf3780fa8254f5e5efd3bfea0a5397248f4",
    architecture: "Qwen2ForCausalLM",
    modelUrl: "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    modelRevision: "32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad",
    modelFormat: "MLC",
    quantization: "q4f16_1",
    pipeline: "text-generation",
    dtypeByBackend: { webgpu: "q4" },
    promptTemplateId: "qwen2.5-instruct-v1",
    approximateDownloadBytes: 600_000_000,
    approximateRuntimeMemoryBytes: 1_100_000_000,
    contextWindowTokens: 2_048,
    recommendedContextTokens: { low: 512, medium: 768, high: 1_536 },
    recommendedOutputTokens: { low: 48, medium: 64, high: 128 },
    maximumGenerationTimeMs: { low: 45_000, medium: 60_000, high: 90_000 },
    taskClasses: ["short-chat", "classification", "field-extraction", "summarization"],
    readinessPrompt: "Reply with only the word READY.",
    readinessMaxTokens: 8,
    supportedRuntimes: ["browser-webgpu"],
    minimumDeviceTier: "high",
    supportedBackends: ["webgpu"],
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE",
    enabled: true
  }
];

const tierRank: Record<BrowserDeviceTier, number> = { low: 0, medium: 1, high: 2 };

export function listBrowserModels(): BrowserModelDescriptor[] {
  return browserModelRegistry.filter((model) => model.enabled).map(copyModel);
}

export function getBrowserModel(modelId: string): BrowserModelDescriptor | null {
  const model = browserModelRegistry.find((candidate) => candidate.id === modelId);
  return model?.enabled === true ? copyModel(model) : null;
}

export function browserModelCompatibilityReason(
  model: BrowserModelDescriptor,
  tier: BrowserDeviceTier,
  backend: BrowserInferenceBackend
): string | null {
  if (!model.enabled) return "This model is disabled.";
  if (backend === "none") return "No browser inference backend is available.";
  if (!model.supportedBackends.includes(backend) || model.dtypeByBackend[backend] === undefined) {
    return `${backend.toUpperCase()} is not supported by this model profile.`;
  }
  if (tierRank[tier] < tierRank[model.minimumDeviceTier]) {
    return `This model requires a ${model.minimumDeviceTier} device profile.`;
  }
  return null;
}

export function browserModelSupports(
  model: BrowserModelDescriptor,
  tier: BrowserDeviceTier,
  backend: BrowserInferenceBackend
): boolean {
  return browserModelCompatibilityReason(model, tier, backend) === null;
}

export function browserTaskBudget(
  model: BrowserModelDescriptor,
  capability: BrowserInferenceCapability
): BrowserTaskBudget {
  const tier = capability.deviceTier;
  return {
    maxInputTokens: Math.min(
      model.contextWindowTokens,
      model.recommendedContextTokens[tier],
      capability.maxRecommendedContextTokens
    ),
    maxOutputTokens: model.recommendedOutputTokens[tier],
    maxWallTimeMs: model.maximumGenerationTimeMs[tier],
    maxEstimatedMemoryBytes: model.approximateRuntimeMemoryBytes,
    continuationAllowed: true
  };
}

export function rankBrowserModelsForDevice(input: {
  capability: BrowserInferenceCapability;
  outcomes?: BrowserModelExecutionOutcome[];
}): BrowserModelOption[] {
  const outcomes = new Map(
    (input.outcomes ?? []).map((outcome) => [
      `${outcome.deviceProfileId}:${outcome.modelId}:${outcome.backend}`,
      outcome
    ])
  );
  return listBrowserModels()
    .map((model): BrowserModelOption => {
      const reason = browserModelCompatibilityReason(
        model,
        input.capability.deviceTier,
        input.capability.backend
      );
      const outcome =
        input.capability.backend === "none"
          ? null
          : (outcomes.get(
              `${deviceInferenceProfileId(input.capability)}:${model.id}:${input.capability.backend}`
            ) ?? null);
      let score = reason === null ? 1_000 : -10_000;
      if (model.id === input.capability.recommendedModelId) score += 250;
      if (input.capability.backend === "webgpu" && model.runtimeAdapter === "webllm") score += 350;
      if (outcome?.successful === true) score += 500;
      if (outcome?.successful === false) score -= 2_000;
      score -= Math.round(model.approximateDownloadBytes / 10_000_000);
      return {
        model,
        compatible: reason === null,
        reason,
        score,
        previousOutcome: outcome
      };
    })
    .sort(
      (left, right) =>
        Number(right.compatible) - Number(left.compatible) ||
        right.score - left.score ||
        left.model.displayName.localeCompare(right.model.displayName)
    );
}

export function deviceInferenceProfileId(capability: BrowserInferenceCapability): string {
  const browserMajor = capability.browser.version?.split(".")[0] ?? "unknown";
  return [
    capability.browser.name.toLowerCase(),
    browserMajor,
    capability.browser.mobile ? "mobile" : "desktop",
    capability.deviceTier,
    capability.backend,
    Math.min(16, capability.logicalProcessors)
  ].join(":");
}

export function assertApprovedBrowserModelUrl(model: BrowserModelDescriptor): string {
  const url = new URL(model.modelUrl);
  const approvedNamespace = model.runtimeAdapter === "webllm" ? "/mlc-ai/" : "/onnx-community/";
  if (
    url.protocol !== "https:" ||
    url.hostname !== "huggingface.co" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !url.pathname.startsWith(approvedNamespace)
  ) {
    throw new Error("The browser model URL is not on Soko's approved model origin.");
  }
  return url.pathname.replace(/^\/+|\/+$/g, "");
}

function copyModel(model: BrowserModelDescriptor): BrowserModelDescriptor {
  return {
    ...model,
    dtypeByBackend: { ...model.dtypeByBackend },
    recommendedContextTokens: { ...model.recommendedContextTokens },
    recommendedOutputTokens: { ...model.recommendedOutputTokens },
    maximumGenerationTimeMs: { ...model.maximumGenerationTimeMs },
    taskClasses: [...model.taskClasses],
    supportedRuntimes: [...model.supportedRuntimes],
    supportedBackends: [...model.supportedBackends]
  };
}
