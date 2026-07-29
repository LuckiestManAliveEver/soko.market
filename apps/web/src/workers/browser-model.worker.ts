/// <reference lib="webworker" />

import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  StoppingCriteriaList,
  TextStreamer,
  type TextGenerationPipeline
} from "@huggingface/transformers";
import { assertApprovedBrowserModelUrl } from "../browser-model-registry";
import type {
  BrowserGenerationRequest,
  BrowserGenerationResult,
  BrowserInferenceErrorCode,
  BrowserModelConfig,
  BrowserModelDescriptor,
  BrowserModelProgress,
  ModelMessage
} from "../browser-inference-types";
import {
  isBrowserModelWorkerRequest,
  type BrowserModelWorkerRequest,
  type BrowserModelWorkerResponse
} from "../browser-model-worker-protocol";

const worker = self as DedicatedWorkerGlobalScope;
let config: BrowserModelConfig | null = null;
let activeModel: BrowserModelDescriptor | null = null;
let generator: TextGenerationPipeline | null = null;
let status: "idle" | "ready" | "generating" | "error" = "idle";
const stoppingCriteria = new Map<string, InterruptableStoppingCriteria>();
const cancelledRequests = new Set<string>();

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends.onnx.wasm === undefined) {
  throw new Error("The ONNX WASM backend is unavailable.");
}
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL(
    "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
    import.meta.url
  ).href
};

worker.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isBrowserModelWorkerRequest(request)) return;
  void handleRequest(request).catch((error: unknown) => {
    if (__DEPLOYMENT_ENV__ === "staging" && request.type === "LOAD_MODEL") {
      console.error(
        "Browser model staging diagnostic:",
        error instanceof Error ? error.message : String(error)
      );
    }
    status = "error";
    if (request.type === "LOAD_MODEL") {
      const code = workerErrorCode(error);
      post({
        type: "MODEL_LOAD_FAILED",
        requestId: request.requestId,
        code,
        message: safeWorkerErrorMessage(code)
      });
      return;
    }
    post({
      type: "ERROR",
      requestId: request.requestId,
      code: workerErrorCode(error),
      message: safeWorkerErrorMessage(workerErrorCode(error))
    });
  });
});

async function handleRequest(request: BrowserModelWorkerRequest): Promise<void> {
  switch (request.type) {
    case "INITIALIZE":
      config = request.config;
      post({
        type: "READY",
        requestId: request.requestId,
        capabilities: {
          backend: config.backend,
          tokenizerAvailable: true,
          streaming: true,
          cancellation: true,
          contextWindowTokens: config.maxContextTokens,
          runtimeContract: config.runtimeContract
        }
      });
      return;
    case "LOAD_MODEL":
      await loadModel(request.requestId, request.model);
      return;
    case "COUNT_TOKENS":
      post({
        type: "TOKEN_COUNT",
        requestId: request.requestId,
        tokenCount: countTokens(request.messages)
      });
      return;
    case "GENERATE":
      await generate(request.requestId, request.request.messages, request.request);
      return;
    case "CANCEL": {
      cancelledRequests.add(request.targetRequestId);
      stoppingCriteria.get(request.targetRequestId)?.interrupt();
      post({
        type: "CANCELLED",
        requestId: request.requestId,
        targetRequestId: request.targetRequestId
      });
      return;
    }
    case "UNLOAD":
      await generator?.dispose();
      generator = null;
      activeModel = null;
      status = "idle";
      post({ type: "UNLOADED", requestId: request.requestId });
      return;
    case "HEALTH":
      post({ type: "HEALTH", requestId: request.requestId, status });
  }
}

async function loadModel(requestId: string, model: BrowserModelDescriptor): Promise<void> {
  if (config === null) throw new Error("Worker is not initialized.");
  if (model.runtimeAdapter !== "transformers-js") {
    throw new Error("The Transformers.js worker received an incompatible runtime profile.");
  }
  if (!model.supportedBackends.includes(config.backend)) {
    throw new Error(`${config.backend} is not supported by this model.`);
  }
  const repositoryId = assertApprovedBrowserModelUrl(model);
  const dtype = model.dtypeByBackend[config.backend];
  if (dtype === undefined) throw new Error(`${config.backend} has no approved model dtype.`);
  if (!config.approvedModelOrigins.includes(new URL(model.modelUrl).origin)) {
    throw new Error("Model origin is not approved.");
  }
  if (activeModel?.id === model.id && generator !== null) {
    post({ type: "MODEL_READY", requestId, modelId: model.id });
    return;
  }
  post({ type: "MODEL_LOAD_STARTED", requestId, modelId: model.id });
  await generator?.dispose();
  generator = null;
  status = "idle";
  const loaded = await pipeline(model.pipeline, repositoryId, {
    device: config.backend,
    dtype,
    revision: model.modelRevision,
    progress_callback: (progress: unknown) => {
      const parsed = parseProgress(progress);
      if (parsed !== null) post({ type: "MODEL_LOAD_PROGRESS", requestId, progress: parsed });
    }
  });
  generator = loaded;
  activeModel = model;
  status = "ready";
  post({ type: "MODEL_READY", requestId, modelId: model.id });
}

function countTokens(messages: ModelMessage[]): number {
  if (generator === null) throw new Error("Model tokenizer is not loaded.");
  const tokenizer = generator.tokenizer as unknown as {
    apply_chat_template?: (input: ModelMessage[], options: Record<string, unknown>) => unknown;
    encode?: (text: string) => unknown;
  };
  const templated = tokenizer.apply_chat_template?.(messages, {
    tokenize: true,
    add_generation_prompt: true
  });
  const templatedLength = tokenSequenceLength(templated);
  if (templatedLength !== null) return templatedLength;

  const encoded = tokenizer.encode?.(
    messages.map((message) => `${message.role}: ${message.content}`).join("\n")
  );
  const encodedLength = tokenSequenceLength(encoded);
  if (encodedLength !== null) return encodedLength;
  throw new Error("Model tokenizer did not return a token sequence.");
}

function tokenSequenceLength(value: unknown): number | null {
  if (Array.isArray(value)) {
    return Array.isArray(value[0]) ? value[0].length : value.length;
  }
  if (typeof value !== "object" || value === null) return null;
  const sequence = value as { dims?: unknown; data?: unknown };
  if (Array.isArray(sequence.dims)) {
    const lastDimension = sequence.dims.at(-1);
    if (typeof lastDimension === "number" && Number.isFinite(lastDimension)) {
      return lastDimension;
    }
  }
  if (
    typeof sequence.data === "object" &&
    sequence.data !== null &&
    "length" in sequence.data &&
    typeof (sequence.data as { length?: unknown }).length === "number"
  ) {
    return (sequence.data as { length: number }).length;
  }
  return null;
}

async function generate(
  requestId: string,
  messages: ModelMessage[],
  request: BrowserGenerationRequest
): Promise<void> {
  if (generator === null || activeModel === null || config === null) {
    throw new Error("Model is not loaded.");
  }
  if (status === "generating") throw new Error("A generation is already running.");
  if (request.maxNewTokens > activeModel.recommendedOutputTokens.high || request.maxNewTokens < 1) {
    throw new Error("Generation token limit is invalid.");
  }
  if (
    !Number.isInteger(request.maxWallTimeMs) ||
    request.maxWallTimeMs < 1_000 ||
    request.maxWallTimeMs > 120_000
  ) {
    throw new Error("Generation time limit is invalid.");
  }
  status = "generating";
  const startedAt = performance.now();
  let firstTokenAt: number | null = null;
  let tokenCount = 0;
  let streamedText = "";
  const interrupt = new InterruptableStoppingCriteria();
  const criteria = new StoppingCriteriaList();
  criteria.push(interrupt);
  let timedOut = false;
  const deadline = worker.setTimeout(() => {
    timedOut = true;
    interrupt.interrupt();
  }, request.maxWallTimeMs);
  stoppingCriteria.set(requestId, interrupt);
  cancelledRequests.delete(requestId);

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token: string) => {
      if (firstTokenAt === null) firstTokenAt = performance.now();
      streamedText += token;
      post({ type: "TOKEN", requestId, token, tokenCount });
    },
    token_callback_function: (tokens: bigint[]) => {
      tokenCount += tokens.length;
    }
  });

  try {
    const generateWithStopping = generator as unknown as (
      input: ModelMessage[],
      options: Record<string, unknown>
    ) => Promise<unknown>;
    const output = await generateWithStopping(messages, {
      max_new_tokens: request.maxNewTokens,
      do_sample: request.temperature > 0,
      temperature: Math.max(0.01, request.temperature),
      streamer,
      stopping_criteria: criteria
    });
    if (timedOut) {
      post({
        type: "ERROR",
        requestId,
        code: "TASK_BUDGET_EXCEEDED",
        message: safeWorkerErrorMessage("TASK_BUDGET_EXCEEDED")
      });
      return;
    }
    if (cancelledRequests.has(requestId)) {
      post({
        type: "ERROR",
        requestId,
        code: "GENERATION_CANCELLED",
        message: safeWorkerErrorMessage("GENERATION_CANCELLED")
      });
      return;
    }
    const text = streamedText.trim() || extractGeneratedText(output);
    if (text.length === 0) throw new Error("The model returned no text.");
    const durationMs = Math.max(1, performance.now() - startedAt);
    const result: BrowserGenerationResult = {
      requestId,
      text,
      promptTokenCount: null,
      generatedTokenCount: tokenCount || null,
      durationMs: Math.round(durationMs),
      timeToFirstTokenMs:
        firstTokenAt === null ? null : Math.round(Math.max(0, firstTokenAt - startedAt)),
      tokensPerSecond:
        tokenCount === 0 ? null : Math.round((tokenCount / (durationMs / 1_000)) * 100) / 100
    };
    post({ type: "GENERATION_COMPLETE", requestId, result });
  } finally {
    worker.clearTimeout(deadline);
    stoppingCriteria.delete(requestId);
    cancelledRequests.delete(requestId);
    status = generator === null ? "idle" : "ready";
  }
}

function extractGeneratedText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const first = output[0] as { generated_text?: unknown } | undefined;
  if (typeof first?.generated_text === "string") return first.generated_text.trim();
  if (Array.isArray(first?.generated_text)) {
    const assistant = first.generated_text
      .filter(
        (message): message is { role: string; content: string } =>
          typeof message === "object" &&
          message !== null &&
          (message as { role?: unknown }).role === "assistant" &&
          typeof (message as { content?: unknown }).content === "string"
      )
      .at(-1);
    return assistant?.content.trim() ?? "";
  }
  return "";
}

function parseProgress(value: unknown): BrowserModelProgress | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as {
    status?: unknown;
    file?: unknown;
    loaded?: unknown;
    total?: unknown;
    progress?: unknown;
  };
  if (
    item.status !== "progress" &&
    item.status !== "download" &&
    item.status !== "initiate" &&
    item.status !== "ready"
  ) {
    return null;
  }
  const loaded = typeof item.loaded === "number" ? item.loaded : undefined;
  const total = typeof item.total === "number" ? item.total : undefined;
  const percent =
    typeof item.progress === "number"
      ? Math.max(0, Math.min(100, item.progress))
      : loaded !== undefined && total !== undefined && total > 0
        ? Math.round((loaded / total) * 100)
        : item.status === "ready"
          ? 100
          : 0;
  return {
    status: item.status === "ready" ? "loading" : "downloading",
    ...(typeof item.file === "string" ? { file: item.file } : {}),
    ...(loaded === undefined ? {} : { loadedBytes: loaded }),
    ...(total === undefined ? {} : { totalBytes: total }),
    percent
  };
}

function workerErrorCode(error: unknown): BrowserInferenceErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|buffer/i.test(message)) return "OUT_OF_MEMORY";
  if (/quota|storage/i.test(message)) return "STORAGE_QUOTA_EXCEEDED";
  if (/cache|protobuf|decode/i.test(message)) return "MODEL_CACHE_CORRUPT";
  if (/download|fetch|network/i.test(message)) return "MODEL_DOWNLOAD_FAILED";
  if (/cancel|interrupt|abort/i.test(message)) return "GENERATION_CANCELLED";
  return "MODEL_LOAD_FAILED";
}

function safeWorkerErrorMessage(code: BrowserInferenceErrorCode): string {
  const messages: Record<BrowserInferenceErrorCode, string> = {
    WEBGPU_UNAVAILABLE: "WebGPU is unavailable.",
    WASM_UNAVAILABLE: "WebAssembly is unavailable.",
    MODEL_DOWNLOAD_FAILED: "The browser model download failed.",
    MODEL_CACHE_CORRUPT: "The cached browser model is corrupt.",
    MODEL_LOAD_FAILED: "The browser model could not be loaded.",
    OUT_OF_MEMORY: "The browser ran out of memory while loading the model.",
    CONTEXT_LIMIT_EXCEEDED: "The request exceeds the browser model context limit.",
    TASK_BUDGET_EXCEEDED: "The browser task exceeded its execution time budget.",
    GENERATION_CANCELLED: "Generation was cancelled.",
    WORKER_CRASHED: "The browser model worker stopped unexpectedly.",
    STORAGE_QUOTA_EXCEEDED: "There is not enough browser storage for the model.",
    UNSUPPORTED_BROWSER: "This browser does not support local inference.",
    UNKNOWN: "Browser inference failed safely."
  };
  return messages[code];
}

function post(message: BrowserModelWorkerResponse): void {
  worker.postMessage(message);
}
