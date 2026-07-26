import {
  BrowserInferenceError,
  type BrowserEngineCapabilities,
  type BrowserEngineStatus,
  type BrowserGenerationHandlers,
  type BrowserGenerationRequest,
  type BrowserGenerationResult,
  type BrowserModelConfig,
  type BrowserModelDescriptor,
  type BrowserModelEngine
} from "./browser-inference-types";
import {
  isBrowserModelWorkerResponse,
  type BrowserModelWorkerRequest,
  type BrowserModelWorkerResponse
} from "./browser-model-worker-protocol";
import { recordWorkerStartup } from "./performance";

interface WorkerLike {
  postMessage(message: BrowserModelWorkerRequest): void;
  terminate(): void;
  addEventListener(type: "message" | "error", listener: EventListenerOrEventListenerObject): void;
  removeEventListener(
    type: "message" | "error",
    listener: EventListenerOrEventListenerObject
  ): void;
}

interface PendingRequest {
  resolve: (message: BrowserModelWorkerResponse) => void;
  reject: (error: BrowserInferenceError) => void;
  handlers: BrowserGenerationHandlers;
}

export function createBrowserModelEngine(
  workerFactory: () => WorkerLike = () =>
    new Worker(new URL("./workers/browser-model.worker.ts", import.meta.url), {
      type: "module",
      name: "soko-browser-model"
    })
): BrowserModelEngine {
  return new BrowserWorkerModelEngine(workerFactory);
}

class BrowserWorkerModelEngine implements BrowserModelEngine {
  private worker: WorkerLike | null = null;
  private status: BrowserEngineStatus = "idle";
  private capabilities: BrowserEngineCapabilities | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly onMessage = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    if (!isBrowserModelWorkerResponse(data)) {
      this.rejectAll(
        new BrowserInferenceError("WORKER_CRASHED", "The model worker returned an invalid message.")
      );
      return;
    }
    const request = this.pending.get(data.requestId);
    if (request === undefined) return;

    if (data.type === "TOKEN") {
      request.handlers.onToken?.(data.token);
      return;
    }
    if (data.type === "MODEL_LOAD_STARTED") {
      this.status = "loading";
      return;
    }
    if (data.type === "MODEL_LOAD_PROGRESS") {
      this.status = data.progress.status;
      request.handlers.onProgress?.(data.progress);
      return;
    }
    this.pending.delete(data.requestId);
    if (data.type === "ERROR" || data.type === "MODEL_LOAD_FAILED") {
      this.status = "error";
      request.reject(new BrowserInferenceError(data.code, data.message));
      return;
    }
    request.resolve(data);
  };
  private readonly onError = () => {
    const error = new BrowserInferenceError(
      "WORKER_CRASHED",
      "The on-device model worker stopped unexpectedly."
    );
    this.status = "error";
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  };

  constructor(private readonly workerFactory: () => WorkerLike) {}

  async initialize(config: BrowserModelConfig): Promise<void> {
    const startedAt = performance.now();
    this.status = "initializing";
    recordWorkerStartup("browser-model", "starting");
    try {
      const response = await this.request({ type: "INITIALIZE", requestId: requestId(), config });
      if (response.type !== "READY") {
        throw new BrowserInferenceError("WORKER_CRASHED", "The model worker did not initialize.");
      }
      this.capabilities = response.capabilities;
      this.status = "idle";
      recordWorkerStartup("browser-model", "ready", performance.now() - startedAt);
    } catch (error) {
      recordWorkerStartup("browser-model", "failed", performance.now() - startedAt);
      throw error;
    }
  }

  async loadModel(
    model: BrowserModelDescriptor,
    handlers: Pick<BrowserGenerationHandlers, "onProgress"> = {}
  ): Promise<void> {
    this.status = "loading";
    const response = await this.request(
      { type: "LOAD_MODEL", requestId: requestId(), model },
      handlers
    );
    if (response.type !== "MODEL_READY") {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "The browser model did not load.");
    }
    this.status = "ready";
  }

  async generate(
    request: BrowserGenerationRequest,
    handlers: BrowserGenerationHandlers
  ): Promise<BrowserGenerationResult> {
    if (this.status !== "ready") {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "The browser model is not ready.");
    }
    this.status = "generating";
    try {
      const response = await this.request(
        { type: "GENERATE", requestId: request.requestId, request },
        handlers
      );
      if (response.type !== "GENERATION_COMPLETE") {
        throw new BrowserInferenceError("UNKNOWN", "The browser model returned no completion.");
      }
      return response.result;
    } finally {
      if (this.getStatus() !== "error") this.status = "ready";
    }
  }

  async countTokens(messages: BrowserGenerationRequest["messages"]): Promise<number> {
    if (this.status !== "ready") {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "The browser model is not ready.");
    }
    const response = await this.request({
      type: "COUNT_TOKENS",
      requestId: requestId(),
      messages
    });
    if (response.type !== "TOKEN_COUNT") {
      throw new BrowserInferenceError("UNKNOWN", "The model tokenizer returned no count.");
    }
    return response.tokenCount;
  }

  async cancel(targetRequestId: string): Promise<void> {
    if (this.worker === null) return;
    const response = await this.request({
      type: "CANCEL",
      requestId: requestId(),
      targetRequestId
    });
    if (response.type !== "CANCELLED") {
      throw new BrowserInferenceError("UNKNOWN", "The generation could not be cancelled.");
    }
    this.status = "ready";
  }

  async unload(): Promise<void> {
    if (this.worker === null) return;
    const response = await this.request({ type: "UNLOAD", requestId: requestId() });
    if (response.type !== "UNLOADED") {
      throw new BrowserInferenceError("MODEL_LOAD_FAILED", "The model could not be unloaded.");
    }
    this.status = "idle";
  }

  async getCapabilities(): Promise<BrowserEngineCapabilities> {
    if (this.capabilities === null) {
      throw new BrowserInferenceError(
        "UNSUPPORTED_BROWSER",
        "The model worker is not initialized."
      );
    }
    return { ...this.capabilities };
  }

  getStatus(): BrowserEngineStatus {
    return this.status;
  }

  terminate(): void {
    const error = new BrowserInferenceError(
      "GENERATION_CANCELLED",
      "Browser inference was stopped."
    );
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    if (this.worker !== null) {
      this.worker.removeEventListener("message", this.onMessage);
      this.worker.removeEventListener("error", this.onError);
      this.worker.terminate();
      this.worker = null;
    }
    this.capabilities = null;
    this.status = "idle";
  }

  private rejectAll(error: BrowserInferenceError): void {
    this.status = "error";
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private getWorker(): WorkerLike {
    if (this.worker !== null) return this.worker;
    this.worker = this.workerFactory();
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
    return this.worker;
  }

  private request(
    message: BrowserModelWorkerRequest,
    handlers: BrowserGenerationHandlers = {}
  ): Promise<BrowserModelWorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject, handlers });
      try {
        this.getWorker().postMessage(message);
      } catch (error) {
        this.pending.delete(message.requestId);
        reject(normalizeBrowserInferenceError(error));
      }
    });
  }
}

export function normalizeBrowserInferenceError(error: unknown): BrowserInferenceError {
  if (error instanceof BrowserInferenceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|buffer/i.test(message)) {
    return new BrowserInferenceError("OUT_OF_MEMORY", "The device ran out of model memory.");
  }
  if (/quota|storage/i.test(message)) {
    return new BrowserInferenceError(
      "STORAGE_QUOTA_EXCEEDED",
      "There is not enough browser storage for the model."
    );
  }
  if (/abort|cancel|interrupt/i.test(message)) {
    return new BrowserInferenceError("GENERATION_CANCELLED", "Generation was cancelled.");
  }
  if (/cache|protobuf|decode/i.test(message)) {
    return new BrowserInferenceError(
      "MODEL_CACHE_CORRUPT",
      "The cached model is incomplete or corrupt."
    );
  }
  return new BrowserInferenceError("UNKNOWN", "Browser inference failed safely.");
}

function requestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}
