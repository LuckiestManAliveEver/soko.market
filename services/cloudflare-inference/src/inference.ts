import { resolveRuntimeModel, runtimeModels, type RuntimeModelDefinition } from "@soko/shared-types";
import { InferenceServiceError, classifyProviderError } from "./errors.js";
import type {
  ChatCompletionRequestBody,
  ChatCompletionResponseBody,
  Env,
  ModelListEntry,
  ProbeResponseBody
} from "./types.js";

const ENGINE = "cloudflare-workers-ai" as const;
const PROBE_MARKER = "SOKO_MODEL_OK";
const MAX_INPUT_CHARACTERS = 32_000;
const MAX_OUTPUT_TOKENS = 512;

/**
 * Internal cap on a single env.AI.run() call. Kept below the API client's own
 * BACKEND_INFERENCE_TIMEOUT_MS (90_000ms default) so this Worker returns a proper
 * INFERENCE_TIMEOUT error body instead of letting the client's own abort win the race.
 */
const PROVIDER_CALL_TIMEOUT_MS = 60_000;

export function listCloudflareModels(): ModelListEntry[] {
  const models: RuntimeModelDefinition[] = Object.values(runtimeModels);
  return models
    .filter((model) => model.provider === "cloudflare-workers-ai")
    .map((model) => ({
      id: model.id,
      providerModelId: model.providerModelId,
      available: model.enabled,
      digest: null
    }));
}

export function resolveCloudflareModel(modelId: string): RuntimeModelDefinition | null {
  const model = resolveRuntimeModel(modelId);
  return model !== null && model.provider === "cloudflare-workers-ai" ? model : null;
}

function providerModelIdFor(model: RuntimeModelDefinition, env: Env): string {
  const override = env.CLOUDFLARE_AI_MODEL?.trim();
  return override !== undefined && override.length > 0 ? override : model.providerModelId;
}

async function runModel(
  env: Env,
  providerModelId: string,
  input: { messages: Array<{ role: "user"; content: string }>; max_tokens: number; temperature: number; response_format?: { type: "json_object" } }
): Promise<{ response: string; usage: Record<string, unknown> | undefined }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_CALL_TIMEOUT_MS);
  try {
    // env.AI.run()'s generated overloads key off a closed union of known model ids; the
    // model id here is resolved at runtime from the shared registry (and can be overridden
    // by CLOUDFLARE_AI_MODEL), so it is called through an untyped shim instead of `any`.
    const run = env.AI.run as unknown as (
      model: string,
      inputs: typeof input,
      options: { signal: AbortSignal }
    ) => Promise<unknown>;
    const result = await run(providerModelId, input, { signal: controller.signal });
    if (typeof result !== "object" || result === null || !("response" in result)) {
      throw new InferenceServiceError(
        502,
        "INVALID_INFERENCE_RESPONSE",
        "The inference provider returned an unexpected response shape.",
        true
      );
    }
    const record = result as { response: unknown; usage?: Record<string, unknown> };
    if (typeof record.response !== "string") {
      throw new InferenceServiceError(
        502,
        "INVALID_INFERENCE_RESPONSE",
        "The inference provider returned an unexpected response shape.",
        true
      );
    }
    return { response: record.response, usage: record.usage };
  } catch (error) {
    throw classifyProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeModel(
  env: Env,
  modelId: string
): Promise<ProbeResponseBody> {
  const model = resolveCloudflareModel(modelId);
  if (model === null || !model.enabled) {
    throw new InferenceServiceError(
      404,
      "MODEL_NOT_CONFIGURED",
      `No enabled Cloudflare model mapping exists for ${modelId}.`,
      false
    );
  }
  const providerModelId = providerModelIdFor(model, env);
  const startedAt = Date.now();
  const { response } = await runModel(env, providerModelId, {
    messages: [{ role: "user", content: `Reply with exactly: ${PROBE_MARKER}` }],
    max_tokens: 16,
    temperature: 0
  });
  if (!response.includes(PROBE_MARKER)) {
    throw new InferenceServiceError(
      422,
      "MODEL_PROBE_FAILED",
      "The model did not return the expected probe marker.",
      true
    );
  }
  return {
    ok: true,
    modelId: model.id,
    providerModelId,
    engine: ENGINE,
    latencyMs: Date.now() - startedAt
  };
}

export function parseCompletionRequest(body: unknown): ChatCompletionRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new InferenceServiceError(400, "MODEL_GENERATION_FAILED", "Request body must be a JSON object.", false);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.modelId !== "string" || record.modelId.trim().length === 0) {
    throw new InferenceServiceError(400, "MODEL_GENERATION_FAILED", "modelId is required.", false);
  }
  if (typeof record.prompt !== "string" || record.prompt.length === 0) {
    throw new InferenceServiceError(400, "MODEL_GENERATION_FAILED", "prompt is required.", false);
  }
  if (record.prompt.length > MAX_INPUT_CHARACTERS) {
    throw new InferenceServiceError(
      400,
      "MODEL_GENERATION_FAILED",
      `prompt exceeds the maximum of ${MAX_INPUT_CHARACTERS} characters.`,
      false
    );
  }
  const maxTokens =
    record.maxTokens === undefined ? 256 : record.maxTokens;
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
    throw new InferenceServiceError(
      400,
      "MODEL_GENERATION_FAILED",
      `maxTokens must be an integer between 1 and ${MAX_OUTPUT_TOKENS}.`,
      false
    );
  }
  const temperature = record.temperature === undefined ? 0.2 : record.temperature;
  if (typeof temperature !== "number" || temperature < 0 || temperature > 1) {
    throw new InferenceServiceError(400, "MODEL_GENERATION_FAILED", "temperature must be between 0 and 1.", false);
  }
  const jsonOutput = record.jsonOutput === undefined ? false : record.jsonOutput;
  if (typeof jsonOutput !== "boolean") {
    throw new InferenceServiceError(400, "MODEL_GENERATION_FAILED", "jsonOutput must be a boolean.", false);
  }
  return { modelId: record.modelId, prompt: record.prompt, maxTokens, temperature, jsonOutput };
}

export async function generateCompletion(
  env: Env,
  input: ChatCompletionRequestBody
): Promise<ChatCompletionResponseBody> {
  const model = resolveCloudflareModel(input.modelId);
  if (model === null || !model.enabled) {
    throw new InferenceServiceError(
      404,
      "MODEL_NOT_CONFIGURED",
      `No enabled Cloudflare model mapping exists for ${input.modelId}.`,
      false
    );
  }
  const providerModelId = providerModelIdFor(model, env);
  const startedAt = Date.now();
  const { response, usage } = await runModel(env, providerModelId, {
    messages: [{ role: "user", content: input.prompt }],
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    ...(input.jsonOutput ? { response_format: { type: "json_object" as const } } : {})
  });
  const text = response.trim();
  if (text.length === 0) {
    throw new InferenceServiceError(
      502,
      "INVALID_INFERENCE_RESPONSE",
      "The inference provider returned an empty response.",
      true
    );
  }
  return {
    ok: true,
    id: crypto.randomUUID(),
    modelId: model.id,
    providerModelId,
    engine: ENGINE,
    text,
    latencyMs: Date.now() - startedAt,
    usage: {
      promptTokens: nullableNumber(usage?.prompt_tokens),
      completionTokens: nullableNumber(usage?.completion_tokens)
    },
    finishReason: null
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
