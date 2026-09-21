/**
 * Bridge to the self-hosted PaddleOCR/Tesseract worker (services/receipt-ocr-service). This is a
 * generic OCR extraction capability - receipt parsing (domains/suppliers), chat document
 * extraction (domains/document-imports), and camera product capture (domains/commerce) all consume
 * the same processor instance rather than each talking to the worker directly.
 */
import type { OcrBlockSummary, OcrEngine, OcrProfile } from "@soko/shared-types";
import {
  type Bulkhead,
  BulkheadRejectedError,
  type CircuitBreaker,
  CircuitOpenError,
  createBulkhead,
  createCircuitBreaker,
  retryWithBackoff
} from "@soko/resource-control";
import { Cp2Error } from "./store.js";
import type { ResourceControlEvent } from "../resource-control-events.js";

export interface OcrExtractionInput {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

export interface OcrExtractionResult {
  engine: OcrEngine;
  engineVersion: string;
  modelVersion: string;
  profile: OcrProfile;
  fallbackUsed: boolean;
  blocks: OcrBlockSummary[];
  fullText: string;
  averageConfidence: number;
  warnings: string[];
}

export interface OcrExtractionProcessor {
  process(input: OcrExtractionInput): Promise<OcrExtractionResult>;
}

export interface HttpOcrExtractionProcessorOptions {
  endpoint: string;
  concurrency?: number;
  /** Bounded wait-queue depth once `concurrency` is saturated (resource-isolation.md §7). */
  queueDepth?: number;
  fetcher?: typeof fetch;
  maxRetries?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
  timeoutMs?: number;
  circuitBreakerFailureThreshold?: number;
  circuitBreakerResetTimeoutMs?: number;
  onEvent?: (event: ResourceControlEvent) => void;
}

/** Marks a 5xx HTTP response from the worker as a distinct, retryable failure shape, separate
 *  from a network-level throw - both are retryable, but they produce different final Cp2Error
 *  messages once retries are exhausted (see the catch block in `process` below), matching the
 *  behavior this module already had before it grew a shared retry/circuit-breaker/bulkhead. */
class OcrWorkerHttpError extends Error {}

export function createHttpOcrExtractionProcessor(
  options: HttpOcrExtractionProcessorOptions
): OcrExtractionProcessor {
  const endpoint = options.endpoint.trim().replace(/\/+$/u, "");
  const fetcher = options.fetcher ?? globalThis.fetch;
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000);
  const retryInitialDelayMs = Math.max(1, options.retryInitialDelayMs ?? 200);
  const retryMaxDelayMs = Math.max(retryInitialDelayMs, options.retryMaxDelayMs ?? 5_000);

  if (endpoint.length === 0) {
    throw new Error("OCR worker endpoint is required.");
  }

  // OCR is BACKGROUND work in resource-isolation.md's classification: even when a user is
  // waiting on one receipt scan, it is never on the critical commerce path (auth/catalogue/
  // orders) and manual entry remains available if it degrades - see resource-isolation.md §11.
  const bulkhead: Bulkhead = createBulkhead({
    name: "ocr",
    workloadClass: "background",
    maxConcurrency: Math.max(1, options.concurrency ?? 1),
    maxQueue: Math.max(0, options.queueDepth ?? 10),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent })
  });
  const breaker: CircuitBreaker = createCircuitBreaker({
    name: "ocr",
    failureThreshold: Math.max(1, options.circuitBreakerFailureThreshold ?? 5),
    resetTimeoutMs: Math.max(1, options.circuitBreakerResetTimeoutMs ?? 30_000),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent })
  });

  async function attemptOnce(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    const response = await fetcher(`${endpoint}/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.ok) {
      return parseExtractionResult(await response.json());
    }
    const message = await readWorkerError(response);
    if (response.status < 500) {
      // Not retryable: the worker rejected this specific input, retrying it changes nothing.
      throw new Cp2Error(422, "ocr_worker_failed", message);
    }
    throw new OcrWorkerHttpError(message);
  }

  return {
    async process(input) {
      try {
        return await bulkhead.run(() =>
          breaker.run(() =>
            retryWithBackoff(() => attemptOnce(input), {
              maxAttempts: maxRetries + 1,
              initialDelayMs: retryInitialDelayMs,
              maxDelayMs: retryMaxDelayMs,
              isRetryable: (error) => !(error instanceof Cp2Error)
            })
          )
        );
      } catch (error) {
        if (error instanceof BulkheadRejectedError) {
          throw new Cp2Error(
            503,
            "ocr_worker_busy",
            "OCR worker is at capacity; please retry shortly."
          );
        }
        if (error instanceof CircuitOpenError) {
          throw new Cp2Error(
            503,
            "ocr_worker_unavailable",
            "OCR worker is temporarily disabled after repeated failures."
          );
        }
        if (error instanceof Cp2Error) {
          throw error;
        }
        if (error instanceof OcrWorkerHttpError) {
          throw new Cp2Error(503, "ocr_worker_failed", error.message);
        }
        throw new Cp2Error(
          503,
          "ocr_worker_unavailable",
          error instanceof Error
            ? `OCR worker is unavailable: ${error.message}`
            : "OCR worker is unavailable."
        );
      }
    }
  };
}

export function createOcrExtractionProcessorFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  onEvent?: (event: ResourceControlEvent) => void
): OcrExtractionProcessor | undefined {
  const configured = env.OCR_WORKER_URL?.trim();

  if (configured === undefined || configured.length === 0) {
    return undefined;
  }

  // Render's fromService "hostport" property (used to wire this to the soko-market-ocr-worker
  // private service in render.yaml) yields a bare "host:port", not a URL with a scheme.
  const endpoint = /^[a-z][a-z0-9+.-]*:\/\//iu.test(configured)
    ? configured
    : `http://${configured}`;

  return createHttpOcrExtractionProcessor({
    endpoint,
    concurrency: readPositiveInteger(env.OCR_CONCURRENCY, 1),
    queueDepth: readNonNegativeInteger(env.OCR_QUEUE_MAX, 10),
    maxRetries: readNonNegativeInteger(env.OCR_MAX_RETRIES, 2),
    retryInitialDelayMs: readPositiveInteger(env.OCR_RETRY_INITIAL_DELAY_MS, 200),
    retryMaxDelayMs: readPositiveInteger(env.OCR_RETRY_MAX_DELAY_MS, 5_000),
    timeoutMs: readPositiveInteger(env.OCR_JOB_TIMEOUT_SECONDS, 120) * 1_000,
    circuitBreakerFailureThreshold: readPositiveInteger(
      env.OCR_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      5
    ),
    circuitBreakerResetTimeoutMs: readPositiveInteger(
      env.OCR_CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      30_000
    ),
    ...(onEvent === undefined ? {} : { onEvent })
  });
}

/** Exported for reuse validating a client-supplied extraction (services/api/src/cp2/store.ts's
 * offline-sync dispatcher), not only the response from our own hosted OCR worker. */
export function parseExtractionResult(value: unknown): OcrExtractionResult {
  if (typeof value !== "object" || value === null) {
    throw invalidWorkerResponse();
  }

  const record = value as Record<string, unknown>;
  const engine = record.engine;
  const profile = record.profile;
  const blocks = record.blocks;

  if (
    (engine !== "paddleocr" && engine !== "tesseract") ||
    (profile !== "mobile" && profile !== "balanced" && profile !== "accurate") ||
    typeof record.engineVersion !== "string" ||
    typeof record.modelVersion !== "string" ||
    typeof record.fallbackUsed !== "boolean" ||
    typeof record.fullText !== "string" ||
    !Number.isFinite(record.averageConfidence) ||
    !Array.isArray(record.warnings) ||
    !record.warnings.every((warning) => typeof warning === "string") ||
    !Array.isArray(blocks)
  ) {
    throw invalidWorkerResponse();
  }

  const parsedBlocks = blocks.map((block): OcrBlockSummary => {
    if (typeof block !== "object" || block === null) {
      throw invalidWorkerResponse();
    }
    const item = block as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !Number.isInteger(item.page) ||
      typeof item.text !== "string" ||
      !Number.isFinite(item.confidence)
    ) {
      throw invalidWorkerResponse();
    }

    const boundingBox =
      item.boundingBox === null
        ? null
        : Array.isArray(item.boundingBox)
          ? item.boundingBox.map((point) => {
              if (
                typeof point !== "object" ||
                point === null ||
                !Number.isFinite((point as Record<string, unknown>).x) ||
                !Number.isFinite((point as Record<string, unknown>).y)
              ) {
                throw invalidWorkerResponse();
              }
              return {
                x: Number((point as Record<string, unknown>).x),
                y: Number((point as Record<string, unknown>).y)
              };
            })
          : undefined;

    if (boundingBox === undefined) {
      throw invalidWorkerResponse();
    }

    return {
      id: item.id,
      page: Number(item.page),
      text: item.text,
      confidence: Number(item.confidence),
      boundingBox
    };
  });

  return {
    engine,
    engineVersion: record.engineVersion,
    modelVersion: record.modelVersion,
    profile,
    fallbackUsed: record.fallbackUsed,
    blocks: parsedBlocks,
    fullText: record.fullText,
    averageConfidence: Number(record.averageConfidence),
    warnings: record.warnings
  };
}

function invalidWorkerResponse(): Cp2Error {
  return new Cp2Error(
    502,
    "ocr_worker_response_invalid",
    "OCR worker returned an invalid response."
  );
}

async function readWorkerError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error.trim();
    }
  } catch {
    // Fall through to the stable error below.
  }
  return `OCR worker failed with HTTP ${response.status}.`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
