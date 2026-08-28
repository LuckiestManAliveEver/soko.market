import { randomUUID } from "node:crypto";
import type {
  ModelExecutionTarget,
  RuntimeModelCompletionResult,
  RuntimeModelDiagnostic,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";
import { resolveRuntimeModel } from "@soko/shared-types";
import { renderRuntimeModelOutputInstructions } from "@soko/tool-core";

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
  providerModelId?: string;
  inferenceRequestId?: string;
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
  serviceToken: string;
  connectTimeoutMs: number;
  timeoutMs: number;
  fetch?: typeof fetch;
  requestId?: () => string;
}

export function createBackendModelAdapter(
  options: BackendModelAdapterOptions
): ModelRuntimeAdapter {
  const baseUrl = normalizeBackendBaseUrl(options.baseUrl);
  const runtimeModel = resolveRuntimeModel(options.modelId);
  if (runtimeModel === null) {
    throw new Error(`No canonical runtime mapping exists for model ${options.modelId}.`);
  }
  const request = options.fetch ?? fetch;
  const client = createBackendInferenceClient({
    baseUrl,
    serviceToken: options.serviceToken,
    connectTimeoutMs: options.connectTimeoutMs,
    timeoutMs: options.timeoutMs,
    request,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId })
  });

  return {
    provider: runtimeModel.provider,
    executionTarget: "backend",
    async canRun(context) {
      if (context.modelId !== options.modelId) {
        return {
          available: false,
          errorCode: "MODEL_IDENTITY_MISMATCH",
          message: "This adapter does not serve the requested model."
        };
      }
      try {
        const readiness = await client.getReadiness(context.signal);
        const model = readiness.models.find((candidate) => candidate.id === context.modelId);
        if (model !== undefined && model.providerModelId !== runtimeModel.providerModelId) {
          return {
            available: false,
            errorCode: "MODEL_IDENTITY_MISMATCH",
            message: "The inference service reported an unexpected provider model."
          };
        }
        return model?.available === true
          ? { available: true, errorCode: null, message: null }
          : {
              available: false,
              errorCode: "MODEL_NOT_INSTALLED",
              message: "The model is not installed on the inference service."
            };
      } catch (error) {
        const runtimeError = asModelRuntimeError(error);
        return {
          available: false,
          errorCode: runtimeError.code,
          message: runtimeError.message
        };
      }
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
        const result = await client.probeModel(context.modelId, context.signal);
        if (result.providerModelId !== runtimeModel.providerModelId) {
          throw new ModelRuntimeError(
            "MODEL_IDENTITY_MISMATCH",
            "The inference service probed an unexpected provider model.",
            false
          );
        }
        return {
          available: true,
          modelId: context.modelId,
          provider: result.engine,
          executionTarget: "backend",
          latencyMs: result.latencyMs,
          responsePreview: "SOKO_MODEL_OK",
          errorCode: null,
          message: null,
          retryable: false
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
          availability.errorCode ?? "INFERENCE_SERVICE_UNREACHABLE",
          availability.message ?? "The model runtime is unavailable.",
          true
        );
      }
      const result = await client.generate(
        {
          modelId: context.modelId,
          prompt: buildBackendPrompt(prompt),
          maxTokens: 256,
          temperature: 0.2,
          jsonOutput: true
        },
        context.signal
      );
      if (result.providerModelId !== runtimeModel.providerModelId) {
        throw new ModelRuntimeError(
          "MODEL_IDENTITY_MISMATCH",
          "The inference service generated with an unexpected provider model.",
          false
        );
      }
      const text = normalizeBackendModelText(result.text);
      if (text.length === 0) {
        throw new ModelRuntimeError(
          "INVALID_INFERENCE_RESPONSE",
          "The inference service returned malformed model output.",
          true
        );
      }
      return {
        text,
        modelId: result.modelId,
        provider: result.engine,
        executionTarget: "backend",
        ...(result.usage.promptTokens === null ? {} : { promptTokens: result.usage.promptTokens }),
        ...(result.usage.completionTokens === null
          ? {}
          : { completionTokens: result.usage.completionTokens }),
        latencyMs: result.latencyMs,
        ...(result.finishReason === null ? {} : { finishReason: result.finishReason }),
        providerModelId: result.providerModelId,
        inferenceRequestId: result.id
      };
    }
  };
}

export interface BackendInferenceReadiness {
  ok: true;
  engine: string;
  models: BackendInferenceModel[];
}

export interface BackendInferenceModel {
  id: string;
  providerModelId: string;
  available: boolean;
  digest: string | null;
}

export interface BackendInferenceClient {
  getReadiness(signal?: AbortSignal): Promise<BackendInferenceReadiness>;
  listModels(signal?: AbortSignal): Promise<BackendInferenceModel[]>;
  probeModel(
    modelId: string,
    signal?: AbortSignal
  ): Promise<{
    ok: true;
    modelId: string;
    providerModelId: string;
    engine: string;
    latencyMs: number;
  }>;
  generate(
    input: {
      modelId: string;
      prompt: string;
      maxTokens: number;
      temperature: number;
      jsonOutput: boolean;
    },
    signal?: AbortSignal
  ): Promise<{
    ok: true;
    id: string;
    modelId: string;
    providerModelId: string;
    engine: string;
    text: string;
    latencyMs: number;
    usage: { promptTokens: number | null; completionTokens: number | null };
    finishReason: string | null;
  }>;
}

export function createBackendInferenceClient(options: {
  baseUrl: URL;
  serviceToken: string;
  connectTimeoutMs: number;
  timeoutMs: number;
  request: typeof fetch;
  requestId?: () => string;
}): BackendInferenceClient {
  const invoke = async (input: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
    retryReadiness?: boolean;
  }): Promise<unknown> => {
    const attempts = input.retryReadiness === true ? 2 : 1;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await inferenceRequest(options, input);
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= attempts || !(error instanceof ModelRuntimeError) || !error.retryable) {
          throw error;
        }
      }
    }
    throw lastError;
  };

  return {
    async getReadiness(signal) {
      const body = await invoke({
        path: "/health/ready",
        ...(signal === undefined ? {} : { signal }),
        retryReadiness: true
      });
      return parseModelListResponse(body);
    },
    async listModels(signal) {
      const body = await invoke({
        path: "/v1/models",
        ...(signal === undefined ? {} : { signal })
      });
      return parseModelListResponse(body).models;
    },
    async probeModel(modelId, signal) {
      const body = await invoke({
        path: `/v1/models/${encodeURIComponent(modelId)}/probe`,
        method: "POST",
        ...(signal === undefined ? {} : { signal })
      });
      if (
        !isRecord(body) ||
        body.ok !== true ||
        body.modelId !== modelId ||
        typeof body.providerModelId !== "string" ||
        typeof body.engine !== "string" ||
        typeof body.latencyMs !== "number"
      ) {
        throw invalidInferenceResponse();
      }
      return {
        ok: true,
        modelId,
        providerModelId: body.providerModelId,
        engine: body.engine,
        latencyMs: body.latencyMs
      };
    },
    async generate(input, signal) {
      const body = await invoke({
        path: "/v1/chat/completions",
        method: "POST",
        body: input,
        ...(signal === undefined ? {} : { signal })
      });
      if (
        !isRecord(body) ||
        body.ok !== true ||
        typeof body.id !== "string" ||
        body.modelId !== input.modelId ||
        typeof body.providerModelId !== "string" ||
        typeof body.engine !== "string" ||
        typeof body.text !== "string" ||
        body.text.trim() === "" ||
        typeof body.latencyMs !== "number" ||
        !isRecord(body.usage)
      ) {
        throw invalidInferenceResponse();
      }
      const promptTokens = nullableNumber(body.usage.promptTokens);
      const completionTokens = nullableNumber(body.usage.completionTokens);
      if (promptTokens === undefined || completionTokens === undefined) {
        throw invalidInferenceResponse();
      }
      return {
        ok: true,
        id: body.id,
        modelId: input.modelId,
        providerModelId: body.providerModelId,
        engine: body.engine,
        text: body.text,
        latencyMs: body.latencyMs,
        usage: { promptTokens, completionTokens },
        finishReason: typeof body.finishReason === "string" ? body.finishReason : null
      };
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
          completion.outputText.trim().length > 0;
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
            ...(result.finishReason === undefined ? {} : { finishReason: result.finishReason }),
            ...(result.providerModelId === undefined
              ? {}
              : { providerModelId: result.providerModelId }),
            ...(result.inferenceRequestId === undefined
              ? {}
              : { inferenceRequestId: result.inferenceRequestId })
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
  const history = (prompt.conversationHistory ?? [])
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n");
  return [
    "You are the model behind the Soko agent runtime.",
    renderRuntimeModelOutputInstructions(prompt.allowedTools),
    ...(history.length === 0 ? [] : [`Recent conversation (oldest first):\n${history}`]),
    prompt.message
  ].join("\n");
}

function normalizeBackendBaseUrl(value: string): URL {
  const normalized = /^[a-z][a-z0-9+.-]*:\/\//iu.test(value.trim())
    ? value.trim()
    : `http://${value.trim()}`;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BACKEND_INFERENCE_BASE_URL must use http or https.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("BACKEND_INFERENCE_BASE_URL must not include credentials.");
  }
  return url;
}

async function inferenceRequest(
  options: {
    baseUrl: URL;
    serviceToken: string;
    connectTimeoutMs: number;
    timeoutMs: number;
    request: typeof fetch;
    requestId?: () => string;
  },
  input: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  }
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutKind: "connect" | "request" | null = null;
  const requestTimeout = setTimeout(() => {
    timeoutKind = "request";
    controller.abort();
  }, options.timeoutMs);
  const connectTimeout = setTimeout(() => {
    timeoutKind = "connect";
    controller.abort();
  }, options.connectTimeoutMs);
  let externallyAborted = input.signal?.aborted === true;
  const abort = () => {
    externallyAborted = true;
    controller.abort(input.signal?.reason);
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (externallyAborted) controller.abort(input.signal?.reason);
  try {
    const response = await options.request(new URL(input.path, options.baseUrl), {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.serviceToken}`,
        "content-type": "application/json",
        "x-request-id": options.requestId?.() ?? randomUUID()
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: controller.signal,
      credentials: "omit"
    });
    clearTimeout(connectTimeout);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : null;
      const serviceCode = typeof error?.code === "string" ? error.code : null;
      const code =
        response.status === 401
          ? "INFERENCE_AUTHENTICATION_FAILED"
          : normalizeServiceErrorCode(serviceCode);
      const message =
        typeof error?.message === "string"
          ? error.message.slice(0, 240)
          : "The inference service rejected the request.";
      throw new ModelRuntimeError(
        code,
        message,
        typeof error?.retryable === "boolean"
          ? error.retryable
          : response.status === 408 || response.status === 429 || response.status >= 500
      );
    }
    if (body === null) throw invalidInferenceResponse();
    return body;
  } catch (error) {
    if (error instanceof ModelRuntimeError) throw error;
    if (controller.signal.aborted) {
      throw new ModelRuntimeError(
        externallyAborted ? "INFERENCE_CANCELLED" : "INFERENCE_TIMEOUT",
        externallyAborted
          ? "The inference request was cancelled because the client disconnected."
          : timeoutKind === "connect"
            ? "The inference service connection timed out."
            : "The inference request timed out.",
        true,
        { cause: error }
      );
    }
    throw new ModelRuntimeError(
      "INFERENCE_SERVICE_UNREACHABLE",
      "The inference service is unreachable.",
      true,
      { cause: error }
    );
  } finally {
    clearTimeout(connectTimeout);
    clearTimeout(requestTimeout);
    input.signal?.removeEventListener("abort", abort);
  }
}

function normalizeServiceErrorCode(code: string | null): string {
  return code !== null &&
    new Set([
      "INFERENCE_TIMEOUT",
      "INFERENCE_ENGINE_UNREACHABLE",
      "MODEL_NOT_INSTALLED",
      "MODEL_LOADING",
      "MODEL_PROBE_FAILED",
      "MODEL_GENERATION_FAILED",
      "INVALID_INFERENCE_RESPONSE",
      "MODEL_STORAGE_NOT_DURABLE",
      "MODEL_NOT_CONFIGURED"
    ]).has(code)
    ? code
    : "MODEL_GENERATION_FAILED";
}

function invalidInferenceResponse(): ModelRuntimeError {
  return new ModelRuntimeError(
    "INVALID_INFERENCE_RESPONSE",
    "The inference service returned an invalid response.",
    true
  );
}

function parseModelListResponse(body: unknown): BackendInferenceReadiness {
  if (
    !isRecord(body) ||
    body.ok !== true ||
    typeof body.engine !== "string" ||
    !Array.isArray(body.models)
  ) {
    throw invalidInferenceResponse();
  }
  const models = body.models.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.providerModelId !== "string" ||
      typeof candidate.available !== "boolean"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        providerModelId: candidate.providerModelId,
        available: candidate.available,
        digest: typeof candidate.digest === "string" ? candidate.digest : null
      }
    ];
  });
  if (models.length !== body.models.length) throw invalidInferenceResponse();
  return { ok: true, engine: body.engine, models };
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null
    ? null
    : typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
