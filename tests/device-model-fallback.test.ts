import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeModelProvider } from "../packages/shared-types/src";
import { assignmentFromServer } from "../apps/web/src/agent-model-assignment";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("device model fallback", () => {
  it("upgrades legacy cloud-only assignments back to local-first model selection", () => {
    const local = assignmentFromServer({
      agentId: "shop-a",
      businessId: "shop-a",
      accountId: "account-a",
      userId: "user-a",
      deviceId: "device-b",
      activeModelInstallationId: null,
      modelId: "openai-fast",
      preferredExecutionMode: "CLOUD_ONLY",
      readinessStatus: "READY",
      runtimeBackend: "CLOUD",
      lastSuccessfulInferenceAt: null,
      lastErrorCode: null,
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedBy: "user-a"
    });

    expect(local).toMatchObject({
      activeModelInstallationId: null,
      modelId: null,
      preferredExecutionMode: "LOCAL_FIRST",
      readinessStatus: "ATTACHED",
      runtimeBackend: null,
      lastErrorCode: "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE"
    });
  });

  it("uses an explicitly selected hosted adapter without a local prerequisite and ignores per-turn model spoofing", async () => {
    vi.stubEnv("INFERENCE_CLOUD_PROVIDER", "openai");
    vi.stubEnv("INFERENCE_CLOUD_MODEL_ALLOWLIST", "openai-fast,openai-reasoning");
    vi.stubEnv("OPENAI_API_KEY", "test-server-key");

    const { createCp2Store } = await import("../services/api/src/cp2/store");
    const resolvedModelIds: string[] = [];
    const cloudProvider: RuntimeModelProvider = {
      name: "openai",
      async complete() {
        return {
          provider: "openai",
          status: "available",
          outputText: JSON.stringify({
            type: "response",
            message: "Cloud fallback handled the request."
          }),
          durationMs: 1,
          errorCode: null,
          metadata: {}
        };
      }
    };
    const store = createCp2Store({
      runtimeModelProviderResolver(modelId) {
        resolvedModelIds.push(modelId);
        return modelId === "openai-fast" ? cloudProvider : undefined;
      }
    });
    const auth = store.signupWithPhonePin({ destination: "+254700799991", pin: "2468" });
    const created = store.createBusiness({
      sessionId: auth.session.id,
      name: "Cross Device Shop",
      language: "en"
    });
    store.activateAiModel({
      sessionId: auth.session.id,
      businessId: created.business.id,
      modelId: "openai-fast"
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
      readinessStatus: "READY",
      lastSuccessfulInferenceAt: "2026-07-21T00:01:00.000Z",
      lastErrorCode: null
    });
    store.activateAiModel({
      sessionId: auth.session.id,
      businessId: created.business.id,
      modelId: "openai-fast"
    });
    expect(
      store.updateAgentProfile({
        sessionId: auth.session.id,
        businessId: created.business.id,
        profile: {
          name: "Cross Device Agent",
          description: "Local-first shop agent",
          modelId: "openai-fast",
          role: "Business assistant",
          language: "en",
          personality: "Careful",
          instructions: "Use the downloaded model first when it is available.",
          knowledge: "Use saved shop records.",
          tools: [],
          integrations: [],
          contextScripts: [],
          status: "active"
        }
      }).modelId
    ).toBe("openai-fast");

    const deviceB = store.getAgentModelAssignment({
      sessionId: auth.session.id,
      businessId: created.business.id,
      deviceId: "device-b"
    });

    expect(deviceB).toMatchObject({
      deviceId: "device-b",
      activeModelInstallationId: null,
      modelId: "qwen2.5-0.5b-android",
      preferredExecutionMode: "LOCAL_FIRST",
      readinessStatus: "ATTACHED",
      runtimeBackend: null,
      lastErrorCode: "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE"
    });
    expect(
      store.getActiveAiModel({
        sessionId: auth.session.id,
        businessId: created.business.id
      }).modelId
    ).toBe("openai-fast");

    const turn = await store.createRuntimeTurn({
      sessionId: auth.session.id,
      businessId: created.business.id,
      message: "Summarize my shop.",
      agentProfile: {
        behavior: "Concise",
        contextScripts: [],
        integrations: [],
        knowledge: "Use saved shop records.",
        model: "openai-fast",
        role: "Business assistant",
        instructions: "Help with shop operations.",
        tools: []
      }
    });
    expect(resolvedModelIds).toContain("openai-fast");
    expect(turn.turn).toMatchObject({
      model: { provider: "openai", status: "available" },
      response: "Cloud fallback handled the request."
    });

    resolvedModelIds.length = 0;
    const spoofedLocalSelection = await store.createRuntimeTurn({
      sessionId: auth.session.id,
      businessId: created.business.id,
      message: "Keep this request on Soko.",
      agentProfile: {
        behavior: "Concise",
        contextScripts: [],
        integrations: [],
        knowledge: "Use saved shop records.",
        model: "sokoclaw-local",
        role: "Business assistant",
        instructions: "Help with shop operations.",
        tools: []
      }
    });
    expect(resolvedModelIds).toEqual(["openai-fast"]);
    expect(spoofedLocalSelection.turn.model).toMatchObject({
      provider: "openai",
      status: "available"
    });
  }, 15_000);
});
