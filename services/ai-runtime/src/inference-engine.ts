export type InferenceEngineErrorCode =
  | "INFERENCE_TIMEOUT"
  | "INFERENCE_ENGINE_UNREACHABLE"
  | "MODEL_NOT_INSTALLED"
  | "MODEL_LOADING"
  | "MODEL_GENERATION_FAILED"
  | "INVALID_INFERENCE_RESPONSE";

export class InferenceEngineError extends Error {
  constructor(
    readonly code: InferenceEngineErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "InferenceEngineError";
  }
}

export interface EngineModel {
  name: string;
  digest: string | null;
  sizeBytes: number | null;
}

export interface EngineGenerationResult {
  providerModelId: string;
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
  finishReason: string | null;
}

export interface InferenceEngine {
  readonly name: "ollama";
  listModels(signal?: AbortSignal): Promise<EngineModel[]>;
  generate(input: {
    providerModelId: string;
    prompt: string;
    maximumOutputTokens: number;
    temperature: number;
    jsonOutput: boolean;
    signal?: AbortSignal;
  }): Promise<EngineGenerationResult>;
}

export function createOllamaInferenceEngine(options: {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}): InferenceEngine {
  const request = options.fetch ?? fetch;

  return {
    name: "ollama",
    async listModels(signal) {
      const response = await fetchWithTimeout({
        request,
        url: new URL("/api/tags", options.baseUrl),
        timeoutMs: options.timeoutMs,
        ...(signal === undefined ? {} : { signal })
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw engineHttpError(response.status, body);
      }
      if (!isRecord(body) || !Array.isArray(body.models)) {
        throw new InferenceEngineError(
          "INVALID_INFERENCE_RESPONSE",
          "The model engine returned an invalid model list.",
          true
        );
      }
      return body.models.flatMap((candidate): EngineModel[] => {
        if (!isRecord(candidate)) return [];
        const name =
          typeof candidate.model === "string"
            ? candidate.model
            : typeof candidate.name === "string"
              ? candidate.name
              : null;
        if (name === null || name.trim() === "") return [];
        return [
          {
            name: name.trim(),
            digest: typeof candidate.digest === "string" ? candidate.digest : null,
            sizeBytes:
              typeof candidate.size === "number" && Number.isFinite(candidate.size)
                ? candidate.size
                : null
          }
        ];
      });
    },
    async generate(input) {
      const response = await fetchWithTimeout({
        request,
        url: new URL("/api/generate", options.baseUrl),
        timeoutMs: options.timeoutMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: input.providerModelId,
            prompt: input.prompt,
            stream: false,
            ...(input.jsonOutput ? { format: "json" } : {}),
            options: {
              temperature: input.temperature,
              num_predict: input.maximumOutputTokens
            }
          })
        }
      });
      const body = await readJson(response);
      if (!response.ok) throw engineHttpError(response.status, body);
      if (!isRecord(body) || typeof body.response !== "string" || typeof body.model !== "string") {
        throw new InferenceEngineError(
          "INVALID_INFERENCE_RESPONSE",
          "The model engine returned an invalid generation response.",
          true
        );
      }
      if (!providerModelMatches(body.model, input.providerModelId)) {
        throw new InferenceEngineError(
          "INVALID_INFERENCE_RESPONSE",
          "The model engine responded using a different model.",
          false
        );
      }
      const text = body.response.trim();
      if (text === "") {
        throw new InferenceEngineError(
          "INVALID_INFERENCE_RESPONSE",
          "The model engine returned an empty response.",
          true
        );
      }
      return {
        providerModelId: input.providerModelId,
        text,
        promptTokens: typeof body.prompt_eval_count === "number" ? body.prompt_eval_count : null,
        completionTokens: typeof body.eval_count === "number" ? body.eval_count : null,
        finishReason: typeof body.done_reason === "string" ? body.done_reason : null
      };
    }
  };
}

function engineHttpError(status: number, body: unknown): InferenceEngineError {
  const message =
    isRecord(body) && typeof body.error === "string"
      ? body.error.slice(0, 240)
      : `Inference engine returned HTTP ${status}.`;
  const normalized = message.toLowerCase();
  if (status === 404 || normalized.includes("not found")) {
    return new InferenceEngineError("MODEL_NOT_INSTALLED", "The model is not installed.", true);
  }
  if (status === 409 || normalized.includes("loading")) {
    return new InferenceEngineError("MODEL_LOADING", "The model is still loading.", true);
  }
  return new InferenceEngineError(
    "MODEL_GENERATION_FAILED",
    "The model engine could not complete the request.",
    status === 408 || status === 429 || status >= 500
  );
}

async function fetchWithTimeout(input: {
  request: typeof fetch;
  url: URL;
  timeoutMs: number;
  signal?: AbortSignal;
  init?: RequestInit;
}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await input.request(input.url, {
      ...input.init,
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = controller.signal.aborted && input.signal?.aborted !== true;
    throw new InferenceEngineError(
      timedOut ? "INFERENCE_TIMEOUT" : "INFERENCE_ENGINE_UNREACHABLE",
      timedOut ? "The inference engine timed out." : "The inference engine is unreachable.",
      true,
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerModelMatches(actual: string, expected: string): boolean {
  return actual === expected || actual === `${expected}:latest` || `${actual}:latest` === expected;
}
