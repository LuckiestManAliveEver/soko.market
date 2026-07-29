import { describe, expect, it } from "vitest";
import { createBrowserModelEngine } from "../apps/web/src/browser-model-engine";
import { browserRuntimeContractForModel } from "../apps/web/src/browser-inference-contracts";
import type {
  BrowserModelWorkerRequest,
  BrowserModelWorkerResponse
} from "../apps/web/src/browser-model-worker-protocol";
import type { BrowserModelDescriptor } from "../apps/web/src/browser-inference-types";

class FakeWorker extends EventTarget {
  readonly requests: BrowserModelWorkerRequest[] = [];
  terminated = false;

  postMessage(request: BrowserModelWorkerRequest) {
    this.requests.push(request);
    queueMicrotask(() => this.respond(request));
  }

  terminate() {
    this.terminated = true;
  }

  private respond(request: BrowserModelWorkerRequest) {
    if (request.type === "INITIALIZE") {
      this.message({
        type: "READY",
        requestId: request.requestId,
        capabilities: {
          backend: request.config.backend,
          tokenizerAvailable: true,
          streaming: true,
          cancellation: true,
          contextWindowTokens: request.config.maxContextTokens,
          runtimeContract: request.config.runtimeContract
        }
      });
    } else if (request.type === "LOAD_MODEL") {
      this.message({
        type: "MODEL_LOAD_STARTED",
        requestId: request.requestId,
        modelId: request.model.id
      });
      this.message({
        type: "MODEL_LOAD_PROGRESS",
        requestId: request.requestId,
        progress: { status: "downloading", percent: 50 }
      });
      this.message({
        type: "MODEL_READY",
        requestId: request.requestId,
        modelId: request.model.id
      });
    } else if (request.type === "GENERATE") {
      this.message({ type: "TOKEN", requestId: request.requestId, token: "Hello", tokenCount: 1 });
      this.message({
        type: "GENERATION_COMPLETE",
        requestId: request.requestId,
        result: {
          requestId: request.requestId,
          text: "Hello",
          promptTokenCount: 12,
          generatedTokenCount: 1,
          durationMs: 20,
          timeToFirstTokenMs: 5,
          tokensPerSecond: 50
        }
      });
    } else if (request.type === "COUNT_TOKENS") {
      this.message({
        type: "TOKEN_COUNT",
        requestId: request.requestId,
        tokenCount: 12
      });
    } else if (request.type === "CANCEL") {
      this.message({
        type: "CANCELLED",
        requestId: request.requestId,
        targetRequestId: request.targetRequestId
      });
    } else if (request.type === "UNLOAD") {
      this.message({ type: "UNLOADED", requestId: request.requestId });
    }
  }

  private message(data: BrowserModelWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

const model: BrowserModelDescriptor = {
  manifestVersion: 3,
  id: "model",
  modelFamilyId: "model-family",
  displayName: "Model",
  provider: "browser-local",
  runtimeAdapter: "transformers-js",
  runtimeAdapterVersion: "3.8.1",
  runtimeModelId: "onnx-community/model",
  architecture: "llama",
  modelUrl: "https://huggingface.co/onnx-community/model",
  modelRevision: "revision",
  modelFormat: "ONNX",
  quantization: "q4",
  pipeline: "text-generation",
  dtypeByBackend: { webgpu: "q4", wasm: "q4" },
  promptTemplateId: "test-template",
  approximateDownloadBytes: 100,
  approximateRuntimeMemoryBytes: 200,
  contextWindowTokens: 2_048,
  recommendedContextTokens: { low: 1_024, medium: 2_048, high: 2_048 },
  recommendedOutputTokens: { low: 64, medium: 128, high: 160 },
  maximumGenerationTimeMs: { low: 30_000, medium: 60_000, high: 90_000 },
  taskClasses: ["short-chat"],
  readinessPrompt: "Reply READY.",
  readinessMaxTokens: 8,
  supportedRuntimes: ["browser-webgpu", "browser-wasm"],
  minimumDeviceTier: "low",
  supportedBackends: ["webgpu", "wasm"],
  license: "Apache-2.0",
  enabled: true
};

describe("browser model engine worker integration", () => {
  it.each(["webgpu", "wasm"] as const)(
    "loads and streams outside the UI thread on %s",
    async (backend) => {
      const worker = new FakeWorker();
      const engine = createBrowserModelEngine(() => worker);
      const progress: number[] = [];
      const tokens: string[] = [];
      await engine.initialize({
        backend,
        approvedModelOrigins: ["https://huggingface.co"],
        maxContextTokens: 2_048,
        runtimeContract: browserRuntimeContractForModel(model, backend)
      });
      await engine.loadModel(model, { onProgress: (item) => progress.push(item.percent) });
      expect(await engine.countTokens([{ role: "user", content: "Hello" }])).toBe(12);
      const result = await engine.generate(
        {
          requestId: `generate-${backend}`,
          messages: [{ role: "user", content: "Hello" }],
          maxNewTokens: 32,
          maxWallTimeMs: 30_000,
          temperature: 0
        },
        { onToken: (token) => tokens.push(token) }
      );

      expect(await engine.getCapabilities()).toMatchObject({ backend, streaming: true });
      expect(progress).toEqual([50]);
      expect(tokens).toEqual(["Hello"]);
      expect(result.text).toBe("Hello");
      expect(engine.getStatus()).toBe("ready");
    }
  );

  it("sends cancellation and terminates resources on logout", async () => {
    const worker = new FakeWorker();
    const engine = createBrowserModelEngine(() => worker);
    await engine.initialize({
      backend: "wasm",
      approvedModelOrigins: ["https://huggingface.co"],
      maxContextTokens: 1_024,
      runtimeContract: browserRuntimeContractForModel(model, "wasm")
    });
    await engine.cancel("active-request");
    expect(worker.requests).toContainEqual(
      expect.objectContaining({ type: "CANCEL", targetRequestId: "active-request" })
    );
    engine.terminate();
    expect(worker.terminated).toBe(true);
    expect(engine.getStatus()).toBe("idle");
  });

  it("cancels an in-flight model download by terminating the worker", async () => {
    const worker = new FakeWorker();
    const engine = createBrowserModelEngine(() => worker);
    await engine.initialize({
      backend: "webgpu",
      approvedModelOrigins: ["https://huggingface.co"],
      maxContextTokens: 2_048,
      runtimeContract: browserRuntimeContractForModel(model, "webgpu")
    });
    const loading = engine.loadModel(model);
    engine.terminate();
    await expect(loading).rejects.toMatchObject({ code: "GENERATION_CANCELLED" });
    expect(worker.terminated).toBe(true);
  });

  it("rejects an in-flight load when the worker emits an invalid message", async () => {
    class InvalidWorker extends FakeWorker {
      override postMessage(request: BrowserModelWorkerRequest) {
        this.requests.push(request);
        queueMicrotask(() =>
          this.dispatchEvent(new MessageEvent("message", { data: { type: "BROKEN" } }))
        );
      }
    }
    const worker = new InvalidWorker();
    const engine = createBrowserModelEngine(() => worker);
    await expect(
      engine.initialize({
        backend: "wasm",
        approvedModelOrigins: ["https://huggingface.co"],
        maxContextTokens: 1_024,
        runtimeContract: browserRuntimeContractForModel(model, "wasm")
      })
    ).rejects.toMatchObject({ code: "WORKER_CRASHED" });
  });
});
