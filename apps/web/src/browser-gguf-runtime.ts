import type { LoggerWithoutDebug, Wllama } from "@wllama/wllama/esm/index.js";
import wllamaWasmUrl from "@wllama/wllama/esm/wasm/wllama.wasm?url";
import {
  browserGgufRuntimeSupported,
  readLocalAiModelFile,
  type LocalAiModel
} from "./ai-model-manager";
import {
  AgentModelRuntimeError,
  createAgentModelRuntime,
  type AgentModelRuntime,
  type AgentModelRuntimeErrorCode,
  type GenerationResult,
  type NativeAgentModelRuntimeBridge
} from "./agent-model-runtime";

const maximumBrowserGgufBytes = 2 * 1024 ** 3;
interface WllamaModule {
  LoggerWithoutDebug: typeof LoggerWithoutDebug;
  Wllama: typeof Wllama;
}

let wllamaModule: Promise<WllamaModule> | null = null;

/** llama.cpp/WASM implementation of the existing device-model runtime contract. */
export function createBrowserGgufModelRuntime(): AgentModelRuntime {
  const engines = new Map<string, Wllama>();
  const models = new Map<string, LocalAiModel>();
  const loads = new Map<string, Promise<void>>();
  let generationQueue: Promise<void> = Promise.resolve();

  return {
    async inspect(model) {
      if (!browserGgufRuntimeSupported()) {
        return incompatible(model, "RUNTIME_UNAVAILABLE");
      }
      if (model.fileSizeBytes > maximumBrowserGgufBytes) {
        return incompatible(model, "MODEL_INCOMPATIBLE");
      }
      try {
        await readLocalAiModelFile(model);
        return {
          compatible: true,
          backend: "LLAMA_CPP_BROWSER",
          estimatedMemoryBytes: Math.ceil(model.fileSizeBytes * 2.5),
          errorCode: null,
          compatibilityProfile: null
        };
      } catch {
        return incompatible(model, "MODEL_FILE_MISSING");
      }
    },

    async load(model, options) {
      if (engines.get(model.id)?.isModelLoaded() === true) {
        return { installationId: model.id, backend: "LLAMA_CPP_BROWSER" };
      }
      const existing = loads.get(model.id);
      if (existing !== undefined) {
        await existing;
        return { installationId: model.id, backend: "LLAMA_CPP_BROWSER" };
      }

      const inspection = await this.inspect(model);
      if (!inspection.compatible) {
        throw new AgentModelRuntimeError(
          inspection.errorCode ?? "MODEL_INCOMPATIBLE",
          "This GGUF model cannot run in the browser runtime."
        );
      }
      const startedAt = Date.now();
      options?.onEvent?.({ type: "MODEL_LOAD_STARTED", installationId: model.id });
      options?.onEvent?.({
        type: "MODEL_LOAD_PROGRESS",
        installationId: model.id,
        progress: 5,
        elapsedMs: 0
      });
      const loading = (async () => {
        const file = await readLocalAiModelFile(model);
        if (signalAborted(options?.signal)) throw abortError();
        const { LoggerWithoutDebug, Wllama: BrowserLlama } = await loadWllamaModule();
        const engine = new BrowserLlama(
          { default: wllamaWasmUrl },
          { allowOffline: true, suppressNativeLog: true, logger: LoggerWithoutDebug }
        );
        try {
          await engine.loadModel([file], {
            n_ctx: Math.min(2_048, model.contextLength ?? 2_048),
            n_batch: 128,
            n_threads:
              globalThis.crossOriginIsolated === true
                ? Math.max(1, Math.min(4, globalThis.navigator.hardwareConcurrency || 1))
                : 1,
            n_gpu_layers: 0,
            warmup: true
          });
          if (signalAborted(options?.signal)) {
            await engine.exit();
            throw abortError();
          }
          engines.set(model.id, engine);
          models.set(model.id, model);
          options?.onEvent?.({
            type: "MODEL_LOAD_PROGRESS",
            installationId: model.id,
            progress: 100,
            elapsedMs: Date.now() - startedAt
          });
          options?.onEvent?.({ type: "MODEL_READY", installationId: model.id });
        } catch (error) {
          await engine.exit().catch(() => undefined);
          const normalized = browserRuntimeError(error);
          options?.onEvent?.({
            type: "MODEL_LOAD_FAILED",
            installationId: model.id,
            errorCode: normalized.code
          });
          throw normalized;
        }
      })().finally(() => loads.delete(model.id));
      loads.set(model.id, loading);
      await loading;
      return { installationId: model.id, backend: "LLAMA_CPP_BROWSER" };
    },

    async generate(request) {
      const engine = engines.get(request.installationId);
      if (engine?.isModelLoaded() !== true) {
        throw new AgentModelRuntimeError(
          "MODEL_LOAD_FAILED",
          "The selected GGUF model is not loaded."
        );
      }
      const run = async (): Promise<GenerationResult> => {
        const startedAt = Date.now();
        try {
          const result = await engine.createCompletion({
            prompt: request.prompt,
            max_tokens: Math.min(256, Math.max(1, request.maxTokens)),
            temperature: Math.min(1, Math.max(0, request.temperature)),
            ...(request.signal === undefined ? {} : { abortSignal: request.signal })
          });
          const text = result.choices[0]?.text.trim() ?? "";
          if (text.length === 0) {
            throw new AgentModelRuntimeError(
              "MODEL_LOAD_FAILED",
              "The GGUF model returned no output."
            );
          }
          return {
            text,
            durationMs: Date.now() - startedAt,
            inputTokenCount: result.usage.prompt_tokens,
            outputTokenCount: result.usage.completion_tokens
          };
        } catch (error) {
          throw browserRuntimeError(error);
        }
      };
      const queued = generationQueue.then(run, run);
      generationQueue = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    },

    async unload(installationId) {
      loads.delete(installationId);
      models.delete(installationId);
      const engine = engines.get(installationId);
      engines.delete(installationId);
      await engine?.exit().catch(() => undefined);
    },

    async health(installationId) {
      return engines.get(installationId)?.isModelLoaded() === true
        ? { status: "READY", backend: "LLAMA_CPP_BROWSER", errorCode: null }
        : { status: "UNAVAILABLE", backend: "LLAMA_CPP_BROWSER", errorCode: "RUNTIME_UNAVAILABLE" };
    }
  };
}

/** Selects native llama.cpp when appropriate and transparently falls back to browser llama.cpp. */
export function createAdaptiveAgentModelRuntime(
  bridge: NativeAgentModelRuntimeBridge | undefined = window.SokoAgentModelRuntime
): AgentModelRuntime {
  const browser = createBrowserGgufModelRuntime();
  const native = bridge === undefined ? null : createAgentModelRuntime(bridge);
  const runtimeByInstallation = new Map<string, AgentModelRuntime>();
  const select = (model: LocalAiModel): AgentModelRuntime =>
    model.runtimeBackend === "LLAMA_CPP_BROWSER" || native === null ? browser : native;

  return {
    inspect: (model) => select(model).inspect(model),
    async load(model, options) {
      const runtime = select(model);
      const handle = await runtime.load(model, options);
      runtimeByInstallation.set(model.id, runtime);
      return handle;
    },
    generate(request) {
      const runtime = runtimeByInstallation.get(request.installationId);
      if (runtime === undefined) {
        throw new AgentModelRuntimeError("MODEL_LOAD_FAILED", "The selected model is not loaded.");
      }
      return runtime.generate(request);
    },
    async unload(installationId) {
      const runtime = runtimeByInstallation.get(installationId);
      runtimeByInstallation.delete(installationId);
      await runtime?.unload(installationId);
    },
    health(installationId) {
      return (
        runtimeByInstallation.get(installationId)?.health(installationId) ??
        Promise.resolve({ status: "UNAVAILABLE", backend: null, errorCode: "RUNTIME_UNAVAILABLE" })
      );
    }
  };
}

function incompatible(model: LocalAiModel, errorCode: AgentModelRuntimeErrorCode) {
  return {
    compatible: false,
    backend: "LLAMA_CPP_BROWSER" as const,
    estimatedMemoryBytes: Math.ceil(model.fileSizeBytes * 2.5),
    errorCode,
    compatibilityProfile: null
  };
}

function abortError(): AgentModelRuntimeError {
  return new AgentModelRuntimeError("INFERENCE_TIMEOUT", "Browser GGUF inference was cancelled.");
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function browserRuntimeError(error: unknown): AgentModelRuntimeError {
  if (error instanceof AgentModelRuntimeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code: AgentModelRuntimeErrorCode = /memory|allocation|out of bounds/i.test(message)
    ? "INSUFFICIENT_MEMORY"
    : /context|kv.?cache/i.test(message)
      ? "CONTEXT_LIMIT_EXCEEDED"
      : /abort|cancel|timeout/i.test(message)
        ? "INFERENCE_TIMEOUT"
        : /file|gguf|model not found/i.test(message)
          ? "MODEL_FILE_MISSING"
          : "MODEL_LOAD_FAILED";
  return new AgentModelRuntimeError(code, `Browser GGUF runtime failed: ${code}.`);
}

function loadWllamaModule(): Promise<WllamaModule> {
  wllamaModule ??= import("@wllama/wllama/esm/index.js");
  return wllamaModule;
}
