import { timingSafeEqual } from "node:crypto";
import type {
  InferenceExecutionEvent,
  InferenceExecutionRequest,
  ResolvedModelArtifact
} from "@soko/shared-types";

import { downloadVerifiedArtifact } from "./artifact-loader.js";
import { generateWithHuggingFace, type HuggingFaceRuntimeConfig } from "./huggingface-runtime.js";
import { loadLlamaRuntime, type LoadedLlamaRuntime } from "./llama-runtime.js";
import { RuntimeCache } from "./runtime-cache.js";
import { InferenceServiceError } from "./service-error.js";

export interface VercelInferenceConfig {
  serviceToken: string;
  provider: "llama-cpp" | "huggingface";
  artifactAllowedHosts: ReadonlySet<string>;
  maximumArtifactBytes: number;
  maximumInputCharacters: number;
  maximumOutputTokens: number;
  cacheEntries: number;
  huggingFace:
    | (Omit<HuggingFaceRuntimeConfig, "modelId"> & {
        defaultModelId: string | null;
        models: ReadonlyMap<string, string>;
      })
    | null;
}

export interface VercelInferenceDependencies {
  cache?: RuntimeCache<LoadedLlamaRuntime>;
  downloadArtifact?: typeof downloadVerifiedArtifact;
  loadRuntime?: typeof loadLlamaRuntime;
  generateWithHuggingFace?: typeof generateWithHuggingFace;
  request?: typeof fetch;
  now?: () => number;
}

export function readVercelInferenceConfig(
  environment: NodeJS.ProcessEnv = process.env
): VercelInferenceConfig {
  const serviceToken = environment.SOKO_INFERENCE_SERVICE_TOKEN?.trim() ?? "";
  if (serviceToken.length < 32) {
    throw new Error("SOKO_INFERENCE_SERVICE_TOKEN must contain at least 32 characters.");
  }
  const provider = providerValue(environment.INFERENCE_PROVIDER);
  const hosts = (environment.MODEL_ARTIFACT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (provider === "llama-cpp" && hosts.length === 0) {
    throw new Error("MODEL_ARTIFACT_ALLOWED_HOSTS must contain at least one hostname.");
  }
  return {
    serviceToken,
    provider,
    artifactAllowedHosts: new Set(hosts),
    maximumArtifactBytes: positiveInteger(environment.VERCEL_MAX_ARTIFACT_BYTES, 450_000_000),
    maximumInputCharacters: positiveInteger(environment.INFERENCE_MAX_INPUT_CHARACTERS, 64_000),
    maximumOutputTokens: positiveInteger(environment.INFERENCE_MAX_OUTPUT_TOKENS, 512),
    cacheEntries: positiveInteger(environment.INFERENCE_RUNTIME_CACHE_ENTRIES, 1),
    huggingFace:
      provider === "huggingface"
        ? {
            token: requiredSecret(environment.HF_TOKEN, "HF_TOKEN"),
            defaultModelId: optionalText(environment.HF_MODEL_ID),
            models: huggingFaceModelMap(environment.HF_MODEL_MAP, environment.HF_MODEL_ID),
            baseUrl: optionalUrl(
              environment.HF_INFERENCE_BASE_URL,
              "https://router.huggingface.co/v1/"
            )
          }
        : null
  };
}

export function createVercelInferenceHandler(
  config: VercelInferenceConfig,
  dependencies: VercelInferenceDependencies = {}
): (request: Request) => Promise<Response> {
  const cache = dependencies.cache ?? new RuntimeCache<LoadedLlamaRuntime>(config.cacheEntries);
  const downloadArtifact = dependencies.downloadArtifact ?? downloadVerifiedArtifact;
  const loadRuntime = dependencies.loadRuntime ?? loadLlamaRuntime;
  const generateHf = dependencies.generateWithHuggingFace ?? generateWithHuggingFace;
  const now = dependencies.now ?? Date.now;

  return async (request) => {
    if (request.method !== "POST")
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST.", false);
    if (!validBearer(request.headers.get("authorization"), config.serviceToken)) {
      return errorResponse(
        401,
        "INFERENCE_AUTHENTICATION_FAILED",
        "Inference service authentication failed.",
        false
      );
    }
    const maximumBodyBytes = config.maximumInputCharacters * 4 + 8_192;
    const declaredBodyBytes = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredBodyBytes) && declaredBodyBytes > maximumBodyBytes) {
      return errorResponse(413, "INVALID_INFERENCE_REQUEST", "Request body is too large.", false);
    }
    let input: InferenceExecutionRequest;
    let huggingFaceModelId: string | null = null;
    try {
      input = parseRequest(await request.json(), config);
      huggingFaceModelId =
        config.provider === "huggingface"
          ? resolveHuggingFaceModel(config.huggingFace!, input.model.id)
          : null;
    } catch (error) {
      return serviceErrorResponse(error);
    }
    const startedAt = now();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: InferenceExecutionEvent) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        void (async () => {
          let firstTokenAt: number | null = null;
          try {
            emit({ type: "status", state: "INITIALIZING" });
            const loadStartedAt = now();
            const acquired =
              config.provider === "huggingface"
                ? null
                : await cache.acquire(
                    `${input.model.id}:${input.artifact.sha256 ?? input.artifact.id}`,
                    async () => {
                      emit({ type: "status", state: "MODEL_LOADING" });
                      const downloaded = await downloadArtifact({
                        artifact: input.artifact,
                        allowedHosts: config.artifactAllowedHosts,
                        maximumBytes: config.maximumArtifactBytes,
                        ...(dependencies.request === undefined
                          ? {}
                          : { request: dependencies.request }),
                        signal: request.signal
                      });
                      return loadRuntime(downloaded.path);
                    }
                  );
            const modelLoadMs = config.provider === "huggingface" ? 0 : now() - loadStartedAt;
            emit({ type: "status", state: "READY", cacheHit: acquired?.cacheHit ?? false });
            const inferenceStartedAt = now();
            const onText = (text: string) => {
              firstTokenAt ??= now();
              emit({ type: "delta", text });
            };
            const result =
              config.provider === "huggingface"
                ? await generateHf(
                    { ...config.huggingFace!, modelId: huggingFaceModelId! },
                    {
                      prompt: input.prompt,
                      maximumTokens: input.generation.maxTokens,
                      temperature: input.generation.temperature,
                      jsonOutput: input.generation.jsonOutput,
                      signal: request.signal,
                      onText
                    },
                    dependencies.request
                  )
                : await acquired!.runtime.generate({
                    prompt: input.prompt,
                    maximumTokens: input.generation.maxTokens,
                    temperature: input.generation.temperature,
                    signal: request.signal,
                    onText
                  });
            const completedAt = now();
            const cacheHit = acquired?.cacheHit ?? false;
            const metrics = {
              modelDownloadMs: cacheHit ? 0 : modelLoadMs,
              modelLoadMs,
              firstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
              inferenceMs: completedAt - inferenceStartedAt,
              totalMs: completedAt - startedAt,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              cacheHit
            };
            emit({
              type: "result",
              requestId: input.requestId,
              text: result.text,
              finishReason: result.finishReason,
              usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
              metrics
            });
            console.info(
              JSON.stringify({
                event: "inference.completed",
                requestId: input.requestId,
                conversationId: input.conversationId,
                runtimeBindingId: input.runtimeBindingId,
                agentId: input.agent.id,
                modelId: input.model.id,
                artifactId: input.artifact.id,
                executionHostId: input.executionHostId,
                ...metrics
              })
            );
          } catch (error) {
            const normalized = normalizeError(error);
            emit({
              type: "error",
              code: normalized.code,
              message: normalized.message,
              retryable: normalized.retryable
            });
          } finally {
            controller.close();
          }
        })();
      },
      cancel() {
        // Request.signal is propagated into download and generation by the platform.
      }
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-content-type-options": "nosniff",
        "x-request-id": input.requestId
      }
    });
  };
}

/**
 * Bare process/function liveness. Deliberately takes no configuration and cannot fail because of
 * environment misconfiguration - it answers "is this Vercel function executing at all", nothing
 * about whether inference can actually run. See createVercelReadyHandler for that.
 */
export function createVercelHealthHandler(): () => Response {
  return () =>
    Response.json(
      { ok: true, service: "soko-ai-runtime" },
      { headers: { "cache-control": "no-store" } }
    );
}

/**
 * Reports whether this function's own preconditions for serving inference are satisfied:
 * configuration parses (service token, artifact host allowlist, size/token limits). It does NOT
 * report per-model or per-artifact readiness - `/v1/inference` is a standalone Vercel serverless
 * function with its own memory, so this process can never observe whether a model is warm in the
 * function serving `/v1/inference`, and there is no fixed "the" model to preload (Render resolves
 * and sends the artifact per request; Vercel is not a model registry). It also never triggers a
 * model download/load - probing readiness must stay cheap. Real per-request model readiness is
 * proven end-to-end by Render's `/health/ai`, which performs an actual signed-artifact inference
 * call (see docs/deployment/vercel-inference.md).
 */
export function createVercelReadyHandler(
  environment: NodeJS.ProcessEnv = process.env
): () => Response {
  return () => {
    let config: VercelInferenceConfig;
    try {
      config = readVercelInferenceConfig(environment);
    } catch (error) {
      return Response.json(
        {
          ok: false,
          ready: false,
          service: "soko-ai-runtime",
          reason: error instanceof Error ? error.message : "Configuration is invalid."
        },
        { status: 503, headers: { "cache-control": "no-store" } }
      );
    }
    return Response.json(
      {
        ok: true,
        ready: true,
        service: "soko-ai-runtime",
        configured: true,
        capabilities: {
          formats: config.provider === "huggingface" ? ["huggingface-chat-completions"] : ["gguf"],
          streaming: true,
          harnesses: ["pi"]
        },
        provider: config.provider,
        huggingFaceModel: config.huggingFace?.defaultModelId ?? null,
        huggingFaceModels:
          config.huggingFace === null ? null : Object.fromEntries(config.huggingFace.models),
        artifactHosts: config.artifactAllowedHosts.size,
        maximumOutputTokens: config.maximumOutputTokens,
        cacheCapacity: config.cacheEntries
      },
      { headers: { "cache-control": "no-store" } }
    );
  };
}

function parseRequest(value: unknown, config: VercelInferenceConfig): InferenceExecutionRequest {
  if (!record(value)) throw invalid("Request body must be an object.");
  const requestId = identifier(value.requestId, "requestId");
  const conversationId = identifier(value.conversationId, "conversationId");
  const runtimeBindingId = identifier(value.runtimeBindingId, "runtimeBindingId");
  const executionHostId = identifier(value.executionHostId, "executionHostId");
  if (
    !record(value.agent) ||
    !record(value.model) ||
    !record(value.artifact) ||
    !record(value.generation)
  ) {
    throw invalid("agent, model, artifact and generation are required.");
  }
  const agentId = identifier(value.agent.id, "agent.id");
  const adapterId = identifier(value.agent.adapterId, "agent.adapterId");
  if (adapterId !== "pi") {
    throw new InferenceServiceError(
      "AGENT_INITIALIZATION_FAILED",
      "The requested agent harness is unsupported.",
      false,
      422
    );
  }
  const modelId = identifier(value.model.id, "model.id");
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  if (prompt === "" || prompt.length > config.maximumInputCharacters) {
    throw invalid("prompt is empty or too large.");
  }
  const artifact = parseArtifact(value.artifact);
  if (artifact.modelId !== modelId) throw invalid("artifact.modelId must match model.id.");
  const maxTokens = positiveIntegerValue(value.generation.maxTokens, "generation.maxTokens");
  if (maxTokens > config.maximumOutputTokens) throw invalid("generation.maxTokens is too large.");
  const temperature = value.generation.temperature;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    throw invalid("generation.temperature is invalid.");
  }
  if (value.generation.jsonOutput !== true && value.generation.jsonOutput !== false) {
    throw invalid("generation.jsonOutput must be boolean.");
  }
  return {
    requestId,
    conversationId,
    runtimeBindingId,
    executionHostId,
    agent: { id: agentId, adapterId },
    model: {
      id: modelId,
      runtimeContractVersion: identifier(
        value.model.runtimeContractVersion,
        "model.runtimeContractVersion"
      )
    },
    artifact,
    prompt,
    generation: { maxTokens, temperature, jsonOutput: value.generation.jsonOutput }
  };
}

function parseArtifact(value: Record<string, unknown>): ResolvedModelArtifact {
  const nullableText = (field: string) =>
    value[field] === null ? null : identifier(value[field], `artifact.${field}`);
  const sizeBytes =
    value.sizeBytes === null ? null : positiveIntegerValue(value.sizeBytes, "artifact.sizeBytes");
  const status = value.status;
  if (status !== "available") throw invalid("artifact.status must be available.");
  return {
    id: identifier(value.id, "artifact.id"),
    modelId: identifier(value.modelId, "artifact.modelId"),
    storageProvider: identifier(value.storageProvider, "artifact.storageProvider"),
    bucket: identifier(value.bucket, "artifact.bucket"),
    objectKey: identifier(value.objectKey, "artifact.objectKey"),
    format: identifier(value.format, "artifact.format"),
    quantization: nullableText("quantization"),
    sizeBytes,
    sha256: nullableText("sha256"),
    contentType: identifier(value.contentType, "artifact.contentType"),
    status,
    createdAt: isoTimestamp(value.createdAt, "artifact.createdAt"),
    updatedAt: isoTimestamp(value.updatedAt, "artifact.updatedAt"),
    downloadUrl: urlString(value.downloadUrl, "artifact.downloadUrl"),
    expiresAt: isoTimestamp(value.expiresAt, "artifact.expiresAt")
  };
}

export function validBearer(header: string | null, expected: string): boolean {
  if (header === null || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const target = Buffer.from(expected, "utf8");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function serviceErrorResponse(error: unknown): Response {
  const normalized = normalizeError(error);
  return errorResponse(
    normalized.status,
    normalized.code,
    normalized.message,
    normalized.retryable
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean
): Response {
  return Response.json(
    { ok: false, error: { code, message, retryable } },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } }
  );
}

function normalizeError(error: unknown): InferenceServiceError {
  return error instanceof InferenceServiceError
    ? error
    : new InferenceServiceError("INFERENCE_FAILED", "Inference failed.", true, 500, {
        cause: error
      });
}

function invalid(message: string): InferenceServiceError {
  return new InferenceServiceError("INVALID_INFERENCE_REQUEST", message, false, 400);
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 500 ||
    // eslint-disable-next-line no-control-regex -- deliberately rejects control characters
    /[\u0000-\u001f]/u.test(value)
  ) {
    throw invalid(`${name} is invalid.`);
  }
  return value;
}

function isoTimestamp(value: unknown, name: string): string {
  const text = identifier(value, name);
  if (!Number.isFinite(Date.parse(text))) throw invalid(`${name} is invalid.`);
  return text;
}

function urlString(value: unknown, name: string): string {
  const text = identifier(value, name);
  try {
    return new URL(text).toString();
  } catch {
    throw invalid(`${name} is invalid.`);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  return positiveIntegerValue(Number(value), "configuration value");
}

function providerValue(value: string | undefined): VercelInferenceConfig["provider"] {
  const normalized = value?.trim().toLowerCase() || "llama-cpp";
  if (normalized === "llama-cpp" || normalized === "huggingface") return normalized;
  throw new Error("INFERENCE_PROVIDER must be either llama-cpp or huggingface.");
}

function requiredSecret(value: string | undefined, name: string): string {
  const text = requiredText(value, name);
  if (text.length < 8) throw new Error(`${name} must be configured.`);
  return text;
}

function requiredText(value: string | undefined, name: string): string {
  const text = value?.trim() ?? "";
  if (text === "") throw new Error(`${name} must be configured.`);
  return text;
}

function optionalText(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

function huggingFaceModelMap(
  value: string | undefined,
  fallbackModelId: string | undefined
): ReadonlyMap<string, string> {
  const text = value?.trim() ?? "";
  if (text === "") {
    if (optionalText(fallbackModelId) === null) {
      throw new Error("HF_MODEL_MAP or HF_MODEL_ID must be configured.");
    }
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "HF_MODEL_MAP must be a JSON object of Soko model IDs to Hugging Face model IDs."
    );
  }
  if (!record(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("HF_MODEL_MAP must contain at least one model mapping.");
  }
  const models = new Map<string, string>();
  for (const [sokoModelId, huggingFaceModelId] of Object.entries(parsed)) {
    if (
      sokoModelId.trim() === "" ||
      typeof huggingFaceModelId !== "string" ||
      huggingFaceModelId.trim() === ""
    ) {
      throw new Error("HF_MODEL_MAP keys and values must be non-empty strings.");
    }
    models.set(sokoModelId, huggingFaceModelId.trim());
  }
  return models;
}

function resolveHuggingFaceModel(
  config: NonNullable<VercelInferenceConfig["huggingFace"]>,
  requestedModelId: string
): string {
  const modelId = config.models.get(requestedModelId) ?? config.defaultModelId;
  if (modelId !== null) return modelId;
  throw new InferenceServiceError(
    "MODEL_NOT_FOUND",
    `No Hugging Face model is configured for ${requestedModelId}.`,
    false,
    422
  );
}

function optionalUrl(value: string | undefined, fallback: string): string {
  const text = value?.trim() || fallback;
  return new URL(text).toString();
}

function positiveIntegerValue(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid(`${name} must be a positive integer.`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
