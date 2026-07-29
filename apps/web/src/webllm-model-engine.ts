import type {
  AppConfig,
  ChatCompletionChunk,
  InitProgressReport,
  MLCEngineInterface,
  ModelRecord
} from "@mlc-ai/web-llm";
import {
  BrowserInferenceError,
  type BrowserEngineCapabilities,
  type BrowserEngineStatus,
  type BrowserGenerationHandlers,
  type BrowserGenerationRequest,
  type BrowserGenerationResult,
  type BrowserModelConfig,
  type BrowserModelDescriptor,
  type BrowserModelEngine,
  type BrowserModelProgress
} from "./browser-inference-types";
import { assertApprovedBrowserModelUrl } from "./browser-model-registry";
import { normalizeBrowserInferenceError } from "./browser-model-engine";

interface WebLlmModule {
  CreateWebWorkerMLCEngine(
    worker: Worker,
    modelId: string,
    engineConfig: {
      appConfig: AppConfig;
      initProgressCallback: (report: InitProgressReport) => void;
      logLevel: "ERROR";
    },
    chatOpts: { context_window_size: number }
  ): Promise<MLCEngineInterface>;
  prebuiltAppConfig: AppConfig;
  deleteModelAllInfoInCache(modelId: string, appConfig?: AppConfig): Promise<void>;
}

type WebLlmModuleLoader = () => Promise<WebLlmModule>;

const loadWebLlmModule: WebLlmModuleLoader = async () =>
  (await import("@mlc-ai/web-llm")) as WebLlmModule;

export function createWebLlmModelEngine(input?: {
  workerFactory?: () => Worker;
  moduleLoader?: WebLlmModuleLoader;
}): BrowserModelEngine {
  return new WebLlmModelEngine(
    input?.workerFactory ??
      (() =>
        new Worker(new URL("./workers/webllm-model.worker.ts", import.meta.url), {
          type: "module",
          name: "soko-webllm-model"
        })),
    input?.moduleLoader ?? loadWebLlmModule
  );
}

class WebLlmModelEngine implements BrowserModelEngine {
  private config: BrowserModelConfig | null = null;
  private engine: MLCEngineInterface | null = null;
  private worker: Worker | null = null;
  private activeModel: BrowserModelDescriptor | null = null;
  private activeRequestId: string | null = null;
  private status: BrowserEngineStatus = "idle";
  private generationCancelled = false;

  constructor(
    private readonly workerFactory: () => Worker,
    private readonly moduleLoader: WebLlmModuleLoader
  ) {}

  async initialize(config: BrowserModelConfig): Promise<void> {
    if (config.backend !== "webgpu" || config.runtimeContract.adapterId !== "webllm") {
      throw new BrowserInferenceError(
        "UNSUPPORTED_BROWSER",
        "WebLLM requires its WebGPU runtime contract."
      );
    }
    this.config = config;
    this.status = "idle";
  }

  async loadModel(
    model: BrowserModelDescriptor,
    handlers: Pick<BrowserGenerationHandlers, "onProgress"> = {}
  ): Promise<void> {
    if (this.config === null) {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "WebLLM is not initialized.");
    }
    if (model.runtimeAdapter !== "webllm" || !model.supportedBackends.includes("webgpu")) {
      throw new BrowserInferenceError(
        "MODEL_LOAD_FAILED",
        "The selected model is not a WebLLM WebGPU profile."
      );
    }
    assertApprovedBrowserModelUrl(model);
    if (this.activeModel?.id === model.id && this.engine !== null) {
      this.status = "ready";
      return;
    }

    this.status = "loading";
    await this.unload().catch(() => undefined);
    this.status = "loading";
    const webllm = await this.moduleLoader();
    const appConfig = pinnedWebLlmAppConfig(webllm.prebuiltAppConfig, model);
    this.worker = this.workerFactory();
    try {
      this.engine = await webllm.CreateWebWorkerMLCEngine(
        this.worker,
        model.runtimeModelId,
        {
          appConfig,
          initProgressCallback: (report) => handlers.onProgress?.(webLlmProgress(report)),
          logLevel: "ERROR"
        },
        { context_window_size: this.config.maxContextTokens }
      );
      this.activeModel = model;
      this.status = "ready";
    } catch (error) {
      this.worker.terminate();
      this.worker = null;
      this.engine = null;
      this.activeModel = null;
      this.status = "error";
      const normalized = normalizeBrowserInferenceError(error);
      throw normalized.code === "UNKNOWN"
        ? new BrowserInferenceError("MODEL_LOAD_FAILED", "The WebLLM model could not be loaded.")
        : normalized;
    }
  }

  async generate(
    request: BrowserGenerationRequest,
    handlers: BrowserGenerationHandlers
  ): Promise<BrowserGenerationResult> {
    if (this.engine === null || this.activeModel === null || this.status !== "ready") {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "The WebLLM model is not ready.");
    }
    if (
      request.maxNewTokens < 1 ||
      request.maxNewTokens > this.activeModel.recommendedOutputTokens.high
    ) {
      throw new BrowserInferenceError("TASK_BUDGET_EXCEEDED", "The output budget is invalid.");
    }
    if (request.maxWallTimeMs < 1_000 || request.maxWallTimeMs > 120_000) {
      throw new BrowserInferenceError("TASK_BUDGET_EXCEEDED", "The time budget is invalid.");
    }

    this.status = "generating";
    this.activeRequestId = request.requestId;
    this.generationCancelled = false;
    const startedAt = performance.now();
    let firstTokenAt: number | null = null;
    let text = "";
    let promptTokens: number | null = null;
    let generatedTokens: number | null = null;
    let tokensPerSecond: number | null = null;
    let timedOut = false;
    const deadline = globalThis.setTimeout(() => {
      timedOut = true;
      this.engine?.interruptGenerate();
    }, request.maxWallTimeMs);

    try {
      const stream = await this.engine.chat.completions.create({
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: request.maxNewTokens,
        temperature: request.temperature,
        seed: 0
      });
      for await (const chunk of stream) {
        const token = streamedChunkText(chunk);
        if (token.length > 0) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          text += token;
          handlers.onToken?.(token);
        }
        if (chunk.usage !== undefined) {
          promptTokens = chunk.usage.prompt_tokens;
          generatedTokens = chunk.usage.completion_tokens;
          tokensPerSecond = finiteNumber(chunk.usage.extra?.decode_tokens_per_s);
        }
      }
      if (timedOut) {
        throw new BrowserInferenceError(
          "TASK_BUDGET_EXCEEDED",
          "The WebLLM task exceeded its execution time budget."
        );
      }
      if (this.generationCancelled) {
        throw new BrowserInferenceError("GENERATION_CANCELLED", "Generation was cancelled.");
      }
      if (text.trim().length === 0) {
        throw new BrowserInferenceError("MODEL_LOAD_FAILED", "WebLLM returned no text.");
      }
      const durationMs = Math.max(1, performance.now() - startedAt);
      return {
        requestId: request.requestId,
        text: text.trim(),
        promptTokenCount: promptTokens,
        generatedTokenCount: generatedTokens,
        durationMs: Math.round(durationMs),
        timeToFirstTokenMs:
          firstTokenAt === null ? null : Math.round(Math.max(0, firstTokenAt - startedAt)),
        tokensPerSecond
      };
    } catch (error) {
      if (error instanceof BrowserInferenceError) throw error;
      throw normalizeBrowserInferenceError(error);
    } finally {
      globalThis.clearTimeout(deadline);
      this.activeRequestId = null;
      this.status = this.engine === null ? "idle" : "ready";
    }
  }

  async countTokens(messages: BrowserGenerationRequest["messages"]): Promise<number> {
    if (this.engine === null || this.status !== "ready") {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "The WebLLM model is not ready.");
    }
    return messages.reduce(
      (total, message) => total + Math.max(1, Math.ceil(message.content.length / 3)) + 8,
      4
    );
  }

  async cancel(requestId: string): Promise<void> {
    if (requestId !== this.activeRequestId || this.engine === null) return;
    this.generationCancelled = true;
    this.engine.interruptGenerate();
  }

  async unload(): Promise<void> {
    this.engine?.interruptGenerate();
    await this.engine?.unload();
    this.worker?.terminate();
    this.engine = null;
    this.worker = null;
    this.activeModel = null;
    this.activeRequestId = null;
    this.status = "idle";
  }

  async getCapabilities(): Promise<BrowserEngineCapabilities> {
    if (this.config === null) {
      throw new BrowserInferenceError("UNSUPPORTED_BROWSER", "WebLLM is not initialized.");
    }
    return {
      backend: "webgpu",
      tokenizerAvailable: false,
      streaming: true,
      cancellation: true,
      contextWindowTokens: this.config.maxContextTokens,
      runtimeContract: this.config.runtimeContract
    };
  }

  getStatus(): BrowserEngineStatus {
    return this.status;
  }

  terminate(): void {
    this.engine?.interruptGenerate();
    this.worker?.terminate();
    this.engine = null;
    this.worker = null;
    this.activeModel = null;
    this.activeRequestId = null;
    this.config = null;
    this.status = "idle";
  }
}

export function pinnedWebLlmAppConfig(
  prebuiltAppConfig: AppConfig,
  model: BrowserModelDescriptor
): AppConfig {
  if (model.runtimeAdapter !== "webllm") {
    throw new Error("Only WebLLM profiles can create a WebLLM app configuration.");
  }
  assertApprovedBrowserModelUrl(model);
  const record = prebuiltAppConfig.model_list.find(
    (candidate) => candidate.model_id === model.runtimeModelId
  );
  if (record === undefined) {
    throw new Error("The WebLLM package does not contain the selected model contract.");
  }
  const pinnedRecord: ModelRecord = {
    ...record,
    model: `${model.modelUrl.replace(/\/+$/u, "")}/resolve/${model.modelRevision}/`,
    model_lib: pinnedWebLlmLibraryUrl(record.model_lib, model),
    overrides: {
      ...record.overrides,
      context_window_size: model.contextWindowTokens
    }
  };
  return { model_list: [pinnedRecord], cacheBackend: "cache" };
}

function pinnedWebLlmLibraryUrl(modelLibraryUrl: string, model: BrowserModelDescriptor): string {
  if (model.runtimeLibraryRevision === undefined) {
    throw new Error("The WebLLM model library revision is missing.");
  }
  const url = new URL(modelLibraryUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "raw.githubusercontent.com" ||
    !url.pathname.startsWith("/mlc-ai/binary-mlc-llm-libs/main/")
  ) {
    throw new Error("The WebLLM model library URL is not approved.");
  }
  url.pathname = url.pathname.replace(
    "/mlc-ai/binary-mlc-llm-libs/main/",
    `/mlc-ai/binary-mlc-llm-libs/${model.runtimeLibraryRevision}/`
  );
  return url.toString();
}

export async function clearWebLlmModelCaches(models: BrowserModelDescriptor[]): Promise<void> {
  const webllm = await loadWebLlmModule();
  for (const model of models.filter((candidate) => candidate.runtimeAdapter === "webllm")) {
    const appConfig = pinnedWebLlmAppConfig(webllm.prebuiltAppConfig, model);
    await webllm.deleteModelAllInfoInCache(model.runtimeModelId, appConfig);
  }
}

function webLlmProgress(report: InitProgressReport): BrowserModelProgress {
  const percent = Math.max(0, Math.min(100, Math.round(report.progress * 100)));
  return {
    status: percent >= 100 ? "loading" : "downloading",
    file: report.text.slice(0, 160),
    percent
  };
}

function streamedChunkText(chunk: ChatCompletionChunk): string {
  const content = chunk.choices[0]?.delta.content;
  return typeof content === "string" ? content : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
