/**
 * Bridge to the isolated computer-use worker (services/computer-worker), which is the only
 * process in this deployment that ever loads a browser engine. This module is the sole place in
 * services/api that talks to it - the CP2 computer-runtime domain never reaches the worker
 * directly, and services/api's own package.json must never gain a browser-automation runtime
 * dependency (docs/architecture/computer-runtime-audit.md §3, mirroring the LLM-engine boundary
 * scripts/check-render-inference-boundaries.mjs already enforces for services/ai-runtime).
 *
 * Structurally identical to services/api/src/cp2/ocr-provider.ts's HTTP bridge to the self-hosted
 * OCR worker: bulkhead + circuit breaker + bounded retry around a JSON HTTP call, mapped to
 * Cp2Error on failure. That pattern is reused verbatim rather than re-invented.
 */
import type {
  ClickInput,
  ComputerActionResult,
  ComputerObservation,
  ComputerProviderCheckpoint,
  ComputerRuntimeProvider,
  ComputerSession,
  CreateSessionInput,
  NavigateInput,
  ObserveInput,
  ScrollInput,
  TypeInput,
  UploadInput
} from "@soko/computer-runtime";
import {
  type Bulkhead,
  BulkheadRejectedError,
  type CircuitBreaker,
  CircuitOpenError,
  createBulkhead,
  createCircuitBreaker,
  retryWithBackoff
} from "@soko/resource-control";
import { Cp2Error } from "./cp2-error.js";
import type { ResourceControlEvent } from "../resource-control-events.js";

export interface RemoteComputerWorkerProviderOptions {
  endpoint: string;
  concurrency?: number;
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

class ComputerWorkerHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Reads COMPUTER_WORKER_URL/COMPUTER_WORKER_CONCURRENCY/COMPUTER_WORKER_TIMEOUT_MS, matching
 * createOcrExtractionProcessorFromEnvironment's exact shape (services/api/src/cp2/ocr-provider.ts)
 * including the same Render fromService "hostport" (bare host:port, no scheme) normalization.
 * Returns undefined when unconfigured - callers (Cp2Store's constructor) fall back to a sane
 * local-dev default endpoint rather than treating an unconfigured worker as fatal at import time.
 */
export function createComputerWorkerProviderFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  onEvent?: (event: ResourceControlEvent) => void
): ComputerRuntimeProvider | undefined {
  const configured = env.COMPUTER_WORKER_URL?.trim();
  if (configured === undefined || configured.length === 0) return undefined;

  const endpoint = /^[a-z][a-z0-9+.-]*:\/\//iu.test(configured)
    ? configured
    : `http://${configured}`;

  return createRemoteComputerWorkerProvider({
    endpoint,
    ...(env.COMPUTER_WORKER_CONCURRENCY === undefined
      ? {}
      : { concurrency: Number(env.COMPUTER_WORKER_CONCURRENCY) }),
    ...(env.COMPUTER_WORKER_TIMEOUT_MS === undefined
      ? {}
      : { timeoutMs: Number(env.COMPUTER_WORKER_TIMEOUT_MS) }),
    ...(onEvent === undefined ? {} : { onEvent })
  });
}

export function createRemoteComputerWorkerProvider(
  options: RemoteComputerWorkerProviderOptions
): ComputerRuntimeProvider {
  const endpoint = options.endpoint.trim().replace(/\/+$/u, "");
  if (endpoint.length === 0) {
    throw new Error("Computer worker endpoint is required.");
  }
  const fetcher = options.fetcher ?? globalThis.fetch;
  const maxRetries = Math.max(0, options.maxRetries ?? 1);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 45_000);
  const retryInitialDelayMs = Math.max(1, options.retryInitialDelayMs ?? 200);
  const retryMaxDelayMs = Math.max(retryInitialDelayMs, options.retryMaxDelayMs ?? 3_000);

  // Computer-use is interactive (a human is watching the live view), never on the critical
  // commerce path - same BACKGROUND-adjacent classification reasoning ocr-provider.ts uses,
  // except sized for many more concurrent sessions than the single-flight OCR queue.
  const bulkhead: Bulkhead = createBulkhead({
    name: "computer_worker",
    workloadClass: "background",
    maxConcurrency: Math.max(1, options.concurrency ?? 8),
    maxQueue: Math.max(0, options.queueDepth ?? 40),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent })
  });
  const breaker: CircuitBreaker = createCircuitBreaker({
    name: "computer_worker",
    failureThreshold: Math.max(1, options.circuitBreakerFailureThreshold ?? 5),
    resetTimeoutMs: Math.max(1, options.circuitBreakerResetTimeoutMs ?? 30_000),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent })
  });

  async function call<T>(path: string, body: unknown): Promise<T> {
    return bulkhead.run(() =>
      breaker.run(() =>
        retryWithBackoff(
          async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const response = await fetcher(`${endpoint}${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal
              });
              if (!response.ok) {
                const text = await response.text().catch(() => "");
                throw new ComputerWorkerHttpError(
                  response.status,
                  `Computer worker ${path} returned ${response.status}: ${text.slice(0, 500)}`
                );
              }
              return (await response.json()) as T;
            } finally {
              clearTimeout(timeout);
            }
          },
          {
            maxAttempts: maxRetries + 1,
            initialDelayMs: retryInitialDelayMs,
            maxDelayMs: retryMaxDelayMs,
            isRetryable: (error) =>
              !(error instanceof ComputerWorkerHttpError) || error.status >= 500
          }
        )
      )
    );
  }

  function wrapError(error: unknown): never {
    if (error instanceof BulkheadRejectedError) {
      throw new Cp2Error(503, "COMPUTER_WORKER_OVERLOADED", "The computer worker is at capacity.");
    }
    if (error instanceof CircuitOpenError) {
      throw new Cp2Error(503, "COMPUTER_WORKER_UNAVAILABLE", "The computer worker is unavailable.");
    }
    if (error instanceof ComputerWorkerHttpError) {
      throw new Cp2Error(502, "COMPUTER_WORKER_ERROR", error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Cp2Error(502, "COMPUTER_WORKER_ERROR", `Computer worker request failed: ${message}`);
  }

  return {
    kind: "remote-worker",

    async createSession(input: CreateSessionInput): Promise<ComputerSession> {
      try {
        return await call<ComputerSession>("/sessions", input);
      } catch (error) {
        wrapError(error);
      }
    },

    async resumeSession(sessionId: string): Promise<ComputerSession> {
      try {
        return await call<ComputerSession>(`/sessions/${encodeURIComponent(sessionId)}/resume`, {});
      } catch (error) {
        wrapError(error);
      }
    },

    async navigate(input: NavigateInput): Promise<ComputerObservation> {
      try {
        return await call<ComputerObservation>(
          `/sessions/${encodeURIComponent(input.sessionId)}/navigate`,
          { url: input.url }
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async observe(input: ObserveInput): Promise<ComputerObservation> {
      try {
        return await call<ComputerObservation>(
          `/sessions/${encodeURIComponent(input.sessionId)}/observe`,
          {}
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async click(input: ClickInput): Promise<ComputerActionResult> {
      try {
        return await call<ComputerActionResult>(
          `/sessions/${encodeURIComponent(input.sessionId)}/click`,
          { target: input.target }
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async type(input: TypeInput): Promise<ComputerActionResult> {
      try {
        return await call<ComputerActionResult>(
          `/sessions/${encodeURIComponent(input.sessionId)}/type`,
          { target: input.target, text: input.text, submit: input.submit ?? false }
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async scroll(input: ScrollInput): Promise<ComputerActionResult> {
      try {
        return await call<ComputerActionResult>(
          `/sessions/${encodeURIComponent(input.sessionId)}/scroll`,
          { direction: input.direction, amountPx: input.amountPx ?? 600 }
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async upload(input: UploadInput): Promise<ComputerActionResult> {
      try {
        return await call<ComputerActionResult>(
          `/sessions/${encodeURIComponent(input.sessionId)}/upload`,
          {
            target: input.target,
            fileName: input.fileName,
            contentType: input.contentType,
            contentBase64: input.contentBase64
          }
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async checkpoint(sessionId: string): Promise<ComputerProviderCheckpoint> {
      try {
        return await call<ComputerProviderCheckpoint>(
          `/sessions/${encodeURIComponent(sessionId)}/checkpoint`,
          {}
        );
      } catch (error) {
        wrapError(error);
      }
    },

    async suspend(sessionId: string): Promise<void> {
      try {
        await call(`/sessions/${encodeURIComponent(sessionId)}/suspend`, {});
      } catch (error) {
        wrapError(error);
      }
    },

    async resume(sessionId: string, checkpoint: ComputerProviderCheckpoint | null): Promise<void> {
      try {
        await call(`/sessions/${encodeURIComponent(sessionId)}/restore`, {
          opaqueState: checkpoint?.opaqueState ?? null
        });
      } catch (error) {
        wrapError(error);
      }
    },

    async close(sessionId: string): Promise<void> {
      try {
        await call(`/sessions/${encodeURIComponent(sessionId)}/close`, {});
      } catch (error) {
        wrapError(error);
      }
    }
  };
}
