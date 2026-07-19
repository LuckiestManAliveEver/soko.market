import { describe, expect, it } from "vitest";
import { classifyBrowserInferenceCapability } from "../apps/web/src/browser-inference-capability";

const base = {
  wasm: true,
  indexedDb: true,
  worker: true,
  workerInitialized: true,
  crossOriginIsolated: true,
  logicalProcessors: 8,
  availableStorageBytes: 2_000_000_000,
  persistentStorage: true,
  installedPwa: true,
  userAgent: "Mozilla/5.0 Chrome/130.0.0.0"
};

describe("browser inference capability", () => {
  it("prefers WebGPU and classifies a capable desktop conservatively", () => {
    const capability = classifyBrowserInferenceCapability({
      ...base,
      webGpu: true,
      deviceMemoryGb: 8
    });

    expect(capability).toMatchObject({
      supported: true,
      backend: "webgpu",
      deviceTier: "high",
      maxRecommendedContextTokens: 2_048,
      recommendedModelId: "smollm2-360m-instruct-browser"
    });
  });

  it("uses WASM fallback without claiming WebGPU", () => {
    const capability = classifyBrowserInferenceCapability({
      ...base,
      webGpu: false,
      crossOriginIsolated: false,
      deviceMemoryGb: 4,
      logicalProcessors: 4
    });

    expect(capability.backend).toBe("wasm");
    expect(capability.deviceTier).toBe("medium");
    expect(capability.reasons.join(" ")).toContain("WebGPU is unavailable");
  });

  it.each([
    ["no WASM", { wasm: false }],
    ["no IndexedDB", { indexedDb: false }],
    ["worker crash", { workerInitialized: false }],
    ["insufficient storage", { availableStorageBytes: 100_000_000 }]
  ])("fails safely for %s", (_label, override) => {
    const capability = classifyBrowserInferenceCapability({
      ...base,
      webGpu: false,
      deviceMemoryGb: 2,
      ...override
    });

    expect(capability.supported).toBe(false);
    expect(capability.backend).toBe("none");
    expect(capability.maxRecommendedContextTokens).toBe(1_024);
  });
});
