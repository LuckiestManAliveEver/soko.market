import type { InferenceErrorBody } from "./types.js";

/**
 * The exact set of specific error codes services/api/src/inference/model-runtime.ts
 * (normalizeServiceErrorCode) recognizes from a backend-inference error body. Any other
 * code collapses client-side to MODEL_GENERATION_FAILED, so stay within this set.
 */
export type InferenceErrorCode =
  | "INFERENCE_AUTHENTICATION_FAILED"
  | "INFERENCE_TIMEOUT"
  | "INFERENCE_ENGINE_UNREACHABLE"
  | "MODEL_NOT_INSTALLED"
  | "MODEL_LOADING"
  | "MODEL_PROBE_FAILED"
  | "MODEL_GENERATION_FAILED"
  | "INVALID_INFERENCE_RESPONSE"
  | "MODEL_STORAGE_NOT_DURABLE"
  | "MODEL_NOT_CONFIGURED";

export class InferenceServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: InferenceErrorCode,
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "InferenceServiceError";
  }
}

export function errorResponse(
  status: number,
  code: InferenceErrorCode,
  message: string,
  retryable: boolean
): Response {
  const body: InferenceErrorBody = { ok: false, error: { code, message, retryable } };
  return jsonResponse(body, status);
}

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

/**
 * Maps a failure from env.AI.run() (or a request-handling failure) into the shared inference
 * error taxonomy. Cloudflare's AI binding throws plain Errors without a stable machine-readable
 * code, so this pattern-matches on the message text; anything unrecognized fails safe as a
 * retryable MODEL_GENERATION_FAILED rather than surfacing raw provider text to the caller.
 */
export function classifyProviderError(error: unknown): InferenceServiceError {
  if (error instanceof InferenceServiceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("abort") || normalized.includes("timed out")) {
    return new InferenceServiceError(
      504,
      "INFERENCE_TIMEOUT",
      "The inference request timed out.",
      true
    );
  }
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return new InferenceServiceError(
      429,
      "MODEL_GENERATION_FAILED",
      "The inference provider is rate limited.",
      true
    );
  }
  if (
    normalized.includes("capacity") ||
    normalized.includes("unavailable") ||
    normalized.includes("503") ||
    normalized.includes("internal error")
  ) {
    return new InferenceServiceError(
      503,
      "INFERENCE_ENGINE_UNREACHABLE",
      "The inference provider is temporarily unavailable.",
      true
    );
  }
  if (
    normalized.includes("not found") ||
    normalized.includes("unknown model") ||
    normalized.includes("invalid model")
  ) {
    return new InferenceServiceError(
      404,
      "MODEL_NOT_CONFIGURED",
      "The requested model is not available on this inference provider.",
      false
    );
  }
  return new InferenceServiceError(
    500,
    "MODEL_GENERATION_FAILED",
    "The inference provider failed to generate a response.",
    true
  );
}
