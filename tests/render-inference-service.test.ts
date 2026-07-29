import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiRuntime } from "../services/ai-runtime/src/app";
import {
  createOllamaInferenceEngine,
  InferenceEngineError,
  type InferenceEngine
} from "../services/ai-runtime/src/inference-engine";
import { readInferenceServiceConfig } from "../services/ai-runtime/src/runtime-config";
import { readEnvironment } from "../services/api/src/config";

const token = "test-inference-token-that-is-at-least-32-characters";

function config(overrides = {}) {
  return {
    host: "0.0.0.0",
    port: 4002,
    engine: "ollama" as const,
    engineBaseUrl: "http://127.0.0.1:11434",
    serviceToken: token,
    primaryModelId: "qwen2.5-0.5b-android",
    requestTimeoutMs: 5_000,
    maximumInputCharacters: 32_000,
    maximumOutputTokens: 512,
    modelStoragePath: "/var/lib/soko-models",
    durableModelStorage: true,
    production: true,
    ...overrides
  };
}

function engine(overrides: Partial<InferenceEngine> = {}): InferenceEngine {
  return {
    name: "ollama",
    listModels: vi.fn(async () => [
      {
        name: "qwen2.5:0.5b",
        digest: "sha256:model",
        sizeBytes: 400_000_000
      }
    ]),
    generate: vi.fn(async () => ({
      providerModelId: "qwen2.5:0.5b",
      text: "SOKO_MODEL_OK",
      promptTokens: 5,
      completionTokens: 3,
      finishReason: "stop"
    })),
    ...overrides
  };
}

const auth = { authorization: `Bearer ${token}` };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Render private inference service", () => {
  it("keeps liveness lightweight and protects all readiness and inference routes", async () => {
    const runtimeEngine = engine();
    const app = buildAiRuntime({ config: config(), engine: runtimeEngine });

    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/health/ready",
          headers: { authorization: "Bearer wrong" }
        })
      ).statusCode
    ).toBe(401);
    const readiness = await app.inject({
      method: "GET",
      url: "/health/ready",
      headers: auth
    });
    expect(readiness.statusCode).toBe(200);
    const readinessBody = readiness.json<{
      ok: boolean;
      engine: string;
      models: Array<Record<string, unknown>>;
    }>();
    expect(readinessBody).toMatchObject({
      ok: true,
      engine: "ollama"
    });
    expect(readinessBody.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qwen2.5-0.5b-android",
          providerModelId: "qwen2.5:0.5b",
          available: true
        })
      ])
    );
    expect(runtimeEngine.generate).not.toHaveBeenCalled();
    await app.close();
  });

  it("reports unreachable engines, missing models, and non-durable production storage", async () => {
    for (const [runtimeEngine, runtimeConfig, code] of [
      [
        engine({
          listModels: vi.fn(async () => {
            throw new InferenceEngineError(
              "INFERENCE_ENGINE_UNREACHABLE",
              "engine unavailable",
              true
            );
          })
        }),
        config(),
        "INFERENCE_ENGINE_UNREACHABLE"
      ],
      [engine({ listModels: vi.fn(async () => []) }), config(), "MODEL_NOT_INSTALLED"],
      [engine(), config({ durableModelStorage: false }), "MODEL_STORAGE_NOT_DURABLE"]
    ] as const) {
      const app = buildAiRuntime({ config: runtimeConfig, engine: runtimeEngine });
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
        headers: auth
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code } });
      await app.close();
    }
  });

  it("maps the Soko model ID and requires a real probe marker", async () => {
    const generate = vi
      .fn<InferenceEngine["generate"]>()
      .mockResolvedValueOnce({
        providerModelId: "qwen2.5:0.5b",
        text: "SOKO_MODEL_OK",
        promptTokens: 5,
        completionTokens: 3,
        finishReason: "stop"
      })
      .mockResolvedValueOnce({
        providerModelId: "qwen2.5:0.5b",
        text: "not the marker",
        promptTokens: 5,
        completionTokens: 3,
        finishReason: "stop"
      });
    const app = buildAiRuntime({ config: config(), engine: engine({ generate }) });

    const passed = await app.inject({
      method: "POST",
      url: "/v1/models/qwen2.5-0.5b-android/probe",
      headers: auth
    });
    expect(passed.statusCode).toBe(200);
    expect(passed.json()).toMatchObject({
      modelId: "qwen2.5-0.5b-android",
      providerModelId: "qwen2.5:0.5b"
    });
    expect(generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        providerModelId: "qwen2.5:0.5b",
        prompt: "Reply with exactly: SOKO_MODEL_OK"
      })
    );

    const failed = await app.inject({
      method: "POST",
      url: "/v1/models/qwen2.5-0.5b-android/probe",
      headers: auth
    });
    expect(failed.statusCode).toBe(422);
    expect(failed.json()).toMatchObject({ error: { code: "MODEL_PROBE_FAILED" } });
    await app.close();
  });

  it("enforces generation limits and returns structured engine failures", async () => {
    const generate = vi
      .fn<InferenceEngine["generate"]>()
      .mockRejectedValue(new InferenceEngineError("INFERENCE_TIMEOUT", "engine timed out", true));
    const app = buildAiRuntime({
      config: config({ maximumInputCharacters: 10 }),
      engine: engine({ generate })
    });

    const limited = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: auth,
      payload: {
        modelId: "qwen2.5-0.5b-android",
        prompt: "this prompt is too long",
        maxTokens: 20
      }
    });
    expect(limited.statusCode).toBe(400);
    expect(limited.json()).toMatchObject({ error: { code: "INPUT_LIMIT_EXCEEDED" } });

    const timedOut = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: auth,
      payload: {
        modelId: "qwen2.5-0.5b-android",
        prompt: "short",
        maxTokens: 20
      }
    });
    expect(timedOut.statusCode).toBe(504);
    expect(timedOut.json()).toMatchObject({
      error: { code: "INFERENCE_TIMEOUT", retryable: true }
    });
    await app.close();
  });

  it("rejects malformed Ollama generation output", async () => {
    const runtimeEngine = createOllamaInferenceEngine({
      baseUrl: "http://127.0.0.1:11434",
      timeoutMs: 1_000,
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ model: "qwen2.5:0.5b", response: "" }), {
            status: 200
          })
      )
    });

    await expect(
      runtimeEngine.generate({
        providerModelId: "qwen2.5:0.5b",
        prompt: "hello",
        maximumOutputTokens: 16,
        temperature: 0,
        jsonOutput: false
      })
    ).rejects.toMatchObject({ code: "INVALID_INFERENCE_RESPONSE" });
  });
});

describe("Render inference configuration", () => {
  it("validates the canonical provider mapping and persistent production configuration", () => {
    expect(
      readInferenceServiceConfig({
        NODE_ENV: "production",
        INFERENCE_SERVICE_TOKEN: token,
        SOKO_PRIMARY_MODEL_ID: "qwen2.5-0.5b-android",
        SOKO_PRIMARY_PROVIDER_MODEL_ID: "qwen2.5:0.5b",
        MODEL_STORAGE_DURABLE: "true"
      })
    ).toMatchObject({
      primaryModelId: "qwen2.5-0.5b-android",
      durableModelStorage: true
    });
    expect(() =>
      readInferenceServiceConfig({
        INFERENCE_SERVICE_TOKEN: token,
        SOKO_PRIMARY_PROVIDER_MODEL_ID: "qwen2.5-0.5b-android"
      })
    ).toThrow(/canonical Soko runtime model mapping/u);
  });

  it("rejects enabled API inference without a token and rejects Render loopback URLs", () => {
    vi.stubEnv("BACKEND_INFERENCE_ENABLED", "true");
    vi.stubEnv("BACKEND_INFERENCE_BASE_URL", "soko-inference:4002");
    vi.stubEnv("INFERENCE_SERVICE_TOKEN", "");
    expect(() => readEnvironment()).toThrow(/INFERENCE_SERVICE_TOKEN/u);

    vi.stubEnv("INFERENCE_SERVICE_TOKEN", token);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RENDER_SERVICE_ID", "srv-api");
    vi.stubEnv("BACKEND_INFERENCE_BASE_URL", "http://127.0.0.1:11434");
    expect(() => readEnvironment()).toThrow(/cannot use loopback/u);
  });

  it("requires a gateway URL only when inference is enabled", () => {
    vi.stubEnv("BACKEND_INFERENCE_ENABLED", "false");
    vi.stubEnv("BACKEND_INFERENCE_BASE_URL", "");
    vi.stubEnv("INFERENCE_SERVICE_TOKEN", "");
    expect(readEnvironment()).toMatchObject({
      backendInferenceEnabled: false,
      backendInferenceBaseUrl: "",
      inferenceServiceToken: ""
    });

    vi.stubEnv("BACKEND_INFERENCE_ENABLED", "true");
    vi.stubEnv("INFERENCE_SERVICE_TOKEN", token);
    expect(() => readEnvironment()).toThrow(/BACKEND_INFERENCE_BASE_URL/u);
  });
});
