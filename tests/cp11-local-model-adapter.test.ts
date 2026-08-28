import { describe, expect, it } from "vitest";
import type {
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "../packages/shared-types/src";
import { parseRuntimeModelOutput } from "../packages/tool-core/src";
import {
  buildLlamaPrompt,
  createLlamaCppRuntimeModelProvider,
  createOllamaRuntimeModelProvider,
  createOpenAiRuntimeModelProvider,
  normalizeOllamaModelText
} from "../services/ai-runtime/src/app";
import { buildApi } from "../services/api/src/app";
import { resolveOllamaModelName } from "../services/api/src/config";
import { createCp2Store } from "../services/api/src/cp2/store";
import { activateGenericGlobalDefaultModel } from "./fixtures/native-runtime-test-helpers";

interface VerifyOtpResponse {
  session: {
    id: string;
  };
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

interface ProductResponse {
  id: string;
  name: string;
  quantity: number;
}

interface ConversationInboxResponse {
  conversations: Array<{
    id: string;
  }>;
}

interface ProcessedConversationMessageResponse {
  id: string;
  content: {
    type: string;
  };
  agentMessage: {
    id: string;
    author: string;
    replyToMessageId: string | null;
    content:
      | {
          type: "text";
          text: string;
        }
      | {
          type: string;
        };
  };
  runtime: RuntimeTurnResponse | null;
}

interface RuntimeTurnResponse {
  session: {
    id: string;
  };
  turn: {
    status: "completed" | "needs_confirmation" | "clarifying" | "blocked" | "rate_limited";
    parserIntent: string;
    plan: {
      toolName: string;
      risk: string;
      confirmationToken: string | null;
      executedAt: string | null;
    };
    verification: {
      ok: boolean;
      requiresConfirmation: boolean;
      confirmationSatisfied: boolean;
    };
    model: {
      provider: string | null;
      status: string;
      fallbackUsed: boolean;
      outputKind: string | null;
      errorCode: string | null;
    } | null;
    response: string;
    toolResult: unknown;
    telemetry: Array<{
      state: string;
      metadata: Record<string, unknown>;
    }>;
  };
}

describe("CP11 local model adapter", () => {
  it("parses bounded local model output into runtime tool proposals", () => {
    const parsed = parseRuntimeModelOutput(
      JSON.stringify({
        type: "tool",
        toolName: "products.list",
        input: {},
        reason: "Show products from local model routing."
      })
    );

    expect(parsed).toMatchObject({
      ok: true,
      output: {
        kind: "tool",
        proposal: {
          toolName: "products.list",
          validation: {
            ok: true
          }
        }
      }
    });
    expect(parseRuntimeModelOutput("not json")).toMatchObject({
      ok: false,
      output: null
    });
  });

  it("reports the configured small local model profile in adapter metadata", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          content: JSON.stringify({
            type: "response",
            message: "Ready."
          })
        }),
        {
          headers: {
            "content-type": "application/json"
          },
          status: 200
        }
      );

    try {
      const provider = createLlamaCppRuntimeModelProvider({
        endpoint: "http://127.0.0.1:8080",
        maxTokens: 128,
        modelProfile: "qwen2.5-0.5b-instruct-q4_0-android-2gb",
        temperature: 0,
        timeoutMs: 8000
      });
      const completion = await provider.complete(emptyRuntimePrompt("show products"));

      expect(completion).toMatchObject({
        provider: "llama.cpp",
        status: "available",
        metadata: {
          endpointHost: "127.0.0.1:8080",
          modelProfile: "qwen2.5-0.5b-instruct-q4_0-android-2gb"
        }
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("maps the stable Soko model id and normalizes Ollama chat responses", async () => {
    const previousFetch = globalThis.fetch;
    let request: { url: string; body: Record<string, unknown> } | null = null;
    globalThis.fetch = async (input, init) => {
      request = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      };
      return new Response(
        JSON.stringify({
          model: "qwen2.5:0.5b",
          message: {
            role: "assistant",
            content: "Hello from the installed local model."
          },
          done: true
        }),
        { status: 200 }
      );
    };

    try {
      const providerModel = resolveOllamaModelName(
        "qwen2.5-0.5b-android",
        "qwen2.5-0.5b-android",
        "qwen2.5:0.5b"
      );
      const provider = createOllamaRuntimeModelProvider({
        endpoint: "http://127.0.0.1:11434",
        model: providerModel,
        maxTokens: 128,
        temperature: 0,
        timeoutMs: 30_000
      });
      const completion = await provider.complete(emptyRuntimePrompt("Hello"));

      expect(request).toMatchObject({
        url: "http://127.0.0.1:11434/api/chat",
        body: {
          model: "qwen2.5:0.5b",
          format: "json",
          stream: false,
          options: {
            num_predict: 128,
            temperature: 0
          }
        }
      });
      expect(completion).toMatchObject({
        provider: "ollama",
        status: "available",
        errorCode: null,
        metadata: {
          endpointHost: "127.0.0.1:11434",
          model: "qwen2.5:0.5b"
        }
      });
      expect(parseRuntimeModelOutput(completion.outputText ?? "")).toMatchObject({
        ok: true,
        output: {
          kind: "response",
          proposal: {
            reason: "Hello from the installed local model."
          }
        }
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("reports a missing configured Ollama model with a stable error code", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          models: [{ name: "smollm2:135m", model: "smollm2:135m" }]
        }),
        { status: 200 }
      );

    try {
      const provider = createOllamaRuntimeModelProvider({
        endpoint: "http://ollama:11434",
        model: "qwen2.5:0.5b"
      });
      await expect(provider.diagnose?.()).resolves.toMatchObject({
        provider: "ollama",
        status: "unavailable",
        model: "qwen2.5:0.5b",
        modelAvailable: false,
        errorCode: "MODEL_NOT_INSTALLED"
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("normalizes common small-model JSON envelopes without hiding malformed output", () => {
    expect(
      parseRuntimeModelOutput(
        normalizeOllamaModelText(JSON.stringify({ response: "Hello from Qwen." }))
      )
    ).toMatchObject({
      ok: true,
      output: {
        kind: "response",
        proposal: {
          reason: "Hello from Qwen."
        }
      }
    });
    expect(
      parseRuntimeModelOutput(
        normalizeOllamaModelText(
          JSON.stringify({ type: "response", content: "Alternate response field." })
        )
      )
    ).toMatchObject({
      ok: true,
      output: {
        kind: "response"
      }
    });
    expect(normalizeOllamaModelText(JSON.stringify({ unexpected: 42 }))).toBe(
      JSON.stringify({ unexpected: 42 })
    );
  });

  it("processes hosted agent turns through the OpenAI Responses API", async () => {
    const previousFetch = globalThis.fetch;
    let request: {
      url: string;
      authorization: string | null;
      body: Record<string, unknown>;
    } | null = null;
    globalThis.fetch = async (input, init) => {
      request = {
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      };
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    type: "tool",
                    toolName: "products.list",
                    input: {},
                    reason: "List products through the hosted model."
                  })
                }
              ]
            }
          ]
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200
        }
      );
    };

    try {
      const provider = createOpenAiRuntimeModelProvider({
        apiKey: "test-openai-key",
        model: "gpt-test",
        maxOutputTokens: 128,
        reasoningEffort: "minimal",
        timeoutMs: 8_000
      });
      const completion = await provider.complete(emptyRuntimePrompt("show products"));

      expect(request).toMatchObject({
        url: "https://api.openai.com/v1/responses",
        authorization: "Bearer test-openai-key",
        body: {
          model: "gpt-test",
          max_output_tokens: 128,
          reasoning: { effort: "minimal" },
          store: false
        }
      });
      expect((request as { body: { input: string } } | null)?.body.input).toContain(
        'User message: "show products"'
      );
      expect(completion).toMatchObject({
        provider: "openai",
        status: "available",
        metadata: {
          endpointHost: "api.openai.com",
          model: "gpt-test"
        }
      });
      expect(parseRuntimeModelOutput(completion.outputText ?? "")).toMatchObject({
        ok: true,
        output: {
          kind: "tool",
          proposal: { toolName: "products.list" }
        }
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("reports an explicit fallback when the active model has no inference provider", async () => {
    let selectedModelId: string | null = null;
    const store = createCp2Store({
      runtimeModelProviderResolver: (modelId) => {
        selectedModelId = modelId;
        return undefined;
      }
    });
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "open products"
      },
      sessionCookie
    );

    expect(selectedModelId).toBe("sokoclaw-local");
    expect(turn.turn).toMatchObject({
      status: "completed",
      model: {
        provider: null,
        status: "disabled",
        fallbackUsed: true,
        outputKind: null,
        errorCode: "model_provider_unconfigured"
      },
      plan: {
        toolName: "products.list"
      }
    });

    await app.close();
  });

  it("processes a persisted agent-chat message exactly once across idempotent retries", async () => {
    let completionCount = 0;
    const provider = createTestModelProvider(async () => {
      completionCount += 1;
      return availableCompletion({
        type: "response",
        message: "The agent processed this chat message."
      });
    });
    const store = createCp2Store({ runtimeModelProvider: provider });
    // Global default model/host are seeded unavailable until a verified health check runs (see
    // services/api/src/index.ts's production startup gate); mirror that here so the injected
    // provider is actually reachable.
    activateGenericGlobalDefaultModel(store, new Date().toISOString());
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const inboxResponse = await app.inject({
      method: "GET",
      url: "/v1/conversations",
      headers: { cookie: sessionCookie }
    });
    expect(inboxResponse.statusCode).toBe(200);
    const conversationId = inboxResponse.json<ConversationInboxResponse>().conversations[0]?.id;
    expect(conversationId).toBeTruthy();
    const payload = {
      conversationId,
      clientMessageId: "message-agent-processing-0001",
      content: {
        type: "text",
        text: "Please process this in the agent chat."
      },
      clientTimestamp: new Date().toISOString(),
      agent: {
        businessId,
        runtimeSessionId: null,
        message: "Please process this in the agent chat."
      }
    };

    const first = await postJson<ProcessedConversationMessageResponse>(
      app,
      "/v1/messages",
      payload,
      sessionCookie
    );
    const retried = await postJson<ProcessedConversationMessageResponse>(
      app,
      "/v1/messages",
      payload,
      sessionCookie
    );

    expect(completionCount).toBe(1);
    expect(first.runtime?.turn).toMatchObject({
      status: "completed",
      model: {
        provider: "test",
        status: "available",
        fallbackUsed: false,
        outputKind: "response"
      },
      response: "The agent processed this chat message."
    });
    expect(first.agentMessage).toMatchObject({
      author: "agent",
      replyToMessageId: first.id,
      content: {
        type: "text",
        text: "The agent processed this chat message."
      }
    });
    expect(retried.id).toBe(first.id);
    expect(retried.agentMessage.id).toBe(first.agentMessage.id);
    expect(retried.runtime).toBeNull();
    expect(
      store
        .snapshot()
        .conversationMessages.filter((message) => message.conversationId === conversationId)
    ).toHaveLength(2);

    await app.close();
  });

  it("persists an honest unavailable-model notice, not a fabricated reply, and retries idempotently", async () => {
    let completionCount = 0;
    const provider = createTestModelProvider(async () => {
      completionCount += 1;
      if (completionCount === 1) {
        return {
          provider: "test",
          status: "unavailable",
          outputText: null,
          durationMs: 1,
          errorCode: "MODEL_PROVIDER_UNREACHABLE",
          metadata: {}
        };
      }
      return availableCompletion({
        type: "response",
        message: "Recovered local response."
      });
    });
    const store = createCp2Store({ runtimeModelProvider: provider });
    // Global default model/host are seeded unavailable until a verified health check runs (see
    // services/api/src/index.ts's production startup gate); mirror that here so the injected
    // provider is actually reachable.
    activateGenericGlobalDefaultModel(store, new Date().toISOString());
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const inbox = await app.inject({
      method: "GET",
      url: "/v1/conversations",
      headers: { cookie: sessionCookie }
    });
    const conversationId = inbox.json<ConversationInboxResponse>().conversations[0]?.id;
    const payload = {
      conversationId,
      clientMessageId: "message-agent-retry-0001",
      content: { type: "text", text: "Retry this local request." },
      agent: {
        businessId,
        message: "Retry this local request."
      }
    };

    const completed = await postJson<ProcessedConversationMessageResponse>(
      app,
      "/v1/messages",
      payload,
      sessionCookie
    );
    expect(completed).toMatchObject({
      status: "delivered",
      failureCode: null,
      processing: {
        status: "completed",
        errorCode: "AGENT_MODEL_UNAVAILABLE",
        retryable: true
      },
      runtime: null,
      agentMessage: {
        author: "agent"
      }
    });
    // No fabricated model output: the persisted reply is an honest, actionable notice, not a
    // canned answer standing in for a real completion.
    expect(completed.agentMessage.content).toMatchObject({
      type: "text",
      text: expect.stringMatching(/can.?t use a working model/iu)
    });
    expect(store.snapshot().conversationMessages).toHaveLength(2);

    const retried = await postJson<ProcessedConversationMessageResponse>(
      app,
      "/v1/messages",
      payload,
      sessionCookie
    );
    expect(completionCount).toBe(1);
    expect(retried.id).toBe(completed.id);
    expect(retried.agentMessage.id).toBe(completed.agentMessage.id);
    expect(retried.runtime).toBeNull();
    expect(store.snapshot().conversationMessages).toHaveLength(2);

    await app.close();
  });

  it("sends prior persisted conversation turns to the model in chronological order", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    const provider = createTestModelProvider(async (prompt) => {
      prompts.push(prompt);
      return availableCompletion({
        type: "response",
        message: prompts.length === 1 ? "I remember pineapples." : "You said pineapples."
      });
    });
    const store = createCp2Store({ runtimeModelProvider: provider });
    // Global default model/host are seeded unavailable until a verified health check runs (see
    // services/api/src/index.ts's production startup gate); mirror that here so the injected
    // provider is actually reachable.
    activateGenericGlobalDefaultModel(store, new Date().toISOString());
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const inbox = await app.inject({
      method: "GET",
      url: "/v1/conversations",
      headers: { cookie: sessionCookie }
    });
    const conversationId = inbox.json<ConversationInboxResponse>().conversations[0]?.id;

    await postJson(
      app,
      "/v1/messages",
      {
        conversationId,
        clientMessageId: "message-history-0001",
        content: { type: "text", text: "Remember pineapples." },
        agent: { businessId, message: "Remember pineapples." }
      },
      sessionCookie
    );
    await postJson(
      app,
      "/v1/messages",
      {
        conversationId,
        clientMessageId: "message-history-0002",
        content: { type: "text", text: "What did I ask you to remember?" },
        agent: { businessId, message: "What did I ask you to remember?" }
      },
      sessionCookie
    );

    expect(prompts[1]?.conversationHistory).toEqual([
      { role: "user", content: "Remember pineapples." },
      { role: "assistant", content: "I remember pineapples." }
    ]);
    expect(buildLlamaPrompt(prompts[1] as RuntimeModelPrompt)).toContain(
      "Recent conversation (oldest first):\nUser: Remember pineapples.\nAssistant: I remember pineapples."
    );

    await app.close();
  });

  it("builds server-authoritative llama.cpp prompts with bounded context and no business record names", async () => {
    let capturedPrompt: RuntimeModelPrompt | null = null;
    const provider = createTestModelProvider(async (prompt) => {
      capturedPrompt = prompt;
      return availableCompletion({
        type: "tool",
        toolName: "products.list",
        input: {},
        reason: "List inventory through local model routing."
      });
    });
    const store = createCp2Store({ runtimeModelProvider: provider });
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    await postJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products`,
      {
        name: "Private Sugar",
        unit: "kg",
        quantity: 8
      },
      sessionCookie
    );

    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "what is in stock?",
        agentProfile: {
          behavior: "Practical, polite, and inventory-first",
          integrations: ["Soko.market storefront"],
          knowledge: "Prioritize saved products and confirmed store records.",
          model: "qwen2.5-0.5b-android",
          role: "Store attendant",
          instructions: "Only promise items the store can actually supply.",
          tools: ["Products", "Invoices"],
          contextScripts: [
            "script: product_catalogue_commands\nallow: read, add, edit, remove\nsw: onyesha bidhaa => products.list"
          ]
        }
      },
      sessionCookie
    );

    expect(capturedPrompt).toMatchObject({
      schemaVersion: "cp11-runtime-model-v1",
      context: {
        businessId,
        productCount: 1
      }
    });
    expect(JSON.stringify(capturedPrompt?.context)).not.toContain("Private Sugar");
    const llamaPrompt = buildLlamaPrompt(capturedPrompt as RuntimeModelPrompt);
    expect(llamaPrompt).not.toContain("Private Sugar");
    expect(llamaPrompt).toContain(
      "Use this agent profile as the guiding operating principles for how this store is run."
    );
    expect(llamaPrompt).toContain(
      "Agent behavior: Warm, concise, accurate and commercially practical."
    );
    expect(llamaPrompt).toContain("# Available verified tools");
    expect(llamaPrompt).toContain("script: product_catalogue_commands");
    expect(llamaPrompt).not.toContain("Practical, polite, and inventory-first");
    expect(llamaPrompt).not.toContain("Only promise items the store can actually supply");
    expect(llamaPrompt).not.toContain("sw: onyesha bidhaa => products.list");
    expect(turn.turn).toMatchObject({
      status: "completed",
      model: {
        provider: "test",
        status: "available",
        fallbackUsed: false,
        outputKind: "tool"
      },
      plan: {
        toolName: "products.list",
        risk: "low"
      }
    });
    expect(turn.turn.toolResult).toEqual([
      expect.objectContaining({
        name: "Private Sugar"
      })
    ]);
    expect(turn.turn.telemetry.map((event) => event.state)).toEqual(
      expect.arrayContaining(["model.prompt_built", "model.completed"])
    );

    await app.close();
  });

  it("keeps model-derived high-risk actions behind confirmation gates", async () => {
    // product.create is auto-accepted (no confirmation gate) - the mock model routes to
    // product.create on the first call (to seed a product, completing immediately) and
    // product.update (still confirmed) on the second, which is this test's actual proof.
    let callCount = 0;
    const provider = createTestModelProvider(async () => {
      callCount += 1;
      return callCount === 1
        ? availableCompletion({
            type: "tool",
            toolName: "product.create",
            input: {
              name: "Model Sugar",
              unit: "kg",
              quantity: 3
            },
            reason: "Draft product from local model routing."
          })
        : availableCompletion({
            type: "tool",
            toolName: "product.update",
            input: {
              productName: "Model Sugar",
              quantity: 5
            },
            reason: "Update product from local model routing."
          });
    });
    const store = createCp2Store({ runtimeModelProvider: provider });
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const created = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "please ask the local model to draft inventory sugar"
      },
      sessionCookie
    );
    expect(created.turn).toMatchObject({
      status: "completed",
      plan: { toolName: "product.create", requiresConfirmation: false }
    });
    expect(store.snapshot().products).toHaveLength(1);

    const proposed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        runtimeSessionId: created.session.id,
        message: "please ask the local model to update inventory sugar"
      },
      sessionCookie
    );

    expect(proposed.turn).toMatchObject({
      status: "needs_confirmation",
      model: {
        fallbackUsed: false,
        outputKind: "tool"
      },
      plan: {
        toolName: "product.update",
        risk: "high",
        executedAt: null
      },
      verification: {
        ok: false,
        requiresConfirmation: true,
        confirmationSatisfied: false
      }
    });
    expect(proposed.turn.plan.confirmationToken).toBeTruthy();
    expect(store.snapshot().products[0]?.quantity).toBe(3);

    const confirmed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        runtimeSessionId: proposed.session.id,
        message: "confirm",
        confirmationToken: proposed.turn.plan.confirmationToken
      },
      sessionCookie
    );

    expect(confirmed.turn).toMatchObject({
      status: "completed",
      model: null,
      verification: {
        ok: true,
        confirmationSatisfied: true
      }
    });
    expect(confirmed.turn.toolResult).toMatchObject({
      name: "Model Sugar",
      quantity: 5
    });

    await app.close();
  });

  it("falls back deterministically when the local model is unavailable or malformed", async () => {
    const unavailable = await runFallbackCase("unavailable", null, "llama_not_running");
    expect(unavailable.turn).toMatchObject({
      status: "completed",
      model: {
        status: "unavailable",
        fallbackUsed: true,
        errorCode: "llama_not_running"
      },
      plan: {
        toolName: "products.list"
      }
    });

    const timedOut = await runFallbackCase("timeout", null, "timeout");
    expect(timedOut.turn).toMatchObject({
      status: "completed",
      model: {
        status: "timeout",
        fallbackUsed: true,
        errorCode: "timeout"
      },
      plan: {
        toolName: "products.list"
      }
    });

    const malformed = await runFallbackCase("available", "not json", null);
    expect(malformed.turn).toMatchObject({
      status: "completed",
      model: {
        status: "malformed",
        fallbackUsed: true
      },
      plan: {
        toolName: "products.list"
      }
    });

    const thrown = await runThrownFallbackCase();
    expect(thrown.turn).toMatchObject({
      status: "completed",
      model: {
        status: "error",
        fallbackUsed: true,
        errorCode: "provider_exception"
      },
      plan: {
        toolName: "products.list"
      }
    });
  });

  it("does not log plaintext prompts or model output in runtime telemetry", async () => {
    const provider = createTestModelProvider(async () =>
      availableCompletion({
        type: "tool",
        toolName: "products.list",
        input: {},
        reason: "Sensitive model reason should not be telemetry plaintext."
      })
    );
    const store = createCp2Store({ runtimeModelProvider: provider });
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const turn = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "show products with private note abc123"
      },
      sessionCookie
    );

    const telemetryText = JSON.stringify(turn.turn.telemetry);
    expect(telemetryText).not.toContain("private note abc123");
    expect(telemetryText).not.toContain("Sensitive model reason");
    expect(JSON.stringify(store.snapshot().auditEvents)).not.toContain("private note abc123");

    await app.close();
  });
});

async function runFallbackCase(
  status: RuntimeModelCompletionResult["status"],
  outputText: string | null,
  errorCode: string | null
): Promise<RuntimeTurnResponse> {
  const provider = createTestModelProvider(async () => ({
    provider: "test",
    status,
    outputText,
    durationMs: 1,
    errorCode,
    metadata: {}
  }));
  const store = createCp2Store({ runtimeModelProvider: provider });
  const app = buildApi({ cp2: { store } });
  const { businessId, sessionCookie } = await createOwnerBusiness(app);

  const turn = await postJson<RuntimeTurnResponse>(
    app,
    `/businesses/${businessId}/runtime/turns`,
    {
      message: "open products"
    },
    sessionCookie
  );

  await app.close();
  return turn;
}

async function runThrownFallbackCase(): Promise<RuntimeTurnResponse> {
  const provider = createTestModelProvider(async () => {
    throw new Error("local provider failed");
  });
  const store = createCp2Store({ runtimeModelProvider: provider });
  const app = buildApi({ cp2: { store } });
  const { businessId, sessionCookie } = await createOwnerBusiness(app);

  const turn = await postJson<RuntimeTurnResponse>(
    app,
    `/businesses/${businessId}/runtime/turns`,
    {
      message: "open products"
    },
    sessionCookie
  );

  await app.close();
  return turn;
}

function createTestModelProvider(
  complete: (prompt: RuntimeModelPrompt) => Promise<RuntimeModelCompletionResult>
): RuntimeModelProvider {
  return {
    name: "test",
    complete
  };
}

function availableCompletion(output: unknown): RuntimeModelCompletionResult {
  return {
    provider: "test",
    status: "available",
    outputText: JSON.stringify(output),
    durationMs: 1,
    errorCode: null,
    metadata: {}
  };
}

function emptyRuntimePrompt(message: string): RuntimeModelPrompt {
  return {
    allowedTools: ["products.list"],
    context: {
      activeLogisticsCount: 0,
      betaAccessStatus: "not_invited",
      betaReadinessStatus: "not_ready",
      complianceExportCount: 0,
      crashFreeSessionRate: 1,
      customerCount: 0,
      deviceTrustLevel: "unknown",
      importJobCount: 0,
      invoiceCount: 0,
      knowledgeFactCount: 0,
      language: "en",
      launchReadinessStatus: "not_ready",
      logisticsCount: 0,
      lowStockCount: 0,
      openInvoiceCount: 0,
      openLaunchIncidentCount: 0,
      openSupportTicketCount: 0,
      outstandingDebtTotal: 0,
      productCount: 0,
      publicLaunchStatus: "closed",
      role: "owner",
      scheduledDeletionCount: 0,
      unreadNotificationCount: 0,
      verificationTier: "unverified"
    },
    message,
    schemaVersion: "cp11-runtime-model-v1"
  };
}

async function createOwnerBusiness(app: ReturnType<typeof buildApi>) {
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      method: "phone",
      contact: "254700000011",
      pin: "1234"
    })
  });
  const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
  const auth = verifyResponse.json<VerifyOtpResponse>();
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "Jane's Shop",
      language: "en"
    },
    sessionCookie
  );

  expect(auth.session.id).toBeTruthy();

  return {
    businessId: business.business.id,
    sessionCookie
  };
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: cookie === undefined ? jsonHeaders() : { ...jsonHeaders(), cookie },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBe(200);
  return response.json<TResponse>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  expect(value).toBeDefined();
  return value?.split(";")[0] ?? "";
}
