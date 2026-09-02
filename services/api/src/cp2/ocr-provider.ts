/**
 * Bridge to the self-hosted PaddleOCR/Tesseract worker (services/receipt-ocr-service). This is a
 * generic OCR extraction capability - receipt parsing (domains/suppliers), chat document
 * extraction (domains/document-imports), and camera product capture (domains/commerce) all consume
 * the same processor instance rather than each talking to the worker directly.
 */
import type { OcrBlockSummary, OcrEngine, OcrProfile } from "@soko/shared-types";
import { Cp2Error } from "./store.js";

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
  fetcher?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createHttpOcrExtractionProcessor(
  options: HttpOcrExtractionProcessorOptions
): OcrExtractionProcessor {
  const endpoint = options.endpoint.trim().replace(/\/+$/u, "");
  const fetcher = options.fetcher ?? globalThis.fetch;
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000);
  const semaphore = createSemaphore(Math.max(1, options.concurrency ?? 1));

  if (endpoint.length === 0) {
    throw new Error("OCR worker endpoint is required.");
  }

  return {
    async process(input) {
      const release = await semaphore.acquire();

      try {
        let finalError: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
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
            if (response.status < 500 || attempt === maxRetries) {
              throw new Cp2Error(response.status >= 500 ? 503 : 422, "ocr_worker_failed", message);
            }
            finalError = new Error(message);
          } catch (error) {
            if (error instanceof Cp2Error) {
              throw error;
            }
            finalError = error;
            if (attempt === maxRetries) {
              break;
            }
          }
        }

        throw new Cp2Error(
          503,
          "ocr_worker_unavailable",
          finalError instanceof Error
            ? `OCR worker is unavailable: ${finalError.message}`
            : "OCR worker is unavailable."
        );
      } finally {
        release();
      }
    }
  };
}

export function createOcrExtractionProcessorFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): OcrExtractionProcessor | undefined {
  const endpoint = env.OCR_WORKER_URL?.trim();

  if (endpoint === undefined || endpoint.length === 0) {
    return undefined;
  }

  return createHttpOcrExtractionProcessor({
    endpoint,
    concurrency: readPositiveInteger(env.OCR_CONCURRENCY, 1),
    maxRetries: readNonNegativeInteger(env.OCR_MAX_RETRIES, 2),
    timeoutMs: readPositiveInteger(env.OCR_JOB_TIMEOUT_SECONDS, 120) * 1_000
  });
}

function parseExtractionResult(value: unknown): OcrExtractionResult {
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

function createSemaphore(limit: number): {
  acquire(): Promise<() => void>;
} {
  let active = 0;
  const waiting: Array<() => void> = [];

  return {
    async acquire() {
      if (active >= limit) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      active += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        active -= 1;
        waiting.shift()?.();
      };
    }
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
