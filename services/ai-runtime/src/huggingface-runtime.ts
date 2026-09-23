import { InferenceServiceError } from "./service-error.js";

export interface HuggingFaceRuntimeConfig {
  token: string;
  modelId: string;
  baseUrl: string;
}

export interface HuggingFaceGenerationInput {
  prompt: string;
  maximumTokens: number;
  temperature: number;
  signal?: AbortSignal;
  jsonOutput: boolean;
  onText(text: string): void;
}

export async function generateWithHuggingFace(
  config: HuggingFaceRuntimeConfig,
  input: HuggingFaceGenerationInput,
  request: typeof fetch = fetch
): Promise<{
  text: string;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
}> {
  const endpoint = new URL("chat/completions", normalizedBaseUrl(config.baseUrl));
  const response = await request(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [{ role: "user", content: input.prompt }],
      max_tokens: input.maximumTokens,
      temperature: input.temperature,
      stream: true,
      ...(input.jsonOutput ? { response_format: { type: "json_object" } } : {})
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  }).catch((error) => {
    throw new InferenceServiceError(
      "MODEL_GENERATION_FAILED",
      "Hugging Face inference request failed.",
      true,
      503,
      { cause: error }
    );
  });

  if (!response.ok || response.body === null) {
    throw await huggingFaceFailure(response);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let inputTokens = estimateTokens(input.prompt);
  let outputTokens = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseServerSentEventLine(line);
        if (event === null) continue;
        if (event === "[DONE]") {
          buffer = "";
          break;
        }
        const chunk = parseChunk(event);
        if (chunk.finishReason !== null) finishReason = chunk.finishReason;
        if (chunk.inputTokens !== null) inputTokens = chunk.inputTokens;
        if (chunk.outputTokens !== null) outputTokens = chunk.outputTokens;
        if (chunk.text !== "") {
          text += chunk.text;
          input.onText(chunk.text);
        }
      }
    }
  } catch (error) {
    if (input.signal?.aborted === true) {
      throw new InferenceServiceError(
        "INFERENCE_CANCELLED",
        "Inference was cancelled.",
        true,
        499,
        { cause: error }
      );
    }
    if (error instanceof InferenceServiceError) throw error;
    throw new InferenceServiceError(
      "MODEL_GENERATION_FAILED",
      "Hugging Face inference stream failed.",
      true,
      503,
      { cause: error }
    );
  } finally {
    reader.releaseLock();
  }

  const trimmed = text.trim();
  if (trimmed === "") {
    throw new InferenceServiceError(
      "INVALID_INFERENCE_RESPONSE",
      "The model returned no text.",
      true,
      502
    );
  }
  return {
    text: trimmed,
    finishReason,
    inputTokens,
    outputTokens: outputTokens || estimateTokens(trimmed)
  };
}

function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseServerSentEventLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith(":")) return null;
  return trimmed.startsWith("data:") ? trimmed.slice(5).trim() : null;
}

function parseChunk(value: string): {
  text: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new InferenceServiceError(
      "INVALID_INFERENCE_RESPONSE",
      "Hugging Face returned malformed stream data.",
      true,
      502,
      { cause: error }
    );
  }
  const choice = record(parsed) && Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  const delta = record(choice) && record(choice.delta) ? choice.delta : null;
  const usage = record(parsed) && record(parsed.usage) ? parsed.usage : null;
  return {
    text: typeof delta?.content === "string" ? delta.content : "",
    finishReason: record(choice) && typeof choice.finish_reason === "string" ? choice.finish_reason : null,
    inputTokens: record(usage) && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens:
      record(usage) && typeof usage.completion_tokens === "number" ? usage.completion_tokens : null
  };
}

async function huggingFaceFailure(response: Response): Promise<InferenceServiceError> {
  const body = await response.text().catch(() => "");
  const retryable = response.status === 429 || response.status >= 500;
  const code =
    response.status === 401 || response.status === 403
      ? "INFERENCE_AUTHENTICATION_FAILED"
      : response.status === 404
        ? "MODEL_NOT_FOUND"
        : "MODEL_GENERATION_FAILED";
  return new InferenceServiceError(
    code,
    "Hugging Face inference failed.",
    retryable,
    response.status === 404 ? 404 : response.status === 429 ? 429 : response.status >= 500 ? 503 : 502,
    { cause: body }
  );
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().split(/\s+/u).filter(Boolean).length * 1.35));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
