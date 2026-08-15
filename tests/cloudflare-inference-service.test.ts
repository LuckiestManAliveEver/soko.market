import { describe, expect, it, vi } from "vitest";
import { resolveRuntimeModel } from "../packages/shared-types/src/index";
import {
  createBackendInferenceClient,
  createBackendModelAdapter
} from "../services/api/src/inference/model-runtime";
import { classifyProviderError } from "../services/cloudflare-inference/src/errors";
import worker from "../services/cloudflare-inference/src/index";
import type { Env } from "../services/cloudflare-inference/src/types";

const token = "test-cloudflare-inference-token-32chars-min";
const cloudflareModel = resolveRuntimeModel("cloudflare-backend-default");
if (cloudflareModel === null) throw new Error("cloudflare-backend-default must be registered");

type AiRun = (
  model: string,
  inputs: Record<string, unknown>,
  options?: { signal?: AbortSignal }
) => Promise<unknown>;

function fakeEnv(overrides: { run?: AiRun; token?: string; cloudflareAiModel?: string } = {}): Env {
  const run = overrides.run ?? (async () => ({ response: "SOKO_MODEL_OK" }));
  return {
    AI: { run } as unknown as Env["AI"],
    INFERENCE_SERVICE_TOKEN: overrides.token ?? token,
    ...(overrides.cloudflareAiModel === undefined ? {} : { CLOUDFLARE_AI_MODEL: overrides.cloudflareAiModel })
  };
}

async function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://worker.test${path}`, init), env);
}

const auth = { authorization: `Bearer ${token}` };

describe("Cloudflare inference Worker: authentication", () => {
  it("rejects a missing token", async () => {
    const response = await call(fakeEnv(), "/health/ready");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "INFERENCE_AUTHENTICATION_FAILED" } });
  });

  it("rejects a wrong token", async () => {
    const response = await call(fakeEnv(), "/health/ready", {
      headers: { authorization: "Bearer wrong-token-value-that-is-32-chars" }
    });
    expect(response.status).toBe(401);
  });

  it("allows a valid token", async () => {
    const response = await call(fakeEnv(), "/health/ready", { headers: auth });
    expect(response.status).toBe(200);
  });

  it("fails closed if the Worker itself has no token configured", async () => {
    const response = await call(fakeEnv({ token: "" }), "/health/ready", { headers: auth });
    expect(response.status).toBe(500);
  });
});

describe("Cloudflare inference Worker: health and models", () => {
  it("reports readiness without invoking inference", async () => {
    const run = vi.fn(async () => ({ response: "unused" }));
    const response = await call(fakeEnv({ run }), "/health/ready", { headers: auth });
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; engine: string; models: Array<Record<string, unknown>> }>();
    expect(body).toMatchObject({ ok: true, engine: "cloudflare-workers-ai" });
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cloudflare-backend-default",
          providerModelId: cloudflareModel.providerModelId,
          available: true
        })
      ])
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("serves the same model list on /v1/models", async () => {
    const response = await call(fakeEnv(), "/v1/models", { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, engine: "cloudflare-workers-ai" });
  });
});

describe("Cloudflare inference Worker: input validation", () => {
  it("rejects a missing prompt", async () => {
    const response = await call(fakeEnv(), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelId: "cloudflare-backend-default" })
    });
    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await call(fakeEnv(), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{ not json"
    });
    expect(response.status).toBe(400);
  });

  it("rejects an oversized prompt", async () => {
    const response = await call(fakeEnv(), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        modelId: "cloudflare-backend-default",
        prompt: "x".repeat(32_001)
      })
    });
    expect(response.status).toBe(400);
  });

  it("rejects an unsupported method", async () => {
    const response = await call(fakeEnv(), "/v1/chat/completions", {
      method: "PUT",
      headers: auth
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("rejects a modelId this Worker does not serve", async () => {
    const response = await call(fakeEnv(), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelId: "qwen2.5-0.5b-android", prompt: "hi" })
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "MODEL_NOT_CONFIGURED" } });
  });
});

describe("Cloudflare inference Worker: provider normalization", () => {
  it("returns a successful text generation", async () => {
    const run = vi.fn(async () => ({
      response: "hello from the edge",
      usage: { prompt_tokens: 12, completion_tokens: 4 }
    }));
    const response = await call(fakeEnv({ run }), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelId: "cloudflare-backend-default", prompt: "hi" })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      modelId: "cloudflare-backend-default",
      providerModelId: cloudflareModel.providerModelId,
      engine: "cloudflare-workers-ai",
      text: "hello from the edge",
      usage: { promptTokens: 12, completionTokens: 4 }
    });
  });

  it("rejects an empty provider response", async () => {
    const run = vi.fn(async () => ({ response: "   " }));
    const response = await call(fakeEnv({ run }), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelId: "cloudflare-backend-default", prompt: "hi" })
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INFERENCE_RESPONSE" } });
  });

  it("maps a provider failure to a retryable generation error", async () => {
    const run = vi.fn(async () => {
      throw new Error("internal error calling model");
    });
    const response = await call(fakeEnv({ run }), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelId: "cloudflare-backend-default", prompt: "hi" })
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "INFERENCE_ENGINE_UNREACHABLE", retryable: true }
    });
  });

  it("maps a rate limit failure to a retryable 429", async () => {
    const run = vi.fn(async () => {
      throw new Error("429 Too Many Requests");
    });
    const response = await call(fakeEnv({ run }), "/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ modelId: "cloudflare-backend-default", prompt: "hi" })
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "MODEL_GENERATION_FAILED", retryable: true }
    });
  });

  it("classifies an aborted/timed-out provider call as INFERENCE_TIMEOUT", () => {
    const classified = classifyProviderError(new Error("The operation was aborted"));
    expect(classified).toMatchObject({ status: 504, code: "INFERENCE_TIMEOUT", retryable: true });
  });

  it("requires the exact probe marker", async () => {
    const passing = await call(fakeEnv({ run: async () => ({ response: "SOKO_MODEL_OK" }) }), "/v1/models/cloudflare-backend-default/probe", {
      method: "POST",
      headers: auth
    });
    expect(passing.status).toBe(200);
    expect(await passing.json()).toMatchObject({
      modelId: "cloudflare-backend-default",
      providerModelId: cloudflareModel.providerModelId
    });

    const failing = await call(fakeEnv({ run: async () => ({ response: "not the marker" }) }), "/v1/models/cloudflare-backend-default/probe", {
      method: "POST",
      headers: auth
    });
    expect(failing.status).toBe(422);
    expect(await failing.json()).toMatchObject({ error: { code: "MODEL_PROBE_FAILED" } });
  });

  it("honors a CLOUDFLARE_AI_MODEL override for the underlying provider call", async () => {
    const run = vi.fn(async () => ({ response: "hi" }));
    const response = await call(
      fakeEnv({ run, cloudflareAiModel: "@cf/meta/llama-3.1-8b-instruct" }),
      "/v1/chat/completions",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ modelId: "cloudflare-backend-default", prompt: "hi" })
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ providerModelId: "@cf/meta/llama-3.1-8b-instruct" });
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct",
      expect.any(Object),
      expect.any(Object)
    );
  });
});

describe("Cloudflare inference Worker: contract parity with the Soko API client", () => {
  function workerFetch(env: Env): typeof fetch {
    return ((input: URL | RequestInfo, init?: RequestInit) =>
      worker.fetch(new Request(input as string | URL, init), env)) as typeof fetch;
  }

  it("lets the real backend-inference client drive readiness, probe, and generation end to end", async () => {
    const run: AiRun = async (_model, inputs) => {
      const messages = inputs.messages as Array<{ content: string }>;
      const lastMessage = messages[messages.length - 1]?.content ?? "";
      if (lastMessage.includes("SOKO_MODEL_OK")) return { response: "SOKO_MODEL_OK" };
      return {
        response: JSON.stringify({ type: "response", message: "hello from the edge" }),
        usage: { prompt_tokens: 20, completion_tokens: 6 }
      };
    };
    const env = fakeEnv({ run });
    const client = createBackendInferenceClient({
      baseUrl: new URL("https://worker.test"),
      serviceToken: token,
      connectTimeoutMs: 2_000,
      timeoutMs: 5_000,
      request: workerFetch(env)
    });

    const readiness = await client.getReadiness();
    expect(readiness).toMatchObject({ ok: true, engine: "cloudflare-workers-ai" });

    const probe = await client.probeModel("cloudflare-backend-default");
    expect(probe).toMatchObject({
      ok: true,
      modelId: "cloudflare-backend-default",
      providerModelId: cloudflareModel.providerModelId
    });

    const completion = await client.generate({
      modelId: "cloudflare-backend-default",
      prompt: "Reply with the word market",
      maxTokens: 64,
      temperature: 0.2,
      jsonOutput: true
    });
    expect(completion).toMatchObject({
      ok: true,
      modelId: "cloudflare-backend-default",
      providerModelId: cloudflareModel.providerModelId,
      engine: "cloudflare-workers-ai",
      usage: { promptTokens: 20, completionTokens: 6 }
    });
    expect(JSON.parse(completion.text)).toEqual({ type: "response", message: "hello from the edge" });
  });

  it("lets the ModelRuntimeAdapter used by services/api/src/index.ts complete a full turn", async () => {
    const run: AiRun = async () => ({
      response: JSON.stringify({ type: "response", message: "market" }),
      usage: { prompt_tokens: 9, completion_tokens: 2 }
    });
    const env = fakeEnv({ run });
    const adapter = createBackendModelAdapter({
      baseUrl: "https://worker.test",
      modelId: "cloudflare-backend-default",
      serviceToken: token,
      connectTimeoutMs: 2_000,
      timeoutMs: 5_000,
      fetch: workerFetch(env)
    });
    const context = { agentId: "agent", shopId: "shop", modelId: "cloudflare-backend-default" };

    expect(await adapter.canRun(context)).toMatchObject({ available: true });

    const result = await adapter.generate({
      context,
      prompt: {
        message: "hello",
        allowedTools: [],
        schemaVersion: "cp11-runtime-model-v1"
      }
    });
    expect(result).toMatchObject({
      modelId: "cloudflare-backend-default",
      provider: "cloudflare-workers-ai",
      providerModelId: cloudflareModel.providerModelId
    });
    expect(JSON.parse(result.text)).toEqual({ type: "response", message: "market" });
  });
});
