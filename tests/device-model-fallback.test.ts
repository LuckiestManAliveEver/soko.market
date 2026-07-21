import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignmentWithCloudFallback,
  isDeviceCloudFallbackAssignment,
  type DeviceAgentModelAssignment
} from "../apps/web/src/agent-model-assignment";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("device model fallback", () => {
  it("converts a missing local installation into a device-only cloud assignment", () => {
    const local: DeviceAgentModelAssignment = {
      agentId: "shop-a",
      businessId: "shop-a",
      deviceId: "device-b",
      activeModelInstallationId: "qwen-device-a",
      modelId: "qwen2.5-0.5b-android",
      preferredExecutionMode: "LOCAL_FIRST",
      fallbackPolicy: "WHEN_LOCAL_FAILS",
      readinessStatus: "FAILED",
      runtimeBackend: "LLAMA_CPP_ANDROID",
      lastSuccessfulInferenceAt: null,
      lastErrorCode: "MODEL_FILE_MISSING",
      updatedAt: "2026-07-21T00:00:00.000Z"
    };

    const fallback = assignmentWithCloudFallback(local, "openai-fast", "2026-07-21T01:00:00.000Z");

    expect(fallback).toMatchObject({
      activeModelInstallationId: null,
      modelId: "openai-fast",
      preferredExecutionMode: "CLOUD_ONLY",
      fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
      readinessStatus: "READY",
      runtimeBackend: "CLOUD",
      lastErrorCode: "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE"
    });
    expect(isDeviceCloudFallbackAssignment(fallback)).toBe(true);
  });

  it("selects the configured cloud default on another device without changing the local preference", async () => {
    vi.stubEnv("INFERENCE_CLOUD_FALLBACK_ENABLED", "true");
    vi.stubEnv("INFERENCE_CLOUD_PROVIDER", "openai");
    vi.stubEnv("INFERENCE_CLOUD_MODEL_ALLOWLIST", "openai-fast,openai-reasoning");
    vi.stubEnv("INFERENCE_DEFAULT_CLOUD_MODEL_ID", "openai-fast");
    vi.stubEnv("OPENAI_API_KEY", "test-server-key");

    const { createCp2Store } = await import("../services/api/src/cp2/store");
    const store = createCp2Store();
    const auth = store.signupWithPhonePin({ destination: "+254700799991", pin: "2468" });
    const created = store.createBusiness({
      sessionId: auth.session.id,
      name: "Cross Device Shop",
      language: "en"
    });
    store.registerInstalledAgentModel({
      sessionId: auth.session.id,
      model: {
        id: "device-a-qwen",
        deviceId: "device-a",
        modelId: "qwen2.5-0.5b-android",
        displayName: "Qwen device A",
        provider: "huggingface",
        repositoryId: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        filename: "qwen.gguf",
        format: "GGUF",
        quantization: "Q4_K_M",
        architecture: "qwen2",
        parameterCount: 500_000_000,
        contextLength: 2_048,
        fileSizeBytes: 491_000_000,
        checksum: null,
        license: "Apache-2.0",
        commercialUseAllowed: true,
        storageKey: "qwen.gguf",
        runtimeBackend: "LLAMA_CPP_ANDROID",
        installationStatus: "INSTALLED",
        compatibilityStatus: "COMPATIBLE",
        installedAt: "2026-07-21T00:00:00.000Z",
        lastVerifiedAt: "2026-07-21T00:00:00.000Z",
        validationError: null
      }
    });
    store.assignAgentModel({
      sessionId: auth.session.id,
      businessId: created.business.id,
      deviceId: "device-a",
      installationId: "device-a-qwen",
      preferredExecutionMode: "LOCAL_FIRST",
      fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
      readinessStatus: "READY",
      lastSuccessfulInferenceAt: "2026-07-21T00:01:00.000Z",
      lastErrorCode: null
    });

    const deviceB = store.getAgentModelAssignment({
      sessionId: auth.session.id,
      businessId: created.business.id,
      deviceId: "device-b"
    });

    expect(deviceB).toMatchObject({
      deviceId: "device-b",
      activeModelInstallationId: null,
      modelId: "openai-fast",
      preferredExecutionMode: "CLOUD_ONLY",
      runtimeBackend: "CLOUD",
      lastErrorCode: "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE"
    });
    expect(
      store.getActiveAiModel({
        sessionId: auth.session.id,
        businessId: created.business.id
      }).modelId
    ).toBe("qwen2.5-0.5b-android");
  }, 15_000);
});
