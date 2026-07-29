import type { AppConfig, ChatCompletionChunk, MLCEngineInterface } from "@mlc-ai/web-llm";
import { describe, expect, it, vi } from "vitest";
import { browserRuntimeContractForModel } from "../apps/web/src/browser-inference-contracts";
import { getBrowserModel } from "../apps/web/src/browser-model-registry";
import {
  createWebLlmModelEngine,
  pinnedWebLlmAppConfig
} from "../apps/web/src/webllm-model-engine";

const webLlmModel = getBrowserModel("smollm2-360m-instruct-webllm")!;
const prebuiltAppConfig: AppConfig = {
  model_list: [
    {
      model: webLlmModel.modelUrl,
      model_id: webLlmModel.runtimeModelId,
      model_lib:
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/model.wasm",
      overrides: { context_window_size: 4_096 }
    }
  ]
};

describe("WebLLM model engine", () => {
  it("pins the MLC weights while preserving the package-matched model library", () => {
    expect(pinnedWebLlmAppConfig(prebuiltAppConfig, webLlmModel)).toEqual({
      cacheBackend: "cache",
      model_list: [
        expect.objectContaining({
          model: `${webLlmModel.modelUrl}/resolve/${webLlmModel.modelRevision}/`,
          model_id: webLlmModel.runtimeModelId,
          model_lib:
            "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/model.wasm",
          overrides: { context_window_size: 2_048 }
        })
      ]
    });
  });

  it("loads in a worker, streams output, and reports the stable runtime contract", async () => {
    const unload = vi.fn(async () => undefined);
    const interruptGenerate = vi.fn();
    const fakeRuntime = {
      chat: {
        completions: {
          create: vi.fn(async () => chunks())
        }
      },
      unload,
      interruptGenerate
    } as unknown as MLCEngineInterface;
    const createRuntime = vi.fn(
      async (
        _worker: Worker,
        _modelId: string,
        config: { initProgressCallback: (report: unknown) => void }
      ) => {
        config.initProgressCallback({ progress: 0.5, timeElapsed: 1, text: "Loading weights" });
        return fakeRuntime;
      }
    );
    const worker = { terminate: vi.fn() } as unknown as Worker;
    const engine = createWebLlmModelEngine({
      workerFactory: () => worker,
      moduleLoader: async () =>
        ({
          CreateWebWorkerMLCEngine: createRuntime,
          prebuiltAppConfig,
          deleteModelAllInfoInCache: vi.fn(async () => undefined)
        }) as never
    });
    const runtimeContract = browserRuntimeContractForModel(webLlmModel, "webgpu");
    await engine.initialize({
      backend: "webgpu",
      approvedModelOrigins: ["https://huggingface.co"],
      maxContextTokens: 1_024,
      runtimeContract
    });
    const progress: number[] = [];
    await engine.loadModel(webLlmModel, {
      onProgress: (item) => progress.push(item.percent)
    });
    const tokens: string[] = [];
    const result = await engine.generate(
      {
        requestId: "webllm-request",
        messages: [{ role: "user", content: "Hello" }],
        maxNewTokens: 32,
        maxWallTimeMs: 30_000,
        temperature: 0
      },
      { onToken: (token) => tokens.push(token) }
    );

    expect(createRuntime).toHaveBeenCalledWith(
      worker,
      webLlmModel.runtimeModelId,
      expect.objectContaining({
        appConfig: expect.objectContaining({ cacheBackend: "cache" }),
        logLevel: "ERROR"
      }),
      { context_window_size: 1_024 }
    );
    expect(tokens).toEqual(["Hello", " WebLLM"]);
    expect(result).toMatchObject({
      text: "Hello WebLLM",
      promptTokenCount: 7,
      generatedTokenCount: 2,
      tokensPerSecond: 12.5
    });
    expect(await engine.getCapabilities()).toMatchObject({
      tokenizerAvailable: false,
      runtimeContract
    });
    expect(await engine.countTokens([{ role: "user", content: "Hello" }])).toBeGreaterThan(0);
    expect(progress).toEqual([50]);
  });
});

async function* chunks(): AsyncIterable<ChatCompletionChunk> {
  yield {
    choices: [{ delta: { content: "Hello", role: "assistant" } }],
    usage: undefined
  } as unknown as ChatCompletionChunk;
  yield {
    choices: [{ delta: { content: " WebLLM" } }],
    usage: {
      prompt_tokens: 7,
      completion_tokens: 2,
      total_tokens: 9,
      extra: { decode_tokens_per_s: 12.5 }
    }
  } as unknown as ChatCompletionChunk;
}
