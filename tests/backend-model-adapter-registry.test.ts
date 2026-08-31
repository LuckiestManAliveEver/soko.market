import { describe, expect, it } from "vitest";

import { runtimeModels } from "../packages/shared-types/src";
import { createBackendModelAdapterRegistry } from "../services/api/src/inference/model-runtime";

const SMOLLM_ID = "smollm2-360m";
const QWEN_ID = "qwen2.5-0.5b-android";

function fakeGatewayFetch(installedModelIds: Set<string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.pathname === "/health/ready") {
      const models = Object.values(runtimeModels).map((model) => ({
        id: model.id,
        providerModelId: model.providerModelId,
        available: model.enabled && installedModelIds.has(model.id),
        digest: null
      }));
      return jsonResponse(200, { ok: true, engine: "ollama", models });
    }
    return jsonResponse(404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "unhandled path in test fake", retryable: false }
    });
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("createBackendModelAdapterRegistry", () => {
  it("registers one adapter per enabled Ollama-backed canonical model, not just the primary", () => {
    const registry = createBackendModelAdapterRegistry({
      baseUrl: "http://127.0.0.1:4002",
      serviceToken: "a".repeat(32),
      connectTimeoutMs: 1_000,
      timeoutMs: 1_000,
      primaryModelId: SMOLLM_ID,
      fetch: fakeGatewayFetch(new Set([SMOLLM_ID]))
    });

    // Every enabled ollama model is registered, so activating any of them for an agent needs no
    // adapter/code change - only that model actually installed on the gateway.
    expect(registry.adapters.get(`backend:${SMOLLM_ID}`)).toBeDefined();
    expect(registry.adapters.get(`backend:${QWEN_ID}`)).toBeDefined();
    expect(registry.primaryAdapter).toBe(registry.adapters.get(`backend:${SMOLLM_ID}`));

    // Disabled canonical entries (qwen2.5-1.5b-android, the legacy smollm2-360m-android id) never
    // get a live adapter - swappability only extends to models the deployment actually enabled.
    expect(registry.adapters.has("backend:qwen2.5-1.5b-android")).toBe(false);
    expect(registry.adapters.has("backend:smollm2-360m-android")).toBe(false);
  });

  it("swaps which model is primary purely from configuration, with both adapters independently live", async () => {
    const installed = new Set([SMOLLM_ID, QWEN_ID]);
    const registry = createBackendModelAdapterRegistry({
      baseUrl: "http://127.0.0.1:4002",
      serviceToken: "a".repeat(32),
      connectTimeoutMs: 1_000,
      timeoutMs: 1_000,
      primaryModelId: QWEN_ID,
      fetch: fakeGatewayFetch(installed)
    });

    expect(registry.primaryAdapter).toBe(registry.adapters.get(`backend:${QWEN_ID}`));

    const smollmAdapter = registry.adapters.get(`backend:${SMOLLM_ID}`);
    const qwenAdapter = registry.adapters.get(`backend:${QWEN_ID}`);
    const smollmRun = await smollmAdapter?.canRun({
      agentId: "agent",
      shopId: "shop",
      modelId: SMOLLM_ID
    });
    const qwenRun = await qwenAdapter?.canRun({
      agentId: "agent",
      shopId: "shop",
      modelId: QWEN_ID
    });
    expect(smollmRun?.available).toBe(true);
    expect(qwenRun?.available).toBe(true);
  });

  it("reports a model as unavailable to swap to until the gateway actually has it installed", async () => {
    const registry = createBackendModelAdapterRegistry({
      baseUrl: "http://127.0.0.1:4002",
      serviceToken: "a".repeat(32),
      connectTimeoutMs: 1_000,
      timeoutMs: 1_000,
      primaryModelId: SMOLLM_ID,
      fetch: fakeGatewayFetch(new Set([SMOLLM_ID]))
    });

    const qwenAdapter = registry.adapters.get(`backend:${QWEN_ID}`);
    const qwenRun = await qwenAdapter?.canRun({
      agentId: "agent",
      shopId: "shop",
      modelId: QWEN_ID
    });
    expect(qwenRun).toMatchObject({ available: false, errorCode: "MODEL_NOT_INSTALLED" });
  });
});
