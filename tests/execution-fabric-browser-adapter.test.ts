import { describe, expect, it } from "vitest";
import type { InferenceChunk, InferenceProvider, InferenceRequest } from "../packages/shared-types/src";
import type { ModelPreferenceCandidate } from "../packages/execution-planner/src";
import { createBrowserRuntimeAdapter } from "../apps/web/src/execution-fabric/browser-runtime-adapter";
import { planBrowserExecution, planBrowserExecutionRoute } from "../apps/web/src/execution-fabric/client-planner";
import type { LocalAiModel } from "../apps/web/src/ai-model-manager";

const installedModelId = "smollm2-360m-android";

function preference(overrides: Partial<ModelPreferenceCandidate> = {}): ModelPreferenceCandidate {
  return {
    scope: "system",
    preferredModelIds: [installedModelId],
    fallbackModelIds: [],
    requiredCapabilities: [],
    executionPreference: "local-first",
    qualityPreference: "balanced",
    allowCloudFallback: false,
    maxCostPerRequest: null,
    maxLatencyMs: null,
    minimumContextWindow: null,
    ...overrides
  };
}

function installedLocalModel(overrides: Partial<LocalAiModel> = {}): LocalAiModel {
  return {
    id: "installation-1",
    modelId: installedModelId,
    label: "SmolLM2 360M offline starter",
    displayName: "SmolLM2 360M offline starter",
    provider: "huggingface",
    repositoryId: "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF",
    fileName: "smollm2-360m-instruct-q8_0.gguf",
    storageKey: "smollm2-360m",
    format: "GGUF",
    quantization: "Q8_0",
    architecture: "llama",
    parameterCount: 360_000_000,
    contextLength: 8_192,
    fileSizeBytes: 386_000_000,
    checksum: null,
    license: "Apache-2.0",
    commercialUseAllowed: true,
    runtimeBackend: "LLAMA_CPP_BROWSER",
    installationStatus: "INSTALLED",
    compatibilityStatus: "COMPATIBLE",
    deviceId: "device-1",
    storedAt: new Date(0).toISOString(),
    installedAt: new Date(0).toISOString(),
    lastVerifiedAt: null,
    validationError: null,
    ...overrides
  };
}

function inferenceRequest(): InferenceRequest {
  return {
    requestId: "req-1",
    tenantId: "business-1",
    conversationId: "conversation-1",
    agentId: "business-1",
    modelId: installedModelId,
    messages: [{ role: "user", content: "hello" }]
  };
}

/** A minimal fake standing in for the real inline browser-webgpu/browser-wasm InferenceProvider
 *  built in apps/web/src/hooks/useChatRuntimeState.ts (which itself wraps
 *  generateBrowserAgentResponse) - this proves the RuntimeAdapter wrapper genuinely delegates to
 *  whatever InferenceProvider it is given, end to end, without knowing or caring what backs it. */
function fakeBrowserProvider(chunks: InferenceChunk[]): InferenceProvider {
  return {
    id: "browser-wasm",
    runtime: "browser-wasm",
    async isAvailable() {
      return true;
    },
    async supports(modelId) {
      return modelId === installedModelId;
    },
    async *generate() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

describe("execution fabric - browser-local planning and RuntimeAdapter", () => {
  it("plans a local candidate when the preferred model is installed and compatible on this device", () => {
    const plan = planBrowserExecution({
      installedModels: [installedLocalModel()],
      preference: preference()
    });
    expect(plan.selected).toMatchObject({ modelId: installedModelId, executionTarget: "local" });
  });

  it("plans no candidate when the preferred model is not installed on this device", () => {
    const plan = planBrowserExecution({
      installedModels: [],
      preference: preference()
    });
    expect(plan.selected).toBeNull();
  });

  it("plans no candidate when the installed model failed compatibility checks", () => {
    const plan = planBrowserExecution({
      installedModels: [installedLocalModel({ compatibilityStatus: "INCOMPATIBLE" })],
      preference: preference()
    });
    expect(plan.selected).toBeNull();
  });

  it("the RuntimeAdapter's canExecute agrees with the plan and the provider's own availability/support", async () => {
    const plan = planBrowserExecution({
      installedModels: [installedLocalModel()],
      preference: preference()
    });
    const adapter = createBrowserRuntimeAdapter(fakeBrowserProvider([]));
    expect(await adapter.canExecute(plan)).toBe(true);

    const unavailableProvider = fakeBrowserProvider([]);
    unavailableProvider.isAvailable = async () => false;
    const unavailableAdapter = createBrowserRuntimeAdapter(unavailableProvider);
    expect(await unavailableAdapter.canExecute(plan)).toBe(false);
  });

  it("canExecute is false when the plan has no selected candidate at all", async () => {
    const emptyPlan = planBrowserExecution({ installedModels: [], preference: preference() });
    const adapter = createBrowserRuntimeAdapter(fakeBrowserProvider([]));
    expect(await adapter.canExecute(emptyPlan)).toBe(false);
  });

  it("executes end to end - the planner selects, and the adapter streams real RuntimeEvents (InferenceChunk) from the wrapped provider", async () => {
    const plan = planBrowserExecution({
      installedModels: [installedLocalModel()],
      preference: preference()
    });
    const expectedChunks: InferenceChunk[] = [
      { requestId: "req-1", text: "mar", done: false, runtime: "browser-wasm", modelId: installedModelId },
      { requestId: "req-1", text: "ket", done: true, runtime: "browser-wasm", modelId: installedModelId }
    ];
    const adapter = createBrowserRuntimeAdapter(fakeBrowserProvider(expectedChunks));

    const received: InferenceChunk[] = [];
    for await (const event of adapter.execute(plan, inferenceRequest())) {
      received.push(event);
    }
    expect(received).toEqual(expectedChunks);
  });

  it("weights still change which locally-installed candidate wins, same as the server-side determinism requirement", () => {
    const secondModelId = "qwen2.5-0.5b-android";
    const bothInstalled = [
      installedLocalModel({ id: "a", modelId: installedModelId }),
      installedLocalModel({ id: "b", modelId: secondModelId })
    ];
    const preferSecond = preference({
      preferredModelIds: [secondModelId, installedModelId]
    });
    const plan = planBrowserExecution({ installedModels: bothInstalled, preference: preferSecond });
    expect(plan.selected?.modelId).toBe(secondModelId);
  });
});

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §8). `planBrowserExecutionRoute` is
 * the exact pure function `apps/web/src/hooks/useChatRuntimeState.ts` calls (behind the
 * `executionFabricEnabled` client flag) instead of `decideClientInferenceRoute` - these tests are
 * what let that one-line call site be trusted without a live browser render, since this function's
 * every branch is exercised here directly.
 */
describe("execution fabric - planBrowserExecutionRoute (the useChatRuntimeState integration point)", () => {
  function fakeProvider(runtime: "browser-webgpu" | "browser-wasm", id = runtime): InferenceProvider {
    return {
      id,
      runtime,
      async isAvailable() {
        return true;
      },
      async supports() {
        return true;
      },
      async *generate() {}
    };
  }

  it("returns null when no local model has ever been selected on this device", () => {
    const route = planBrowserExecutionRoute({
      installedModels: [installedLocalModel()],
      preferredModelId: null,
      providers: [fakeProvider("browser-wasm")]
    });
    expect(route).toBeNull();
  });

  it("returns null when the preferred model is not actually installed/compatible", () => {
    const route = planBrowserExecutionRoute({
      installedModels: [],
      preferredModelId: installedModelId,
      providers: [fakeProvider("browser-wasm")]
    });
    expect(route).toBeNull();
  });

  it("returns null when the plan would select local but no browser provider exists in the given list", () => {
    const route = planBrowserExecutionRoute({
      installedModels: [installedLocalModel()],
      preferredModelId: installedModelId,
      providers: [{ id: "native-llama-cpp", runtime: "native-llama-cpp", async isAvailable() { return true; }, async supports() { return true; }, async *generate() {} }]
    });
    expect(route).toBeNull();
  });

  it("builds a real InferenceRouteDecision matching the planner's selected model and the matching provider's id/runtime", () => {
    const provider = fakeProvider("browser-webgpu", "browser-webgpu");
    const route = planBrowserExecutionRoute({
      installedModels: [installedLocalModel()],
      preferredModelId: installedModelId,
      providers: [provider]
    });
    expect(route).toMatchObject({
      providerId: "browser-webgpu",
      runtime: "browser-webgpu",
      modelId: installedModelId,
      fallbackProviderIds: []
    });
  });
});
