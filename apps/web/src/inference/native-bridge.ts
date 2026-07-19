import type { InferenceChunk, InferenceProvider, InferenceRequest } from "@soko/shared-types";

export interface LocalModelInfo {
  id: string;
  displayName: string;
  sizeBytes?: number;
}

export interface NativeLlamaBridge {
  getStatus(): Promise<{
    available: boolean;
    version?: string;
    loadedModelId?: string;
  }>;
  listModels(): Promise<LocalModelInfo[]>;
  loadModel(modelId: string): Promise<void>;
  generate(request: InferenceRequest, onChunk: (chunk: InferenceChunk) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

export function detectNativeLlamaBridge(): NativeLlamaBridge {
  const candidate = (globalThis as typeof globalThis & { sokoNativeInference?: NativeLlamaBridge })
    .sokoNativeInference;
  return isNativeLlamaBridge(candidate) ? candidate : unavailableNativeLlamaBridge;
}

export function createNativeLlamaProvider(
  bridge: NativeLlamaBridge,
  enabled: boolean
): InferenceProvider {
  return {
    id: "native-llama-cpp",
    runtime: "native-llama-cpp",
    async isAvailable() {
      return enabled && (await bridge.getStatus()).available;
    },
    async supports(modelId) {
      return enabled && (await bridge.listModels()).some((model) => model.id === modelId);
    },
    async *generate(request) {
      const queue = createChunkQueue();
      void bridge.generate(request, queue.push).then(queue.close, queue.fail);
      yield* queue.iterate();
    },
    cancel: (requestId) => bridge.cancel(requestId)
  };
}

const unavailableNativeLlamaBridge: NativeLlamaBridge = {
  async getStatus() {
    return { available: false };
  },
  async listModels() {
    return [];
  },
  async loadModel() {
    throw new Error("Native inference is unavailable.");
  },
  async generate() {
    throw new Error("Native inference is unavailable.");
  },
  async cancel() {}
};

function isNativeLlamaBridge(value: unknown): value is NativeLlamaBridge {
  if (typeof value !== "object" || value === null) return false;
  const bridge = value as Partial<NativeLlamaBridge>;
  return (
    typeof bridge.getStatus === "function" &&
    typeof bridge.listModels === "function" &&
    typeof bridge.loadModel === "function" &&
    typeof bridge.generate === "function" &&
    typeof bridge.cancel === "function"
  );
}

function createChunkQueue() {
  const chunks: InferenceChunk[] = [];
  const waiters: Array<() => void> = [];
  let finished = false;
  let failure: unknown;
  const wake = () => waiters.splice(0).forEach((resolve) => resolve());
  return {
    push(chunk: InferenceChunk) {
      chunks.push(chunk);
      wake();
    },
    close() {
      finished = true;
      wake();
    },
    fail(error: unknown) {
      failure = error;
      finished = true;
      wake();
    },
    async *iterate(): AsyncIterable<InferenceChunk> {
      while (!finished || chunks.length > 0) {
        const chunk = chunks.shift();
        if (chunk !== undefined) {
          yield chunk;
          continue;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (failure !== undefined) throw failure;
    }
  };
}
