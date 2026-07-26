import type {
  ModelExecutionTarget,
  RuntimeModelCompletionResult,
  RuntimeModelDiagnostic,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";

export interface ModelRuntimeContext {
  agentId: string;
  shopId: string;
  modelId: string;
  signal?: AbortSignal;
}

export interface ModelRuntimeAvailability {
  available: boolean;
  errorCode: string | null;
  message: string | null;
}

export interface ModelRuntimeHealthResult extends ModelRuntimeAvailability {
  modelId: string;
  provider: string;
  executionTarget: ModelExecutionTarget;
  latencyMs: number;
  responsePreview: string | null;
  retryable: boolean;
}

export interface ModelRuntimeGenerationResult {
  text: string;
  modelId: string;
  provider: string;
  executionTarget: ModelExecutionTarget;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  finishReason?: string;
}

export interface ModelRuntimeAdapter {
  readonly provider: string;
  readonly executionTarget: ModelExecutionTarget;
  canRun(context: ModelRuntimeContext): Promise<ModelRuntimeAvailability>;
  healthCheck(context: ModelRuntimeContext): Promise<ModelRuntimeHealthResult>;
  generate(input: {
    context: ModelRuntimeContext;
    prompt: RuntimeModelPrompt;
  }): Promise<ModelRuntimeGenerationResult>;
}

export class ModelRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ModelRuntimeError";
  }
}

export interface BackendModelAdapterOptions {
  baseUrl: string;
  modelId: string;
  providerModel: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export function createBackendModelAdapter(
  options: BackendModelAdapterOptions
): ModelRuntimeAdapter {
  const baseUrl = normalizeBackendBaseUrl(options.baseUrl);
  const request = options.fetch ?? fetch;

  const invoke = async (
    prompt: string,
    signal?: AbortSignal,
    generation?: { maxTokens?: number; temperature?: number; runtimeOutput?: boolean }
  ): Promise<ModelRuntimeGenerationResult> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await request(new URL("/api/generate", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: options.providerModel,
          prompt,
          stream: false,
          ...(generation?.runtimeOutput ? { format: "json" } : {}),
          options: {
            temperature: generation?.temperature ?? 0.2,
            num_predict: generation?.maxTokens ?? 256
          }
        }),
        signal: controller.signal
      });
      const body = (await response.json().catch(() => null)) as {
        model?: unknown;
        response?: unknown;
        prompt_eval_count?: unknown;
        eval_count?: unknown;
        done_reason?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) {
        const detail =
          typeof body?.error === "string" ? body.error.slice(0, 240) : `HTTP ${response.status}`;
        throw new ModelRuntimeError(
          response.status === 404 ? "MODEL_NOT_LOADED" : "RUNTIME_UNAVAILABLE",
          `Backend inference failed: ${detail}`,
          response.status === 404 || response.status === 408 || response.status >= 500
        );
      }
      const rawText = typeof body?.response === "string" ? body.response.trim() : "";
      const text = generation?.runtimeOutput ? normalizeBackendModelText(rawText) : rawText;
      if (text.length === 0) {
        throw new ModelRuntimeError(
          "MALFORMED_MODEL_OUTPUT",
          "The backend model returned an empty or malformed response.",
          true
        );
      }
      if (
        typeof body?.model === "string" &&
        !providerModelMatches(body.model, options.providerModel)
      ) {
        throw new ModelRuntimeError(
          "MODEL_IDENTITY_MISMATCH",
          "The backend returned a response from a different model.",
          false
        );
      }
      return {
        text,
        modelId: options.modelId,
        provider: "ollama",
        executionTarget: "backend",
        ...(typeof body?.prompt_eval_count === "number"
          ? { promptTokens: body.prompt_eval_count }
          : {}),
        ...(typeof body?.eval_count === "number" ? { completionTokens: body.eval_count } : {}),
        latencyMs: Date.now() - startedAt,
        ...(typeof body?.done_reason === "string" ? { finishReason: body.done_reason } : {})
      };
    } catch (error) {
      if (error instanceof ModelRuntimeError) throw error;
      const aborted = controller.signal.aborted;
      throw new ModelRuntimeError(
        aborted ? "INFERENCE_TIMEOUT" : "RUNTIME_UNAVAILABLE",
        aborted ? "Backend inference timed out." : "The backend inference service is unavailable.",
        true,
        { cause: error }
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };

  return {
    provider: "ollama",
    executionTarget: "backend",
    async canRun(context) {
      if (context.modelId !== options.modelId) {
        return {
          available: false,
          errorCode: "MODEL_IDENTITY_MISMATCH",
          message: "This adapter does not serve the requested model."
        };
      }
      return { available: true, errorCode: null, message: null };
    },
    async healthCheck(context) {
      const startedAt = Date.now();
      const availability = await this.canRun(context);
      if (!availability.available) {
        return {
          ...availability,
          modelId: context.modelId,
          provider: this.provider,
          executionTarget: this.executionTarget,
          latencyMs: Date.now() - startedAt,
          responsePreview: null,
          retryable: false
        };
      }
      try {
        const result = await invoke("Reply with exactly: SOKO_MODEL_OK", context.signal, {
          maxTokens: 16,
          temperature: 0
        });
        const ok = normalizeHealthResponse(result.text).includes("SOKO_MODEL_OK");
        return {
          available: ok,
          modelId: result.modelId,
          provider: result.provider,
          executionTarget: result.executionTarget,
          latencyMs: result.latencyMs,
          responsePreview: result.text.slice(0, 120),
          errorCode: ok ? null : "MODEL_HEALTH_CHECK_FAILED",
          message: ok ? null : "The selected model did not return the readiness marker.",
          retryable: !ok
        };
      } catch (error) {
        const runtimeError = asModelRuntimeError(error);
        return {
          available: false,
          modelId: context.modelId,
          provider: this.provider,
          executionTarget: this.executionTarget,
          latencyMs: Date.now() - startedAt,
          responsePreview: null,
          errorCode: runtimeError.code,
          message: runtimeError.message,
          retryable: runtimeError.retryable
        };
      }
    },
    async generate({ context, prompt }) {
      const availability = await this.canRun(context);
      if (!availability.available) {
        throw new ModelRuntimeError(
          availability.errorCode ?? "RUNTIME_UNAVAILABLE",
          availability.message ?? "The model runtime is unavailable.",
          false
        );
      }
      return invoke(buildBackendPrompt(prompt), context.signal, { runtimeOutput: true });
    }
  };
}

export function createProviderModelAdapter(input: {
  modelId: string;
  provider: RuntimeModelProvider;
  executionTarget: "openai";
}): ModelRuntimeAdapter {
  return {
    provider: input.provider.name,
    executionTarget: input.executionTarget,
    async canRun(context) {
      if (context.modelId !== input.modelId) {
        return {
          available: false,
          errorCode: "MODEL_IDENTITY_MISMATCH",
          message: "This adapter does not serve the requested model."
        };
      }
      const diagnostic: RuntimeModelDiagnostic | undefined = await input.provider.diagnose?.(false);
      if (diagnostic !== undefined && diagnostic.status !== "ready") {
        return {
          available: false,
          errorCode: diagnostic.errorCode ?? "RUNTIME_UNAVAILABLE",
          message: "The configured provider is unavailable."
        };
      }
      return { available: true, errorCode: null, message: null };
    },
    async healthCheck(context) {
      const startedAt = Date.now();
      try {
        const completion = await input.provider.complete(healthPrompt());
        const preview = completion.outputText?.slice(0, 120) ?? null;
        const ok =
          completion.status === "available" &&
          completion.outputText !== null &&
          completion.outputText.includes("SOKO_MODEL_OK");
        return {
          available: ok,
          modelId: context.modelId,
          provider: completion.provider,
          executionTarget: input.executionTarget,
          latencyMs: completion.durationMs || Date.now() - startedAt,
          responsePreview: preview,
          errorCode: ok ? null : (completion.errorCode ?? "MODEL_HEALTH_CHECK_FAILED"),
          message: ok ? null : "The selected model did not pass its inference health check.",
          retryable: true
        };
      } catch (error) {
        const runtimeError = asModelRuntimeError(error);
        return {
          available: false,
          modelId: context.modelId,
          provider: input.provider.name,
          executionTarget: input.executionTarget,
          latencyMs: Date.now() - startedAt,
          responsePreview: null,
          errorCode: runtimeError.code,
          message: runtimeError.message,
          retryable: runtimeError.retryable
        };
      }
    },
    async generate({ context, prompt }) {
      const completion = await input.provider.complete(prompt);
      if (completion.status !== "available" || completion.outputText === null) {
        throw completionError(completion);
      }
      return {
        text: completion.outputText,
        modelId: context.modelId,
        provider: completion.provider,
        executionTarget: input.executionTarget,
        latencyMs: completion.durationMs
      };
    }
  };
}

export function runtimeProviderFromAdapter(input: {
  adapter: ModelRuntimeAdapter;
  context: Omit<ModelRuntimeContext, "signal">;
}): RuntimeModelProvider {
  return {
    name: input.adapter.provider as RuntimeModelProvider["name"],
    async complete(prompt) {
      const startedAt = Date.now();
      try {
        const result = await input.adapter.generate({ context: input.context, prompt });
        return {
          provider: result.provider as RuntimeModelCompletionResult["provider"],
          status: "available",
          outputText: result.text,
          durationMs: result.latencyMs,
          errorCode: null,
          metadata: {
            modelId: result.modelId,
            executionTarget: result.executionTarget,
            ...(result.promptTokens === undefined ? {} : { promptTokens: result.promptTokens }),
            ...(result.completionTokens === undefined
              ? {}
              : { completionTokens: result.completionTokens }),
            ...(result.finishReason === undefined ? {} : { finishReason: result.finishReason })
          }
        };
      } catch (error) {
        const runtimeError = asModelRuntimeError(error);
        return {
          provider: input.adapter.provider as RuntimeModelCompletionResult["provider"],
          status: runtimeError.code === "INFERENCE_TIMEOUT" ? "timeout" : "unavailable",
          outputText: null,
          durationMs: Date.now() - startedAt,
          errorCode: runtimeError.code,
          metadata: {
            modelId: input.context.modelId,
            executionTarget: input.adapter.executionTarget
          }
        };
      }
    }
  };
}

export function asModelRuntimeError(error: unknown): ModelRuntimeError {
  return error instanceof ModelRuntimeError
    ? error
    : new ModelRuntimeError(
        "RUNTIME_UNAVAILABLE",
        error instanceof Error ? error.message : "The model runtime is unavailable.",
        true,
        { cause: error }
      );
}

function healthPrompt(): RuntimeModelPrompt {
  return {
    message: "Reply with exactly: SOKO_MODEL_OK",
    context: {
      businessId: "health-check",
      userId: "health-check",
      role: "owner",
      productCount: 0,
      customerCount: 0,
      supplierCount: 0,
      invoiceCount: 0,
      openInvoiceCount: 0,
      paymentCount: 0,
      importJobCount: 0,
      logisticsCount: 0,
      activeLogisticsCount: 0,
      complianceExportCount: 0,
      scheduledDeletionCount: 0,
      verificationTier: "unverified",
      deviceTrustLevel: "unknown",
      betaAccessStatus: "not_invited",
      betaReadinessStatus: "blocked",
      openSupportTicketCount: 0,
      crashFreeSessionRate: 1,
      publicLaunchStatus: "closed",
      launchReadinessStatus: "blocked",
      openLaunchIncidentCount: 0,
      lowStockCount: 0,
      outstandingDebtTotal: 0,
      unreadNotificationCount: 0,
      knowledgeFactCount: 0
    },
    allowedTools: [],
    schemaVersion: "cp11-runtime-model-v1"
  };
}

function buildBackendPrompt(prompt: RuntimeModelPrompt): string {
  const tools = prompt.allowedTools.join(", ");
  const history = (prompt.conversationHistory ?? [])
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n");
  return [
    "You are the model behind the Soko agent runtime.",
    "Return only one JSON object. Do not include markdown or surrounding commentary.",
    'Allowed shapes: {"type":"tool","toolName":"products.list","input":{},"reason":"..."}',
    'or {"type":"clarification","message":"..."}',
    'or {"type":"response","message":"..."}.',
    `Allowed tools: ${tools || "none"}.`,
    ...(history.length === 0 ? [] : [`Recent conversation (oldest first):\n${history}`]),
    prompt.message
  ].join("\n");
}

function normalizeBackendBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BACKEND_INFERENCE_BASE_URL must use http or https.");
  }
  url.username = "";
  url.password = "";
  return url;
}

function providerModelMatches(actual: string, expected: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/:latest$/, "");
  return normalize(actual) === normalize(expected);
}

function normalizeHealthResponse(value: string): string {
  return value
    .replace(/[`"'.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeBackendModelText(content: string): string {
  if (content.length === 0) return content;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return content;
    const record = parsed as Record<string, unknown>;
    if (record.type === "tool") {
      return typeof record.toolName === "string" ? content : "";
    }
    if (record.type === "response" || record.type === "clarification") {
      return typeof record.message === "string" && record.message.trim().length > 0 ? content : "";
    }
    const message = ["message", "response", "content", "text", "answer"]
      .map((key) => record[key])
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return message === undefined
      ? content
      : JSON.stringify({ type: "response", message: message.trim() });
  } catch {
    return JSON.stringify({ type: "response", message: content });
  }
}

function completionError(completion: RuntimeModelCompletionResult): ModelRuntimeError {
  const code = completion.errorCode ?? "RUNTIME_UNAVAILABLE";
  return new ModelRuntimeError(
    code,
    code === "INFERENCE_TIMEOUT" ? "Inference timed out." : "The model provider is unavailable.",
    code !== "POLICY_DENIED"
  );
}
