import { randomUUID } from "node:crypto";
import type {
  InferenceExecutionEvent,
  InferenceExecutionRequest,
  ModelExecutionTarget,
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";
import { renderRuntimeModelOutputInstructions } from "@soko/tool-core";

import type { ModelArtifactStore } from "./model-artifact-store.js";

export interface ModelRuntimeContext {
  agentId: string;
  agentAdapterId?: string;
  shopId: string;
  modelId: string;
  conversationId?: string;
  runtimeBindingId?: string;
  executionHostId?: string;
  runtimeContractVersion?: string;
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

export interface VercelInferenceClient {
  health(signal?: AbortSignal): Promise<void>;
  infer(
    request: InferenceExecutionRequest,
    options?: { signal?: AbortSignal; onDelta?: (text: string) => void }
  ): Promise<Extract<InferenceExecutionEvent, { type: "result" }>>;
}

export function createVercelInferenceClient(options: {
  baseUrl: string;
  serviceToken: string;
  timeoutMs: number;
  request?: typeof fetch;
}): VercelInferenceClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl, "VERCEL_INFERENCE_URL");
  if (options.serviceToken.length < 32) throw new Error("Inference service token is too short.");
  const invoke = async (path: string, init: RequestInit, signal?: AbortSignal) => {
    const controller = new AbortController();
    let externallyAborted = signal?.aborted === true;
    const abort = () => {
      externallyAborted = true;
      controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await (options.request ?? fetch)(new URL(path, baseUrl), {
        ...init,
        headers: {
          accept: "application/x-ndjson, application/json",
          authorization: `Bearer ${options.serviceToken}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers
        },
        signal: controller.signal,
        credentials: "omit"
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ModelRuntimeError(
          externallyAborted ? "INFERENCE_CANCELLED" : "INFERENCE_TIMEOUT",
          externallyAborted ? "Inference was cancelled." : "Vercel inference timed out.",
          true,
          { cause: error }
        );
      }
      throw new ModelRuntimeError(
        "INFERENCE_SERVICE_UNREACHABLE",
        "Vercel inference is unreachable.",
        true,
        { cause: error }
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
  return {
    async health(signal) {
      const response = await invoke("/health", { method: "GET" }, signal);
      if (!response.ok)
        throw responseError(response.status, await response.json().catch(() => null));
    },
    async infer(request, callOptions = {}) {
      const response = await invoke(
        "/v1/inference",
        { method: "POST", body: JSON.stringify(request) },
        callOptions.signal
      );
      if (!response.ok)
        throw responseError(response.status, await response.json().catch(() => null));
      if (response.body === null) {
        throw new ModelRuntimeError(
          "INVALID_INFERENCE_RESPONSE",
          "Vercel returned no stream.",
          true
        );
      }
      let buffer = "";
      let result: Extract<InferenceExecutionEvent, { type: "result" }> | null = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim() === "") continue;
            const event = parseEvent(line);
            if (event.type === "delta") callOptions.onDelta?.(event.text);
            if (event.type === "error") {
              throw new ModelRuntimeError(event.code, event.message, event.retryable);
            }
            if (event.type === "result") result = event;
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (buffer.trim() !== "") {
        const event = parseEvent(buffer);
        if (event.type === "result") result = event;
        if (event.type === "error")
          throw new ModelRuntimeError(event.code, event.message, event.retryable);
      }
      if (result === null || result.requestId !== request.requestId || result.text.trim() === "") {
        throw new ModelRuntimeError(
          "INVALID_INFERENCE_RESPONSE",
          "Vercel returned an invalid result.",
          true
        );
      }
      return result;
    }
  };
}

export function createVercelModelAdapter(input: {
  modelId: string;
  artifactStore: ModelArtifactStore;
  client: VercelInferenceClient;
}): ModelRuntimeAdapter {
  return {
    provider: "llama.cpp",
    executionTarget: "vercel",
    async canRun(context) {
      if (context.modelId !== input.modelId) {
        return {
          available: false,
          errorCode: "MODEL_IDENTITY_MISMATCH",
          message: "The adapter does not serve this model."
        };
      }
      try {
        const artifact = await input.artifactStore.resolveArtifact(context.modelId);
        const verification = await input.artifactStore.verifyArtifact(artifact, context.signal);
        if (!verification.ok) {
          return {
            available: false,
            errorCode: verification.errorCode,
            message: "The model artifact is unavailable."
          };
        }
        await input.client.health(context.signal);
        return { available: true, errorCode: null, message: null };
      } catch (error) {
        const normalized = asModelRuntimeError(error);
        return { available: false, errorCode: normalized.code, message: normalized.message };
      }
    },
    async healthCheck(context) {
      const startedAt = Date.now();
      const availability = await this.canRun(context);
      return {
        ...availability,
        modelId: context.modelId,
        provider: this.provider,
        executionTarget: this.executionTarget,
        latencyMs: Date.now() - startedAt,
        responsePreview: null,
        retryable: availability.available || availability.errorCode === "ARTIFACT_NOT_FOUND"
      };
    },
    async generate({ context, prompt }) {
      const startedAt = Date.now();
      const artifact = await input.artifactStore.resolveArtifact(context.modelId);
      const resolvedArtifact = await input.artifactStore.createDownloadUrl(artifact);
      const requestId = randomUUID();
      const result = await input.client.infer(
        {
          requestId,
          conversationId: context.conversationId ?? `runtime:${context.shopId}`,
          runtimeBindingId: context.runtimeBindingId ?? "runtime-unbound",
          executionHostId: context.executionHostId ?? "builtin:vercel-inference:v1",
          agent: { id: context.agentId, adapterId: context.agentAdapterId ?? "pi" },
          model: {
            id: context.modelId,
            runtimeContractVersion: context.runtimeContractVersion ?? "1"
          },
          artifact: resolvedArtifact,
          prompt: buildInferencePrompt(prompt),
          generation: { maxTokens: 256, temperature: 0.2, jsonOutput: true }
        },
        { ...(context.signal === undefined ? {} : { signal: context.signal }) }
      );
      const text = normalizeModelText(result.text);
      if (text === "")
        throw new ModelRuntimeError(
          "INVALID_INFERENCE_RESPONSE",
          "The model returned malformed output.",
          true
        );
      return {
        text,
        modelId: context.modelId,
        provider: "llama.cpp",
        executionTarget: "vercel",
        ...(result.usage.inputTokens === null ? {} : { promptTokens: result.usage.inputTokens }),
        ...(result.usage.outputTokens === null
          ? {}
          : { completionTokens: result.usage.outputTokens }),
        latencyMs: Date.now() - startedAt,
        ...(result.finishReason === null ? {} : { finishReason: result.finishReason }),
        inferenceRequestId: requestId
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
    async complete(prompt, signal) {
      const startedAt = Date.now();
      try {
        const result = await input.adapter.generate({
          context: { ...input.context, ...(signal === undefined ? {} : { signal }) },
          prompt
        });
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
            ...(result.inferenceRequestId === undefined
              ? {}
              : { inferenceRequestId: result.inferenceRequestId })
          }
        };
      } catch (error) {
        const normalized = asModelRuntimeError(error);
        return {
          provider: input.adapter.provider as RuntimeModelCompletionResult["provider"],
          status: normalized.code === "INFERENCE_TIMEOUT" ? "timeout" : "unavailable",
          outputText: null,
          durationMs: Date.now() - startedAt,
          errorCode: normalized.code,
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

function buildInferencePrompt(prompt: RuntimeModelPrompt): string {
  const history = (prompt.conversationHistory ?? [])
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n");
  return [
    "You are the model behind the Soko agent runtime.",
    renderRuntimeModelOutputInstructions(prompt.allowedTools),
    ...(history === "" ? [] : [`Recent conversation (oldest first):\n${history}`]),
    prompt.message
  ].join("\n");
}

function parseEvent(line: string): InferenceExecutionEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ModelRuntimeError(
      "INVALID_INFERENCE_RESPONSE",
      "Vercel returned malformed stream data.",
      true
    );
  }
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    throw new ModelRuntimeError(
      "INVALID_INFERENCE_RESPONSE",
      "Vercel returned malformed stream data.",
      true
    );
  }
  return parsed as InferenceExecutionEvent;
}

function responseError(status: number, body: unknown): ModelRuntimeError {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  return new ModelRuntimeError(
    typeof record.code === "string"
      ? record.code
      : status === 401
        ? "INFERENCE_AUTHENTICATION_FAILED"
        : "INFERENCE_SERVICE_UNAVAILABLE",
    typeof record.message === "string" ? record.message : "Vercel inference rejected the request.",
    typeof record.retryable === "boolean" ? record.retryable : status >= 500
  );
}

function normalizeBaseUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && url.protocol === "http:")
  ) {
    throw new Error(`${name} must use https.`);
  }
  if (url.username !== "" || url.password !== "")
    throw new Error(`${name} must not include credentials.`);
  return url;
}

function normalizeModelText(content: string): string {
  if (content.trim() === "") return "";
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.type === "tool" && typeof parsed.toolName === "string") return content;
    if (
      (parsed.type === "response" || parsed.type === "clarification") &&
      typeof parsed.message === "string"
    )
      return content;
    if (typeof parsed.toolName === "string") return JSON.stringify({ ...parsed, type: "tool" });
    const message = [
      parsed.message,
      parsed.response,
      parsed.content,
      parsed.text,
      parsed.answer
    ].find((value): value is string => typeof value === "string" && value.trim() !== "");
    return message === undefined
      ? content
      : JSON.stringify({ type: "response", message: message.trim() });
  } catch {
    return JSON.stringify({ type: "response", message: content.trim() });
  }
}
