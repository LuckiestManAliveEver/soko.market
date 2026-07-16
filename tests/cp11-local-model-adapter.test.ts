import { describe, expect, it } from "vitest";
import type {
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "../packages/shared-types/src";
import { parseRuntimeModelOutput } from "../packages/tool-core/src";
import {
  buildLlamaPrompt,
  createLlamaCppRuntimeModelProvider
} from "../services/ai-runtime/src/app";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

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

  it("builds llama.cpp prompts with bounded context and no business record names", async () => {
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
    expect(llamaPrompt).toContain("Agent behavior: Practical, polite, and inventory-first.");
    expect(llamaPrompt).toContain("Agent capabilities: Products, Invoices.");
    expect(llamaPrompt).toContain("Agent integrations: Soko.market storefront.");
    expect(llamaPrompt).toContain("Only promise items the store can actually supply.");
    expect(llamaPrompt).toContain("Context files (Markdown): ## context-1.md");
    expect(llamaPrompt).toContain("script: product_catalogue_commands");
    expect(llamaPrompt).toContain("sw: onyesha bidhaa => products.list");
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
    const provider = createTestModelProvider(async () =>
      availableCompletion({
        type: "tool",
        toolName: "product.create",
        input: {
          name: "Model Sugar",
          unit: "kg",
          quantity: 3
        },
        reason: "Draft product from local model routing."
      })
    );
    const store = createCp2Store({ runtimeModelProvider: provider });
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const proposed = await postJson<RuntimeTurnResponse>(
      app,
      `/businesses/${businessId}/runtime/turns`,
      {
        message: "please ask the local model to draft inventory sugar"
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
        toolName: "product.create",
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
    expect(store.snapshot().products).toHaveLength(0);

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
      quantity: 3
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
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination: "254700000011"
  });
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otpResponse.challengeId,
      code: otpResponse.devOtp
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
