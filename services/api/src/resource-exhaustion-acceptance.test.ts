/**
 * The resource-exhaustion acceptance test required by
 * docs/architecture/resource-isolation.md §23: a BACKGROUND workload consumes its entire
 * permitted budget, and a CRITICAL/IMPORTANT operation must still succeed using its own
 * protected capacity. This is the test that proves the bulkhead architecture actually works -
 * not a toy example, but the real `createBulkhead` primitive and the real, production
 * `createHttpOcrExtractionProcessor` (BACKGROUND) / `boundModelRuntimeAdapter` (IMPORTANT) code
 * paths, run against each other.
 */
import { describe, expect, it } from "vitest";
import {
  BulkheadRejectedError,
  createBulkhead,
  createCircuitBreaker
} from "@soko/resource-control";
import type { RuntimeModelPrompt } from "@soko/shared-types";
import { createHttpOcrExtractionProcessor } from "./cp2/ocr-provider.js";
import {
  boundModelRuntimeAdapter,
  type ModelRuntimeAdapter,
  type ModelRuntimeGenerationResult
} from "./inference/model-runtime.js";

describe("resource exhaustion acceptance", () => {
  it("a saturated background bulkhead rejects new work while an independent critical bulkhead is unaffected", async () => {
    const backgroundBulkhead = createBulkhead({
      name: "background-workload",
      workloadClass: "background",
      maxConcurrency: 1,
      maxQueue: 0
    });
    const criticalBulkhead = createBulkhead({
      name: "critical-workload",
      workloadClass: "critical",
      maxConcurrency: 2,
      maxQueue: 2
    });

    // BACKGROUND consumes its entire permitted budget (its one concurrency slot, no queue).
    let releaseBackground!: () => void;
    const backgroundHold = backgroundBulkhead.run(
      () => new Promise<void>((resolve) => (releaseBackground = resolve))
    );
    await Promise.resolve();
    expect(backgroundBulkhead.stats()).toMatchObject({ active: 1, maxConcurrency: 1 });

    // A further BACKGROUND operation now hits capacity and is rejected immediately - it does not
    // hang, and it does not silently steal capacity from anything else.
    await expect(backgroundBulkhead.run(async () => "rejected")).rejects.toBeInstanceOf(
      BulkheadRejectedError
    );

    // CRITICAL still executes successfully, using its own protected capacity - BACKGROUND being
    // fully saturated has zero effect on it, because they are separate bulkheads with separate
    // budgets, exactly as docs/architecture/resource-isolation.md §13's bulkhead diagram requires.
    const criticalResult = await criticalBulkhead.run(async () => "critical operation completed");
    expect(criticalResult).toBe("critical operation completed");
    expect(criticalBulkhead.stats()).toMatchObject({ active: 0 });

    releaseBackground();
    await backgroundHold;
  });

  it("OCR (BACKGROUND) saturated to its budget does not block inference (IMPORTANT) from completing", async () => {
    // A fetcher that never resolves, standing in for a hung/overloaded OCR worker - the OCR
    // processor's own bulkhead (concurrency 1, queue 0, matching production's OCR_CONCURRENCY=1
    // default) is what turns "the worker never responds" into "capacity reached," not this mock.
    let releaseOcrHold: (() => void) | undefined;
    const hungFetcher = (() =>
      new Promise<Response>((resolve) => {
        releaseOcrHold = () =>
          resolve(
            new Response(
              JSON.stringify({
                engine: "paddleocr",
                engineVersion: "v1",
                modelVersion: "v1",
                profile: "balanced",
                fallbackUsed: false,
                blocks: [],
                fullText: "",
                averageConfidence: 0,
                warnings: []
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
      })) as unknown as typeof fetch;

    const ocrProcessor = createHttpOcrExtractionProcessor({
      endpoint: "http://ocr.internal",
      fetcher: hungFetcher,
      concurrency: 1,
      queueDepth: 0,
      maxRetries: 0
    });

    const ocrInput = { fileName: "receipt.png", contentType: "image/png", contentBase64: "abc" };

    // BACKGROUND (OCR) consumes its entire permitted budget: one in-flight scan holds the worker.
    const firstScan = ocrProcessor.process(ocrInput);
    await Promise.resolve();

    // A second, concurrent OCR request hits capacity and is rejected immediately with a
    // structured 503 - this is resource.capacity_reached / resource.operation_rejected in
    // practice, not a hang and not a misleading 500.
    await expect(ocrProcessor.process(ocrInput)).rejects.toMatchObject({
      code: "ocr_worker_busy",
      statusCode: 503
    });

    // IMPORTANT (an agent turn's inference call) still executes successfully on its own,
    // independent bulkhead + circuit breaker while OCR is completely saturated - manual catalogue
    // entry / conversation flow stays available exactly as resource-isolation.md §11 requires.
    const fakeAdapter: ModelRuntimeAdapter = {
      provider: "llama.cpp",
      executionTarget: "vercel",
      canRun: async () => ({ available: true, errorCode: null, message: null }),
      healthCheck: async () => ({
        available: true,
        errorCode: null,
        message: null,
        modelId: "smollm2-360m",
        provider: "llama.cpp",
        executionTarget: "vercel",
        latencyMs: 1,
        responsePreview: null,
        retryable: false
      }),
      generate: async (): Promise<ModelRuntimeGenerationResult> => ({
        text: "the agent's reply",
        modelId: "smollm2-360m",
        provider: "llama.cpp",
        executionTarget: "vercel",
        latencyMs: 5
      })
    };
    const boundedInference = boundModelRuntimeAdapter(fakeAdapter, {
      bulkhead: createBulkhead({
        name: "inference",
        workloadClass: "important",
        maxConcurrency: 4,
        maxQueue: 8
      }),
      breaker: createCircuitBreaker({
        name: "inference",
        failureThreshold: 5,
        resetTimeoutMs: 30_000
      })
    });
    const prompt: RuntimeModelPrompt = {
      message: "hello",
      allowedTools: [],
      schemaVersion: "cp11-runtime-model-v1"
    };

    const inferenceResult = await boundedInference.generate({
      context: { agentId: "agent-1", shopId: "shop-1", modelId: "smollm2-360m" },
      prompt
    });
    expect(inferenceResult.text).toBe("the agent's reply");

    releaseOcrHold?.();
    await firstScan;
  });
});
