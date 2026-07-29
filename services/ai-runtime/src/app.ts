import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { resolveRuntimeModel, runtimeModels } from "@soko/shared-types";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  InferenceEngineError,
  createOllamaInferenceEngine,
  type InferenceEngine
} from "./inference-engine.js";
import { readInferenceServiceConfig, type InferenceServiceConfig } from "./runtime-config.js";
export {
  buildLlamaPrompt,
  createLlamaCppRuntimeModelProvider,
  type LlamaCppRuntimeModelOptions
} from "./local-model.js";
export {
  createOpenAiRuntimeModelProvider,
  type OpenAiRuntimeModelOptions
} from "./openai-model.js";
export {
  createOllamaRuntimeModelProvider,
  normalizeOllamaModelText,
  type OllamaRuntimeModelOptions
} from "./ollama-model.js";

interface ChatCompletionBody {
  modelId?: unknown;
  prompt?: unknown;
  maxTokens?: unknown;
  temperature?: unknown;
  jsonOutput?: unknown;
}

interface ModelParams {
  modelId: string;
}

export function buildAiRuntime(
  options: {
    config?: InferenceServiceConfig;
    engine?: InferenceEngine;
  } = {}
) {
  const config = options.config ?? readInferenceServiceConfig();
  const engine =
    options.engine ??
    createOllamaInferenceEngine({
      baseUrl: config.engineBaseUrl,
      timeoutMs: config.requestTimeoutMs
    });
  const app = Fastify({
    logger: true,
    bodyLimit: Math.max(64_000, config.maximumInputCharacters * 2)
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestId = readCorrelationId(request) ?? randomUUID();
    request.headers["x-request-id"] = requestId;
    reply.header("x-request-id", requestId);
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    if (request.url === "/health/live") return;
    if (!validAuthorization(request.headers.authorization, config.serviceToken)) {
      return sendError(
        reply,
        401,
        "INFERENCE_AUTHENTICATION_FAILED",
        "Inference service authentication failed.",
        false
      );
    }
  });

  app.get("/health/live", async () => ({
    ok: true,
    service: "soko-inference",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      const models = await modelCapabilities(engine);
      const primary = models.find((candidate) => candidate.id === config.primaryModelId);
      if (primary?.available !== true) {
        return sendError(
          reply,
          503,
          "MODEL_NOT_INSTALLED",
          "The configured provider model is not installed.",
          true
        );
      }
      if (config.production && !config.durableModelStorage) {
        return sendError(
          reply,
          503,
          "MODEL_STORAGE_NOT_DURABLE",
          "Persistent model storage is required for production readiness.",
          false
        );
      }
      return {
        ok: true,
        service: "soko-inference",
        engine: engine.name,
        durableModelStorage: config.durableModelStorage,
        modelStoragePath: config.modelStoragePath,
        models
      };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.get("/v1/models", async (_request, reply) => {
    try {
      return {
        ok: true,
        engine: engine.name,
        models: await modelCapabilities(engine)
      };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.post(
    "/v1/models/:modelId/probe",
    async (request: FastifyRequest<{ Params: ModelParams }>, reply) => {
      const model = resolveRuntimeModel(request.params.modelId);
      if (model === null || !model.enabled) {
        return sendError(
          reply,
          404,
          "MODEL_NOT_CONFIGURED",
          "The requested Soko model is not enabled for this deployment.",
          false
        );
      }
      const startedAt = Date.now();
      try {
        const result = await engine.generate({
          providerModelId: model.providerModelId,
          prompt: "Reply with exactly: SOKO_MODEL_OK",
          maximumOutputTokens: 16,
          temperature: 0,
          jsonOutput: false
        });
        if (normalizeMarker(result.text) !== "SOKO_MODEL_OK") {
          return sendError(
            reply,
            422,
            "MODEL_PROBE_FAILED",
            "The model did not return the required probe marker.",
            true
          );
        }
        const latencyMs = Date.now() - startedAt;
        request.log.info(
          {
            event: "inference.model_probe_succeeded",
            requestId: request.headers["x-request-id"],
            modelId: model.id,
            providerModelId: model.providerModelId,
            engine: engine.name,
            latencyMs
          },
          "Inference model probe succeeded."
        );
        return {
          ok: true,
          modelId: model.id,
          providerModelId: model.providerModelId,
          engine: engine.name,
          latencyMs
        };
      } catch (error) {
        return sendRuntimeError(reply, error);
      }
    }
  );

  app.post(
    "/v1/chat/completions",
    async (request: FastifyRequest<{ Body: ChatCompletionBody }>, reply) => {
      const parsed = parseCompletionRequest(request.body, config);
      if ("error" in parsed) {
        return sendError(reply, 400, parsed.error.code, parsed.error.message, false);
      }
      const model = resolveRuntimeModel(parsed.modelId);
      if (model === null || !model.enabled) {
        return sendError(
          reply,
          404,
          "MODEL_NOT_CONFIGURED",
          "The requested Soko model is not enabled for this deployment.",
          false
        );
      }
      const startedAt = Date.now();
      try {
        const result = await engine.generate({
          providerModelId: model.providerModelId,
          prompt: parsed.prompt,
          maximumOutputTokens: parsed.maxTokens,
          temperature: parsed.temperature,
          jsonOutput: parsed.jsonOutput
        });
        const latencyMs = Date.now() - startedAt;
        const inferenceRequestId = randomUUID();
        request.log.info(
          {
            event: "inference.generation_completed",
            requestId: request.headers["x-request-id"],
            inferenceRequestId,
            modelId: model.id,
            providerModelId: model.providerModelId,
            engine: engine.name,
            latencyMs,
            promptCharacters: parsed.prompt.length,
            completionCharacters: result.text.length
          },
          "Inference generation completed."
        );
        return {
          ok: true,
          id: inferenceRequestId,
          modelId: model.id,
          providerModelId: model.providerModelId,
          engine: engine.name,
          text: result.text,
          latencyMs,
          usage: {
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens
          },
          finishReason: result.finishReason
        };
      } catch (error) {
        return sendRuntimeError(reply, error);
      }
    }
  );

  return app;
}

async function modelCapabilities(engine: InferenceEngine) {
  const installed = await engine.listModels();
  return Object.values(runtimeModels).map((model) => {
    const providerModel = installed.find((candidate) =>
      providerModelMatches(candidate.name, model.providerModelId)
    );
    return {
      id: model.id,
      displayName: model.displayName,
      providerModelId: model.providerModelId,
      enabled: model.enabled,
      available: model.enabled && providerModel !== undefined,
      digest: providerModel?.digest ?? null,
      sizeBytes: providerModel?.sizeBytes ?? null
    };
  });
}

function parseCompletionRequest(
  body: ChatCompletionBody,
  config: InferenceServiceConfig
):
  | {
      modelId: string;
      prompt: string;
      maxTokens: number;
      temperature: number;
      jsonOutput: boolean;
    }
  | { error: { code: string; message: string } } {
  if (typeof body !== "object" || body === null) {
    return { error: { code: "INVALID_REQUEST", message: "A JSON request body is required." } };
  }
  if (typeof body.modelId !== "string" || body.modelId.trim() === "") {
    return { error: { code: "INVALID_REQUEST", message: "modelId is required." } };
  }
  if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
    return { error: { code: "INVALID_REQUEST", message: "prompt is required." } };
  }
  const prompt = body.prompt.trim();
  if (prompt.length > config.maximumInputCharacters) {
    return {
      error: {
        code: "INPUT_LIMIT_EXCEEDED",
        message: `prompt must not exceed ${config.maximumInputCharacters} characters.`
      }
    };
  }
  const maxTokens = body.maxTokens ?? 256;
  if (
    typeof maxTokens !== "number" ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens <= 0 ||
    maxTokens > config.maximumOutputTokens
  ) {
    return {
      error: {
        code: "OUTPUT_LIMIT_EXCEEDED",
        message: `maxTokens must be between 1 and ${config.maximumOutputTokens}.`
      }
    };
  }
  const temperature = body.temperature ?? 0.2;
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 1
  ) {
    return {
      error: { code: "INVALID_REQUEST", message: "temperature must be between 0 and 1." }
    };
  }
  if (body.jsonOutput !== undefined && typeof body.jsonOutput !== "boolean") {
    return { error: { code: "INVALID_REQUEST", message: "jsonOutput must be boolean." } };
  }
  return {
    modelId: body.modelId.trim(),
    prompt,
    maxTokens,
    temperature,
    jsonOutput: body.jsonOutput === true
  };
}

function validAuthorization(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const candidate = header.slice("Bearer ".length);
  const expectedDigest = createHash("sha256").update(token).digest();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

function readCorrelationId(request: FastifyRequest): string | null {
  const value = request.headers["x-request-id"];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9._:-]{1,128}$/u.test(normalized) ? normalized : null;
}

function sendRuntimeError(reply: FastifyReply, error: unknown) {
  if (error instanceof InferenceEngineError) {
    return sendError(
      reply,
      error.code === "MODEL_NOT_INSTALLED" ? 404 : error.code === "INFERENCE_TIMEOUT" ? 504 : 503,
      error.code,
      error.message,
      error.retryable
    );
  }
  return sendError(
    reply,
    503,
    "INFERENCE_ENGINE_UNREACHABLE",
    "The inference engine is unavailable.",
    true
  );
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  retryable: boolean
) {
  return reply.code(status).send({
    ok: false,
    error: { code, message, retryable }
  });
}

function normalizeMarker(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .replace(/^["'`]+|["'`.,!]+$/gu, "")
    .trim();
}

function providerModelMatches(actual: string, expected: string): boolean {
  return actual === expected || actual === `${expected}:latest` || `${actual}:latest` === expected;
}
