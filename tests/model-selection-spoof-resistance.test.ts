import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeModelProvider } from "../packages/shared-types/src";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("model selection spoof resistance", () => {
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
