import { describe, expect, it } from "vitest";
import {
  browserTaskBudget,
  getBrowserModel,
  rankBrowserModelsForDevice
} from "../apps/web/src/browser-model-registry";
import type { BrowserInferenceCapability } from "../apps/web/src/browser-inference-types";

function capability(
  tier: BrowserInferenceCapability["deviceTier"],
  backend: BrowserInferenceCapability["backend"]
): BrowserInferenceCapability {
  return {
    supported: backend !== "none",
    backend,
    deviceTier: tier,
    recommendedModelId:
      tier === "low"
        ? "smollm2-135m-instruct-browser"
        : tier === "medium"
          ? "smollm2-360m-instruct-browser"
          : "qwen2.5-0.5b-instruct-browser",
    maxRecommendedContextTokens: tier === "low" ? 1_024 : 2_048,
    reasons: [],
    browser: { name: "Chrome", version: "130.0.0", mobile: true },
    crossOriginIsolated: true,
    logicalProcessors: tier === "low" ? 2 : 8,
    availableStorageBytes: 2_000_000_000,
    indexedDbAvailable: true,
    persistentStorage: true,
    installedPwa: true,
    workerAvailable: true
  };
}

describe("browser model profiles", () => {
  it("selects the 135M profile first for a low-end WASM phone", () => {
    const options = rankBrowserModelsForDevice({ capability: capability("low", "wasm") });
    expect(options[0]).toMatchObject({
      compatible: true,
      model: { id: "smollm2-135m-instruct-browser" }
    });
    expect(
      options.find((option) => option.model.id === "qwen2.5-0.5b-instruct-browser")
    ).toMatchObject({
      compatible: false
    });
  });

  it("allows the pinned Qwen Q4 profile only on high-tier WebGPU devices", () => {
    const mediumOptions = rankBrowserModelsForDevice({
      capability: capability("medium", "webgpu")
    });
    expect(
      mediumOptions.find((option) => option.model.id === "qwen2.5-0.5b-instruct-browser")
    ).toMatchObject({ compatible: false });

    const highOptions = rankBrowserModelsForDevice({
      capability: capability("high", "webgpu")
    });
    const qwen = highOptions.find((option) => option.model.id === "qwen2.5-0.5b-instruct-browser");
    expect(qwen).toMatchObject({
      compatible: true,
      model: {
        modelRevision: "4b32b4541cf2de9d0c0a85125e8fe8d9943f7982",
        dtypeByBackend: { webgpu: "q4" }
      }
    });
  });

  it("prefers the pinned WebLLM profile on compatible WebGPU devices", () => {
    const mediumOptions = rankBrowserModelsForDevice({
      capability: capability("medium", "webgpu")
    });
    expect(mediumOptions[0]).toMatchObject({
      compatible: true,
      model: {
        id: "smollm2-360m-instruct-webllm",
        runtimeAdapter: "webllm",
        runtimeAdapterVersion: "0.2.84",
        modelRevision: "3a622fd89e0216e8bb10c410c007c786baa8a033"
      }
    });
  });

  it("derives conservative task budgets from both model and device profiles", () => {
    const model = getBrowserModel("smollm2-135m-instruct-browser");
    expect(model).not.toBeNull();
    expect(browserTaskBudget(model!, capability("low", "wasm"))).toEqual({
      maxInputTokens: 768,
      maxOutputTokens: 64,
      maxWallTimeMs: 45_000,
      maxEstimatedMemoryBytes: 500_000_000,
      continuationAllowed: true
    });
  });

  it("demotes a runtime-model combination that previously failed on the same device", () => {
    const device = capability("low", "wasm");
    const options = rankBrowserModelsForDevice({
      capability: device,
      outcomes: [
        {
          deviceProfileId: "chrome:130:mobile:low:wasm:2",
          modelId: "smollm2-135m-instruct-browser",
          backend: "wasm",
          successful: false,
          loadTimeMs: 500,
          readinessTimeMs: null,
          readinessTokensPerSecond: null,
          failureCode: "OUT_OF_MEMORY",
          updatedAt: "2026-07-29T00:00:00.000Z"
        }
      ]
    });
    expect(
      options.find((option) => option.model.id === "smollm2-135m-instruct-browser")
    ).toMatchObject({
      previousOutcome: { failureCode: "OUT_OF_MEMORY" }
    });
    expect(options[0]?.model.id).toBe("smollm2-360m-instruct-browser");
  });
});
