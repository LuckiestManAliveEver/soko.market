import { describe, expect, it } from "vitest";
import { createBrowserModelEngine } from "../apps/web/src/browser-model-engine";
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
          contextWindowTokens: request.config.maxContextTokens
        }
      });
    } else if (request.type === "LOAD_MODEL") {
      this.message({
        type: "MODEL_PROGRESS",
        requestId: request.requestId,
        progress: { status: "downloading", percent: 50 }
      });
      this.message({
        type: "MODEL_LOADED",
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
  id: "model",
  displayName: "Model",
  provider: "browser-local",
  architecture: "llama",
  modelUrl: "https://huggingface.co/onnx-community/model",
  modelFormat: "ONNX",
  quantization: "q4",
  approximateDownloadBytes: 100,
  approximateRuntimeMemoryBytes: 200,
  contextWindowTokens: 2_048,
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
        maxContextTokens: 2_048
      });
      await engine.loadModel(model, { onProgress: (item) => progress.push(item.percent) });
      expect(await engine.countTokens([{ role: "user", content: "Hello" }])).toBe(12);
      const result = await engine.generate(
        {
          requestId: `generate-${backend}`,
          messages: [{ role: "user", content: "Hello" }],
          maxNewTokens: 32,
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
      maxContextTokens: 1_024
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
      maxContextTokens: 2_048
    });
    const loading = engine.loadModel(model);
    engine.terminate();
    await expect(loading).rejects.toMatchObject({ code: "GENERATION_CANCELLED" });
    expect(worker.terminated).toBe(true);
  });
});
