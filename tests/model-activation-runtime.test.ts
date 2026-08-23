import { describe, expect, it, vi } from "vitest";
import type {
  AgentModelActivationResult,
  AgentModelBindingSummary,
  ModelExecutionTarget,
  RuntimeModelPrompt
} from "../packages/shared-types/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import {
  createBackendModelAdapter,
  ModelRuntimeError,
  type ModelRuntimeAdapter
} from "../services/api/src/inference/model-runtime";

const primaryModelId = "qwen2.5-0.5b-android";
const replacementModelId = "qwen2.5-1.5b-android";

describe("agent model activation runtime", () => {
  it("tests real adapter output, activates a canonical binding, and survives hydration", async () => {
    const adapter = healthyAdapter(primaryModelId);
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === primaryModelId && executionTarget === "backend" ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700002001", "Kwa Jane");

    const test = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/models/${primaryModelId}/test`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ shopId: owner.businessId, executionTarget: "backend" })
    });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({
      healthCheck: {
        ok: true,
        modelId: primaryModelId,
        executionTarget: "backend",
        responsePreview: "SOKO_MODEL_OK"
      }
    });

    const activation = await activate(app, owner, primaryModelId);
    expect(activation.binding).toMatchObject({
      agentId: owner.businessId,
      shopId: owner.businessId,
      modelId: primaryModelId,
      status: "active",
      executionTarget: "backend",
      lastVerificationStatus: "passed"
    });
    expect(activation.healthCheck.ok).toBe(true);

    const restoredStore = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === primaryModelId && executionTarget === "backend" ? adapter : undefined
    });
    restoredStore.hydrateSnapshot(store.snapshot());
    const restoredApp = buildApi({ cp2: { store: restoredStore } });
    const restored = await getBinding(restoredApp, owner);
    expect(restored).toMatchObject({
      id: activation.binding.id,
      modelId: primaryModelId,
      status: "active"
    });

    await app.close();
    await restoredApp.close();
  });

  it("keeps the previous active model when a replacement health check fails", async () => {
    const first = healthyAdapter(primaryModelId);
    const failing = healthyAdapter(replacementModelId, { healthOk: false });
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId ? first : modelId === replacementModelId ? failing : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700002002", "Replacement Shop");
    const original = await activate(app, owner, primaryModelId);

    const replacement = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/models/${replacementModelId}/activate`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify(activationPayload(owner.businessId))
    });
    expect(replacement.statusCode).toBe(422);
    expect(replacement.json()).toMatchObject({
      code: "MODEL_HEALTH_CHECK_FAILED",
      retryable: true
    });
    expect(await getBinding(app, owner)).toMatchObject({
      id: original.binding.id,
      modelId: primaryModelId,
      status: "active"
    });

    await app.close();
  });

  it("is idempotent, switches one active binding, and persists removal across hydration", async () => {
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId || modelId === replacementModelId
          ? healthyAdapter(modelId)
          : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700002009", "Binding Lifecycle Shop");

    const first = await activate(app, owner, primaryModelId);
    const repeated = await activate(app, owner, primaryModelId);
    expect(repeated.binding.id).toBe(first.binding.id);
    expect(
      store.snapshot().agentModelBindings?.filter((candidate) => candidate.status === "active")
    ).toHaveLength(1);

    const replacement = await activate(app, owner, replacementModelId);
    expect(replacement.binding).toMatchObject({
      modelId: replacementModelId,
      status: "active"
    });
    expect(replacement.binding.id).not.toBe(first.binding.id);
    expect(store.snapshot().agentModelBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.binding.id, status: "inactive" }),
        expect.objectContaining({ id: replacement.binding.id, status: "active" })
      ])
    );
    expect(await getBinding(app, owner)).toMatchObject({
      id: replacement.binding.id,
      modelId: replacementModelId
    });

    const removed = await removeBinding(app, owner);
    expect(removed).toMatchObject({
      agentId: owner.businessId,
      shopId: owner.businessId,
      binding: null,
      removedBindingId: replacement.binding.id
    });
    expect(await getBinding(app, owner)).toBeNull();
    expect(await removeBinding(app, owner)).toMatchObject({
      binding: null,
      removedBindingId: null
    });

    const restoredStore = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId || modelId === replacementModelId
          ? healthyAdapter(modelId)
          : undefined
    });
    restoredStore.hydrateSnapshot(store.snapshot());
    const restoredApp = buildApi({ cp2: { store: restoredStore } });
    expect(await getBinding(restoredApp, owner)).toBeNull();
    const chat = await restoredApp.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ message: "hello" })
    });
    expect(chat.statusCode).toBe(409);
    expect(chat.json()).toMatchObject({ code: "AGENT_MODEL_NOT_CONFIGURED" });

    const hashtagRead = await restoredApp.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ message: "#products.list" })
    });
    expect(hashtagRead.statusCode).toBe(200);
    expect(hashtagRead.json()).toMatchObject({
      turn: {
        status: "completed",
        plan: { toolName: "products.list", confirmationToken: null },
        telemetry: expect.arrayContaining([
          expect.objectContaining({
            state: "intent.routed",
            metadata: expect.objectContaining({ source: "hashtag" })
          })
        ])
      }
    });

    const hashtagMutation = await restoredApp.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ message: "#product.delete Sugar" })
    });
    expect(hashtagMutation.statusCode).toBe(200);
    expect(hashtagMutation.json()).toMatchObject({
      turn: {
        status: "needs_confirmation",
        plan: {
          toolName: "product.delete",
          input: { productName: "Sugar" },
          confirmationToken: expect.any(String)
        }
      }
    });

    await app.close();
    await restoredApp.close();
  });

  it("routes agent chat through the active binding with shop instructions and records metadata", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    const adapter = healthyAdapter(primaryModelId, { prompts });
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700002003", "Context Shop");
    const profile = await getJson<Record<string, unknown>>(
      app,
      `/businesses/${owner.businessId}/agent-profile`,
      owner.cookie
    );
    await putJson(
      app,
      `/businesses/${owner.businessId}/agent-profile`,
      {
        ...profile,
        personality: "Concise market guide",
        instructions: "Always mention the market policy.",
        personalityConfig: {
          ...(profile.personalityConfig as Record<string, unknown>),
          additionalGuidance: "Concise market guide"
        },
        instructionPolicy: {
          ...(profile.instructionPolicy as Record<string, unknown>),
          generalOperatingRules: ["Always mention the market policy."]
        }
      },
      owner.cookie
    );
    const activation = await activate(app, owner, primaryModelId);
    const conversations = await getJson<{ conversations: Array<{ id: string }> }>(
      app,
      "/v1/conversations",
      owner.cookie
    );
    const conversationId = conversations.conversations[0]?.id;
    expect(conversationId).toBeTruthy();

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({
        conversationId,
        clientMessageId: "binding-chat-message-0001",
        content: { type: "text", text: "Reply with the word market" },
        clientTimestamp: new Date().toISOString(),
        agent: {
          businessId: owner.businessId,
          message: "Reply with the word market"
        }
      })
    });
    expect(response.statusCode).toBe(200);
    const processed = response.json<{
      id: string;
      agentMessage: { replyToMessageId: string | null };
    }>();
    expect(processed).toMatchObject({
      agentMessage: { content: { type: "text", text: "market" } },
      runtime: {
        turn: {
          model: {
            bindingId: activation.binding.id,
            modelId: primaryModelId,
            executionTarget: "backend",
            status: "available",
            fallbackUsed: false
          }
        }
      }
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.message).toContain("Always mention the market policy.");
    expect(prompts[0]?.message).toContain("Concise market guide");
    const view = await getJson<{ messages: Array<{ clientMessageId: string }> }>(
      app,
      `/v1/conversations/${conversationId}`,
      owner.cookie
    );
    expect(
      view.messages.filter(
        (message) =>
          message.clientMessageId.startsWith("agent-reply-") &&
          (message as { replyToMessageId?: string | null }).replyToMessageId === processed.id
      )
    ).toHaveLength(1);

    await app.close();
  });

  it("persists retry and approved-fallback guidance in chat when the active model is unavailable", async () => {
    const adapter = failingGenerationAdapter(primaryModelId, "INFERENCE_TIMEOUT");
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700002007", "Recovery Guidance Shop");
    await activate(app, owner, primaryModelId);
    const conversations = await getJson<{ conversations: Array<{ id: string }> }>(
      app,
      "/v1/conversations",
      owner.cookie
    );
    const conversationId = conversations.conversations[0]?.id;
    expect(conversationId).toBeTruthy();

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({
        conversationId,
        clientMessageId: "binding-chat-recovery-0001",
        content: { type: "text", text: "Help me with stock" },
        clientTimestamp: new Date().toISOString(),
        agent: {
          businessId: owner.businessId,
          message: "Help me with stock"
        }
      })
    });

    expect(response.statusCode).toBe(200);
    const responseBody = response.json<{
      id: string;
      agentMessage: { content: { type: string; text: string } };
      runtime: null;
      processing: { status: string; errorCode: string; retryable: boolean };
    }>();
    expect(responseBody).toMatchObject({
      agentMessage: {
        content: {
          type: "text",
          text: expect.stringMatching(/retry[\s\S]*configure an approved fallback/iu)
        }
      },
      runtime: null,
      processing: {
        status: "completed",
        errorCode: "AGENT_MODEL_UNAVAILABLE",
        retryable: true
      }
    });
    const persisted = await getJson<{
      messages: Array<{ clientMessageId: string; content: { type: string; text?: string } }>;
    }>(app, `/v1/conversations/${conversationId}`, owner.cookie);
    expect(
      persisted.messages.find(
        (message) => message.clientMessageId === `agent-reply-${responseBody.id}`
      )?.content.text
    ).toMatch(/approved fallback/iu);

    await app.close();
  });

  it("guides unconfigured agents to activate a model and approve a fallback within chat", async () => {
    const store = createCp2Store({
      modelRuntimeAdapterResolver: () => healthyAdapter(primaryModelId)
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700002008", "Configuration Guidance Shop");
    const conversations = await getJson<{ conversations: Array<{ id: string }> }>(
      app,
      "/v1/conversations",
      owner.cookie
    );
    const conversationId = conversations.conversations[0]?.id;
    expect(conversationId).toBeTruthy();

    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({
        conversationId,
        clientMessageId: "binding-chat-configure-0001",
        content: { type: "text", text: "Can you help?" },
        clientTimestamp: new Date().toISOString(),
        agent: {
          businessId: owner.businessId,
          message: "Can you help?"
        }
      })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      agentMessage: {
        content: {
          type: "text",
          text: expect.stringMatching(/Agent settings → Model[\s\S]*hosted fallback/iu)
        }
      },
      processing: {
        status: "completed",
        errorCode: "AGENT_MODEL_NOT_CONFIGURED"
      }
    });

    await app.close();
  });

  it("rejects unbound chat, cross-shop activation, browser activation, and absent bridges", async () => {
    const adapter = healthyAdapter(primaryModelId);
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const first = await createOwnerBusiness(app, "+254700002004", "First Shop");
    const second = await createOwnerBusiness(app, "+254700002005", "Second Shop");

    const unbound = await app.inject({
      method: "POST",
      url: `/businesses/${first.businessId}/runtime/turns`,
      headers: jsonHeaders(first.cookie),
      payload: JSON.stringify({ message: "hello" })
    });
    expect(unbound.statusCode).toBe(409);
    expect(unbound.json()).toMatchObject({ code: "AGENT_MODEL_NOT_CONFIGURED" });

    const crossShop = await app.inject({
      method: "POST",
      url: `/api/agents/${first.businessId}/models/${primaryModelId}/activate`,
      headers: jsonHeaders(second.cookie),
      payload: JSON.stringify(activationPayload(first.businessId))
    });
    expect(crossShop.statusCode).toBe(403);

    const active = await activate(app, first, primaryModelId);
    const unauthenticatedRemoval = await app.inject({
      method: "DELETE",
      url: `/api/agents/${first.businessId}/model-binding?shopId=${first.businessId}`
    });
    expect(unauthenticatedRemoval.statusCode).toBe(401);
    const crossShopRemoval = await app.inject({
      method: "DELETE",
      url: `/api/agents/${first.businessId}/model-binding?shopId=${first.businessId}`,
      headers: { cookie: second.cookie }
    });
    expect(crossShopRemoval.statusCode).toBe(403);
    expect(await getBinding(app, first)).toMatchObject({ id: active.binding.id });

    for (const [executionTarget, code, statusCode] of [
      ["browser-local", "BROWSER_RUNTIME_DISABLED", 409],
      ["installed-app", "BRIDGE_UNAVAILABLE", 503]
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/agents/${first.businessId}/models/${primaryModelId}/activate`,
        headers: jsonHeaders(first.cookie),
        payload: JSON.stringify({
          ...activationPayload(first.businessId),
          executionTarget,
          permissions: {
            ...activationPayload(first.businessId).permissions,
            allowInstalledApp: executionTarget === "installed-app"
          }
        })
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({ code });
    }

    await app.close();
  });

  it("uses an explicitly permitted fallback only after a qualifying primary failure", async () => {
    const initialStore = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId ? healthyAdapter(primaryModelId) : undefined
    });
    const initialApp = buildApi({ cp2: { store: initialStore } });
    const owner = await createOwnerBusiness(initialApp, "+254700002006", "Fallback Shop");
    await activate(initialApp, owner, primaryModelId);
    const snapshot = initialStore.snapshot();
    const binding = snapshot.agentModelBindings?.find((candidate) => candidate.status === "active");
    if (binding === undefined) throw new Error("Expected an active binding.");
    binding.permissions.allowOpenAIFallback = true;
    binding.fallbackModelId = "openai-fast";
    binding.fallbackPolicy = "WHEN_LOCAL_FAILS";

    const fallback = healthyAdapter("openai-fast", { executionTarget: "openai" });
    const fallbackGenerate = vi.spyOn(fallback, "generate");
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId }) =>
        modelId === primaryModelId
          ? failingGenerationAdapter(primaryModelId, "INFERENCE_TIMEOUT")
          : modelId === "openai-fast"
            ? fallback
            : undefined
    });
    store.hydrateSnapshot(snapshot);
    const app = buildApi({ cp2: { store } });

    const turn = await app.inject({
      method: "POST",
      url: `/businesses/${owner.businessId}/runtime/turns`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ message: "Reply with market" })
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json()).toMatchObject({
      turn: {
        response: "market",
        model: {
          bindingId: binding.id,
          modelId: "openai-fast",
          executionTarget: "openai",
          fallbackUsed: true,
          fallbackReason: "INFERENCE_TIMEOUT"
        }
      }
    });
    expect(fallbackGenerate).toHaveBeenCalledOnce();

    await initialApp.close();
    await app.close();
  });
});

describe("backend model adapter", () => {
  it("validates provider identity and captures usage and latency", async () => {
    const fetchMock = gatewayFetch();
    const adapter = createBackendModelAdapter({
      baseUrl: "soko-market-inference:4002",
      modelId: primaryModelId,
      serviceToken: "test-inference-token",
      connectTimeoutMs: 500,
      timeoutMs: 1_000,
      fetch: fetchMock
    });
    const health = await adapter.healthCheck({
      agentId: "agent",
      shopId: "shop",
      modelId: primaryModelId
    });
    expect(health).toMatchObject({
      available: true,
      modelId: primaryModelId,
      provider: "ollama",
      executionTarget: "backend"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://soko-market-inference:4002/v1/models/qwen2.5-0.5b-android/probe"),
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        headers: expect.objectContaining({
          authorization: "Bearer test-inference-token"
        })
      })
    );
  });

  it("rejects empty and mismatched backend responses", async () => {
    for (const [gatewayOptions, expectedCode] of [
      [{ providerModelId: "other:1b" }, "MODEL_IDENTITY_MISMATCH"],
      [{ text: "" }, "INVALID_INFERENCE_RESPONSE"]
    ]) {
      const adapter = createBackendModelAdapter({
        baseUrl: "http://soko-market-inference:4002",
        modelId: primaryModelId,
        serviceToken: "test-inference-token",
        connectTimeoutMs: 500,
        timeoutMs: 1_000,
        fetch: gatewayFetch(gatewayOptions)
      });
      await expect(
        adapter.generate({
          context: { agentId: "agent", shopId: "shop", modelId: primaryModelId },
          prompt: runtimePrompt("hello")
        })
      ).rejects.toMatchObject({
        code: expectedCode
      });
    }
  });

  it("requests the runtime JSON contract and normalizes a plain model response", async () => {
    const fetchMock = gatewayFetch({ text: "market" });
    const adapter = createBackendModelAdapter({
      baseUrl: "http://soko-market-inference:4002",
      modelId: primaryModelId,
      serviceToken: "test-inference-token",
      connectTimeoutMs: 500,
      timeoutMs: 1_000,
      fetch: fetchMock
    });

    const completion = await adapter.generate({
      context: { agentId: "agent", shopId: "shop", modelId: primaryModelId },
      prompt: runtimePrompt("Reply with the word market")
    });

    expect(JSON.parse(completion.text)).toEqual({ type: "response", message: "market" });
    expect(completion).toMatchObject({
      providerModelId: "qwen2.5:0.5b",
      inferenceRequestId: "inference-request-1",
      promptTokens: 7,
      completionTokens: 3
    });
    const generationCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/v1/chat/completions")
    );
    expect(JSON.parse(String(generationCall?.[1]?.body))).toMatchObject({
      modelId: primaryModelId,
      jsonOutput: true
    });
  });

  it("performs one successful readiness check and never retries generation", async () => {
    const fetchMock = gatewayFetch({ generationStatus: 503 });
    const adapter = createBackendModelAdapter({
      baseUrl: "http://soko-market-inference:4002",
      modelId: primaryModelId,
      serviceToken: "test-inference-token",
      connectTimeoutMs: 500,
      timeoutMs: 1_000,
      fetch: fetchMock
    });

    await expect(
      adapter.generate({
        context: { agentId: "agent", shopId: "shop", modelId: primaryModelId },
        prompt: runtimePrompt("hello")
      })
    ).rejects.toMatchObject({ code: "MODEL_GENERATION_FAILED" });

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/health/ready"))
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/chat/completions"))
    ).toHaveLength(1);
  });

  it("propagates a caller abort into an in-flight model probe", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith("/health/ready")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              engine: "ollama",
              models: [
                {
                  id: primaryModelId,
                  providerModelId: "qwen2.5:0.5b",
                  available: true
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    });
    const adapter = createBackendModelAdapter({
      baseUrl: "http://soko-market-inference:4002",
      modelId: primaryModelId,
      serviceToken: "test-inference-token",
      connectTimeoutMs: 500,
      timeoutMs: 1_000,
      fetch: fetchMock
    });

    const healthPromise = adapter.healthCheck({
      agentId: "agent",
      shopId: "shop",
      modelId: primaryModelId,
      signal: controller.signal
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(healthPromise).resolves.toMatchObject({
      available: false,
      errorCode: "INFERENCE_CANCELLED"
    });
  });
});

function gatewayFetch(
  overrides: { providerModelId?: string; text?: string; generationStatus?: number } = {}
): ReturnType<typeof vi.fn> {
  const providerModelId = overrides.providerModelId ?? "qwen2.5:0.5b";
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = String(input);
    const body = url.endsWith("/health/ready")
      ? {
          ok: true,
          engine: "ollama",
          models: [
            {
              id: primaryModelId,
              providerModelId: "qwen2.5:0.5b",
              available: true,
              digest: "sha256:model"
            }
          ]
        }
      : url.endsWith("/probe")
        ? {
            ok: true,
            modelId: primaryModelId,
            providerModelId,
            engine: "ollama",
            latencyMs: 4
          }
        : {
            ok: true,
            id: "inference-request-1",
            modelId: primaryModelId,
            providerModelId,
            engine: "ollama",
            text: overrides.text ?? "SOKO_MODEL_OK",
            latencyMs: 8,
            usage: { promptTokens: 7, completionTokens: 3 },
            finishReason: "stop"
          };
    const generationFailure =
      url.endsWith("/v1/chat/completions") && overrides.generationStatus !== undefined;
    return new Response(
      JSON.stringify(
        generationFailure
          ? {
              ok: false,
              error: {
                code: "MODEL_GENERATION_FAILED",
                message: "generation failed",
                retryable: true
              }
            }
          : body
      ),
      {
        status: generationFailure ? overrides.generationStatus : 200,
        headers: { "content-type": "application/json" }
      }
    );
  });
}

function healthyAdapter(
  modelId: string,
  options: {
    healthOk?: boolean;
    prompts?: RuntimeModelPrompt[];
    executionTarget?: "backend" | "openai";
  } = {}
): ModelRuntimeAdapter {
  const executionTarget = options.executionTarget ?? "backend";
  return {
    provider: "test",
    executionTarget,
    async canRun() {
      return { available: true, errorCode: null, message: null };
    },
    async healthCheck() {
      const ok = options.healthOk ?? true;
      return {
        available: ok,
        modelId,
        provider: "test",
        executionTarget,
        latencyMs: 4,
        responsePreview: ok ? "SOKO_MODEL_OK" : "not ready",
        errorCode: ok ? null : "MODEL_HEALTH_CHECK_FAILED",
        message: ok ? null : "The model did not pass readiness.",
        retryable: !ok
      };
    },
    async generate({ prompt }) {
      options.prompts?.push(prompt);
      return {
        text: JSON.stringify({ type: "response", message: "market" }),
        modelId,
        provider: "test",
        executionTarget,
        latencyMs: 8
      };
    }
  };
}

function failingGenerationAdapter(modelId: string, code: string): ModelRuntimeAdapter {
  const adapter = healthyAdapter(modelId);
  adapter.generate = async () => {
    throw new ModelRuntimeError(code, "Primary runtime failed.", true);
  };
  return adapter;
}

function activationPayload(shopId: string) {
  return {
    shopId,
    executionTarget: "backend" as ModelExecutionTarget,
    executionMode: "LOCAL_FIRST",
    fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
    permissions: {
      allowInstalledApp: false,
      allowRemoteShopDevice: false,
      allowOpenAIFallback: false
    },
    fallbackModelId: null
  };
}

async function activate(
  app: ReturnType<typeof buildApi>,
  owner: { businessId: string; cookie: string },
  modelId: string
): Promise<AgentModelActivationResult> {
  const response = await app.inject({
    method: "POST",
    url: `/api/agents/${owner.businessId}/models/${modelId}/activate`,
    headers: jsonHeaders(owner.cookie),
    payload: JSON.stringify(activationPayload(owner.businessId))
  });
  expect(response.statusCode).toBe(200);
  return response.json<AgentModelActivationResult>();
}

async function getBinding(
  app: ReturnType<typeof buildApi>,
  owner: { businessId: string; cookie: string }
): Promise<AgentModelBindingSummary | null> {
  const response = await app.inject({
    method: "GET",
    url: `/api/agents/${owner.businessId}/model-binding?shopId=${owner.businessId}`,
    headers: { cookie: owner.cookie }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ binding: AgentModelBindingSummary | null }>().binding;
}

async function removeBinding(
  app: ReturnType<typeof buildApi>,
  owner: { businessId: string; cookie: string }
) {
  const response = await app.inject({
    method: "DELETE",
    url: `/api/agents/${owner.businessId}/model-binding?shopId=${owner.businessId}`,
    headers: { cookie: owner.cookie }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{
    agentId: string;
    shopId: string;
    binding: null;
    removedBindingId: string | null;
  }>();
}

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  contact: string,
  name: string
): Promise<{ businessId: string; cookie: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: jsonHeaders(),
    payload: JSON.stringify({ method: "phone", contact, pin: "1234" })
  });
  expect(signup.statusCode).toBe(200);
  const cookie = sessionCookie(signup.headers["set-cookie"]);
  const business = await app.inject({
    method: "POST",
    url: "/businesses",
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ name, language: "en" })
  });
  expect(business.statusCode).toBe(200);
  return {
    businessId: business.json<{ business: { id: string } }>().business.id,
    cookie
  };
}

async function getJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<T> {
  const response = await app.inject({ method: "GET", url, headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

async function putJson(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie: string
): Promise<void> {
  const response = await app.inject({
    method: "PUT",
    url,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload)
  });
  expect(response.statusCode).toBe(200);
}

function jsonHeaders(cookie?: string) {
  return {
    "content-type": "application/json",
    ...(cookie === undefined ? {} : { cookie })
  };
}

function sessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) throw new Error("Expected a session cookie.");
  return value.split(";")[0] ?? value;
}

function runtimePrompt(message: string): RuntimeModelPrompt {
  return {
    message,
    context: {
      businessId: "shop",
      userId: "user",
      role: "owner",
      productCount: 0,
      customerCount: 0,
      supplierCount: 0,
      invoiceCount: 0,
      paymentCount: 0,
      importJobCount: 0
    },
    allowedTools: [],
    schemaVersion: "cp11-runtime-model-v1"
  };
}
