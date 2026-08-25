import type { AgentModelReadinessResult, AgentModelRuntimeBackend } from "@soko/shared-types";
import { renderRuntimeModelOutputInstructions, type RuntimeToolName } from "@soko/tool-core";
import type { LocalAiModel } from "./ai-model-manager";
import {
  evaluateNativeModelCompatibility,
  type NativeModelCompatibilityProfile,
  type NativeModelInspectionAttestation
} from "./inference/native-model-compatibility";

export type AgentModelRuntimeErrorCode =
  | "MODEL_FILE_MISSING"
  | "MODEL_CORRUPT"
  | "MODEL_CHECKSUM_MISMATCH"
  | "MODEL_SIGNATURE_INVALID"
  | "MODEL_INCOMPATIBLE"
  | "MODEL_LICENSE_RESTRICTED"
  | "MODEL_LOAD_FAILED"
  | "BRIDGE_VERSION_UNSUPPORTED"
  | "INSUFFICIENT_MEMORY"
  | "UNSUPPORTED_ARCHITECTURE"
  | "UNSUPPORTED_QUANTIZATION"
  | "RUNTIME_UNAVAILABLE"
  | "INFERENCE_TIMEOUT"
  | "CONTEXT_LIMIT_EXCEEDED"
  | "MODEL_READINESS_MISMATCH";

export interface ModelInspection {
  compatible: boolean;
  backend: AgentModelRuntimeBackend;
  estimatedMemoryBytes: number | null;
  errorCode: AgentModelRuntimeErrorCode | null;
  compatibilityProfile: NativeModelCompatibilityProfile | null;
}

export interface LoadedModelHandle {
  installationId: string;
  backend: AgentModelRuntimeBackend;
}

export type AgentModelRuntimeEvent =
  | { type: "MODEL_LOAD_STARTED"; installationId: string }
  | {
      type: "MODEL_LOAD_PROGRESS";
      installationId: string;
      progress: number | null;
      elapsedMs: number;
    }
  | { type: "MODEL_READY"; installationId: string }
  | { type: "MODEL_LOAD_FAILED"; installationId: string; errorCode: AgentModelRuntimeErrorCode };

export interface GenerationRequest {
  installationId: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface GenerationResult {
  text: string;
  durationMs: number;
  inputTokenCount: number | null;
  outputTokenCount: number | null;
}

export interface ModelRuntimeHealth {
  status: "UNAVAILABLE" | "LOADING" | "LOADED" | "READY" | "FAILED";
  backend: AgentModelRuntimeBackend | null;
  errorCode: AgentModelRuntimeErrorCode | null;
}

export interface AgentModelRuntime {
  inspect(model: LocalAiModel): Promise<ModelInspection>;
  load(
    model: LocalAiModel,
    options?: { signal?: AbortSignal; onEvent?: (event: AgentModelRuntimeEvent) => void }
  ): Promise<LoadedModelHandle>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  unload(installationId: string): Promise<void>;
  health(installationId: string): Promise<ModelRuntimeHealth>;
}

export interface NativeAgentModelRuntimeBridge {
  inspect(input: SafeRuntimeModelDescriptor): Promise<NativeModelInspectionAttestation>;
  load(input: SafeRuntimeModelDescriptor): Promise<void>;
  generate(input: {
    installationId: string;
    prompt: string;
    maxTokens: number;
    temperature: number;
  }): Promise<{
    text: string;
    inputTokenCount?: number | null;
    outputTokenCount?: number | null;
  }>;
  unload(input: { installationId: string }): Promise<void>;
  health(input: { installationId: string }): Promise<{
    status: ModelRuntimeHealth["status"];
    backend?: AgentModelRuntimeBackend | null;
    errorCode?: AgentModelRuntimeErrorCode | null;
  }>;
  readWorkspaceFile?(input: { businessId: string; path: string }): Promise<{
    contentBase64: string;
  }>;
}

interface SafeRuntimeModelDescriptor {
  installationId: string;
  modelId: string;
  storageKey: string;
  format: "GGUF";
  architecture: string | null;
  quantization: string | null;
  contextLength: number | null;
  fileSizeBytes: number;
  checksumSha256: string | null;
  packageManifestVersion: string | null;
  packageSignature: string | null;
  packageSigningKeyId: string | null;
}

declare global {
  interface Window {
    SokoAgentModelRuntime?: NativeAgentModelRuntimeBridge;
  }
}

const readinessPrompt = "Reply with exactly: SOKO_MODEL_READY";
const defaultTimeoutMs = 90_000;

export class AgentModelRuntimeError extends Error {
  constructor(
    readonly code: AgentModelRuntimeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AgentModelRuntimeError";
  }
}

export function createAgentModelRuntime(
  bridge: NativeAgentModelRuntimeBridge | undefined = window.SokoAgentModelRuntime
): AgentModelRuntime {
  const compatibleModels = new Set<string>();
  const loadPromises = new Map<string, Promise<LoadedModelHandle>>();
  const loadedModels = new Map<string, LoadedModelHandle>();

  const inspectWithBridge = async (model: LocalAiModel): Promise<ModelInspection> => {
    if (bridge === undefined) {
      return {
        compatible: false,
        backend: model.runtimeBackend,
        estimatedMemoryBytes: estimateRequiredMemory(model),
        errorCode: "RUNTIME_UNAVAILABLE",
        compatibilityProfile: null
      };
    }
    const result = await bridge.inspect(runtimeDescriptor(model));
    const profile = evaluateNativeModelCompatibility({ model, inspection: result });
    if (profile.passed) compatibleModels.add(model.id);
    else compatibleModels.delete(model.id);
    return {
      compatible: profile.passed,
      backend: result.backend ?? model.runtimeBackend,
      estimatedMemoryBytes: result.estimatedMemoryBytes ?? estimateRequiredMemory(model),
      errorCode: profile.errorCode,
      compatibilityProfile: profile
    };
  };

  return {
    async inspect(model) {
      assertModelRecord(model);
      return inspectWithBridge(model);
    },

    async load(model, options) {
      assertModelRecord(model);
      if (bridge === undefined) {
        throw new AgentModelRuntimeError(
          "RUNTIME_UNAVAILABLE",
          "The on-device llama.cpp runtime is not available in this app."
        );
      }
      if (!compatibleModels.has(model.id)) {
        const inspection = await inspectWithBridge(model);
        if (!inspection.compatible) {
          throw new AgentModelRuntimeError(
            inspection.errorCode ?? "MODEL_INCOMPATIBLE",
            safeRuntimeErrorMessage(inspection.errorCode ?? "MODEL_INCOMPATIBLE")
          );
        }
      }
      const loaded = loadedModels.get(model.id);
      if (loaded !== undefined) return loaded;

      const pending = loadPromises.get(model.id);
      if (pending !== undefined) return pending;

      const startedAt = Date.now();
      options?.onEvent?.({ type: "MODEL_LOAD_STARTED", installationId: model.id });
      const heartbeat = setInterval(() => {
        options?.onEvent?.({
          type: "MODEL_LOAD_PROGRESS",
          installationId: model.id,
          progress: null,
          elapsedMs: Date.now() - startedAt
        });
      }, 5_000);
      const load = withTimeout(
        bridge.load(runtimeDescriptor(model)),
        defaultTimeoutMs,
        options?.signal
      )
        .then(async () => {
          const health = await withTimeout(
            bridge.health({ installationId: model.id }),
            10_000,
            options?.signal
          );
          if (health.status !== "READY" && health.status !== "LOADED") {
            throw new AgentModelRuntimeError(
              health.errorCode ?? "MODEL_LOAD_FAILED",
              "The runtime did not acknowledge that the model is ready."
            );
          }
          const handle = {
            installationId: model.id,
            backend: model.runtimeBackend
          };
          loadedModels.set(model.id, handle);
          options?.onEvent?.({
            type: "MODEL_LOAD_PROGRESS",
            installationId: model.id,
            progress: 100,
            elapsedMs: Date.now() - startedAt
          });
          options?.onEvent?.({ type: "MODEL_READY", installationId: model.id });
          return handle;
        })
        .catch((error: unknown) => {
          const normalized = normalizeRuntimeError(error, "MODEL_LOAD_FAILED");
          options?.onEvent?.({
            type: "MODEL_LOAD_FAILED",
            installationId: model.id,
            errorCode: normalized.code
          });
          throw normalized;
        })
        .finally(() => {
          clearInterval(heartbeat);
          loadPromises.delete(model.id);
        });
      loadPromises.set(model.id, load);
      return load;
    },

    async generate(request) {
      if (bridge === undefined) {
        throw new AgentModelRuntimeError(
          "RUNTIME_UNAVAILABLE",
          "The on-device llama.cpp runtime is not available in this app."
        );
      }
      if (!loadedModels.has(request.installationId)) {
        throw new AgentModelRuntimeError("MODEL_LOAD_FAILED", "The selected model is not loaded.");
      }

      const startedAt = Date.now();
      try {
        const result = await withTimeout(
          bridge.generate({
            installationId: request.installationId,
            prompt: request.prompt,
            maxTokens: Math.min(256, Math.max(1, request.maxTokens)),
            temperature: Math.min(1, Math.max(0, request.temperature))
          }),
          defaultTimeoutMs,
          request.signal
        );
        const text = result.text.trim();
        if (text.length === 0) {
          throw new AgentModelRuntimeError("MODEL_LOAD_FAILED", "The model returned no output.");
        }
        return {
          text,
          durationMs: Date.now() - startedAt,
          inputTokenCount: result.inputTokenCount ?? null,
          outputTokenCount: result.outputTokenCount ?? null
        };
      } catch (error) {
        throw normalizeRuntimeError(error, "MODEL_LOAD_FAILED");
      }
    },

    async unload(installationId) {
      loadPromises.delete(installationId);
      loadedModels.delete(installationId);
      compatibleModels.delete(installationId);
      if (bridge !== undefined) {
        await withTimeout(bridge.unload({ installationId }), 10_000).catch(() => undefined);
      }
    },

    async health(installationId) {
      if (bridge === undefined) {
        return { status: "UNAVAILABLE", backend: null, errorCode: "RUNTIME_UNAVAILABLE" };
      }
      const result = await bridge.health({ installationId });
      return {
        status: result.status,
        backend: result.backend ?? loadedModels.get(installationId)?.backend ?? null,
        errorCode: result.errorCode ?? null
      };
    }
  };
}

export async function testAgentModelRuntime(
  runtime: AgentModelRuntime,
  model: LocalAiModel,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: AgentModelRuntimeEvent) => void;
    onStage?: (stage: "LOAD_ENGINE" | "LOAD_MODEL" | "ALLOCATE_CONTEXT" | "HEALTH_CHECK") => void;
  } = {}
): Promise<AgentModelReadinessResult> {
  const checkedAt = new Date().toISOString();
  const loadStartedAt = Date.now();

  try {
    options.onStage?.("LOAD_ENGINE");
    const inspection = await runtime.inspect(model);
    if (!inspection.compatible) {
      throw new AgentModelRuntimeError(
        inspection.errorCode ?? "MODEL_INCOMPATIBLE",
        "The installed model is not compatible with this runtime."
      );
    }
    options.onStage?.("LOAD_MODEL");
    options.onStage?.("ALLOCATE_CONTEXT");
    await runtime.load(model, options);
    const loadDurationMs = Date.now() - loadStartedAt;
    options.onStage?.("HEALTH_CHECK");
    const generation = await runtime.generate({
      installationId: model.id,
      prompt: readinessPrompt,
      maxTokens: 16,
      temperature: 0,
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
    const ready = normalizeReadinessText(generation.text) === "SOKO_MODEL_READY";
    if (!ready) {
      throw new AgentModelRuntimeError(
        "MODEL_READINESS_MISMATCH",
        "The model loaded but did not return the expected readiness response."
      );
    }
    return {
      success: true,
      modelId: model.modelId,
      installationId: model.id,
      backend: model.runtimeBackend,
      loadDurationMs,
      inferenceDurationMs: generation.durationMs,
      inputTokenCount: generation.inputTokenCount,
      outputTokenCount: generation.outputTokenCount,
      memoryWarning: null,
      errorCode: null,
      message: `${model.displayName} is ready and connected to your agent.`,
      checkedAt
    };
  } catch (error) {
    const normalized = normalizeRuntimeError(error, "MODEL_LOAD_FAILED");
    return {
      success: false,
      modelId: model.modelId,
      installationId: model.id,
      backend: model.runtimeBackend,
      loadDurationMs: Date.now() - loadStartedAt,
      inferenceDurationMs: 0,
      inputTokenCount: null,
      outputTokenCount: null,
      memoryWarning: normalized.code === "INSUFFICIENT_MEMORY" ? normalized.message : null,
      errorCode: normalized.code,
      message: safeRuntimeErrorMessage(normalized.code),
      checkedAt
    };
  }
}

export function buildLocalAgentPrompt(input: {
  role: string;
  instructions: string;
  relevantRecall?: string;
  message: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  availableTools?: RuntimeToolName[];
}): string {
  const history = input.recentMessages
    .slice(-8)
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n");
  return [
    `You are Soko's ${input.role}.`,
    input.instructions,
    ...(input.availableTools === undefined || input.availableTools.length === 0
      ? [
          "Respond directly, briefly, and accurately. Do not claim to have used tools you cannot access."
        ]
      : [renderRuntimeModelOutputInstructions(input.availableTools)]),
    ...(input.relevantRecall === undefined ? [] : [input.relevantRecall]),
    ...(history.length === 0 ? [] : [`Recent conversation:\n${history}`]),
    `User: ${input.message}`,
    "Assistant:"
  ].join("\n\n");
}

export function fallbackAllowed(
  policy: "NEVER" | "WHEN_LOCAL_UNAVAILABLE" | "WHEN_LOCAL_FAILS" | "WHEN_CONTEXT_EXCEEDED",
  errorCode: AgentModelRuntimeErrorCode
): boolean {
  if (policy === "NEVER") return false;
  if (policy === "WHEN_LOCAL_UNAVAILABLE") {
    return errorCode === "RUNTIME_UNAVAILABLE" || errorCode === "MODEL_FILE_MISSING";
  }
  if (policy === "WHEN_CONTEXT_EXCEEDED") return errorCode === "CONTEXT_LIMIT_EXCEEDED";
  return true;
}

function assertModelRecord(model: LocalAiModel): void {
  if (model.installationStatus !== "INSTALLED") {
    throw new AgentModelRuntimeError(
      model.validationError === "MODEL_FILE_MISSING" ? "MODEL_FILE_MISSING" : "MODEL_CORRUPT",
      "The selected model installation is not usable."
    );
  }
  if (!model.commercialUseAllowed) {
    throw new AgentModelRuntimeError(
      "MODEL_LICENSE_RESTRICTED",
      "The selected model is not approved for commercial use."
    );
  }
  if (model.compatibilityStatus !== "COMPATIBLE" && model.compatibilityStatus !== "UNKNOWN") {
    throw new AgentModelRuntimeError(
      model.compatibilityStatus === "INSUFFICIENT_MEMORY"
        ? "INSUFFICIENT_MEMORY"
        : "MODEL_INCOMPATIBLE",
      "The selected model is not compatible with this device."
    );
  }
}

function runtimeDescriptor(model: LocalAiModel): SafeRuntimeModelDescriptor {
  return {
    installationId: model.id,
    modelId: model.modelId,
    storageKey: model.storageKey,
    format: model.format,
    architecture: model.architecture,
    quantization: model.quantization,
    contextLength: model.contextLength,
    fileSizeBytes: model.fileSizeBytes,
    checksumSha256: model.checksum,
    packageManifestVersion: model.packageManifestVersion ?? null,
    packageSignature: model.packageSignature ?? null,
    packageSigningKeyId: model.packageSigningKeyId ?? null
  };
}

function estimateRequiredMemory(model: LocalAiModel): number {
  return Math.ceil(model.fileSizeBytes * 2.5);
}

function normalizeReadinessText(value: string): string {
  return value
    .trim()
    .replace(/^["'`\s]+|["'`\s.]+$/g, "")
    .toUpperCase();
}

function normalizeRuntimeError(
  error: unknown,
  fallbackCode: AgentModelRuntimeErrorCode
): AgentModelRuntimeError {
  if (error instanceof AgentModelRuntimeError) return error;
  if (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  ) {
    return new AgentModelRuntimeError("INFERENCE_TIMEOUT", "Local model inference timed out.");
  }
  return new AgentModelRuntimeError(fallbackCode, safeRuntimeErrorMessage(fallbackCode));
}

function safeRuntimeErrorMessage(code: AgentModelRuntimeErrorCode): string {
  const messages: Record<AgentModelRuntimeErrorCode, string> = {
    MODEL_FILE_MISSING: "The model file is missing from this device.",
    MODEL_CORRUPT: "The installed model file is corrupt.",
    MODEL_CHECKSUM_MISMATCH: "The installed model does not match its trusted SHA-256 checksum.",
    MODEL_SIGNATURE_INVALID: "The model package signature is missing, invalid, or untrusted.",
    MODEL_INCOMPATIBLE: "This model is incompatible with the current device runtime.",
    MODEL_LICENSE_RESTRICTED: "This model is not approved for commercial use.",
    MODEL_LOAD_FAILED: "The local model could not be loaded.",
    BRIDGE_VERSION_UNSUPPORTED: "Update the installed Soko app to use this model securely.",
    INSUFFICIENT_MEMORY: "This device does not have enough available memory for the model.",
    UNSUPPORTED_ARCHITECTURE: "The installed app does not support this model architecture.",
    UNSUPPORTED_QUANTIZATION: "The installed app does not support this model quantization.",
    RUNTIME_UNAVAILABLE: "The on-device llama.cpp runtime is not available in this app.",
    INFERENCE_TIMEOUT: "The local model took too long to respond.",
    CONTEXT_LIMIT_EXCEEDED: "The message exceeds the selected model's context limit.",
    MODEL_READINESS_MISMATCH: "The model loaded but failed the readiness inference."
  };
  return messages[code];
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new AgentModelRuntimeError("INFERENCE_TIMEOUT", "Local inference timed out.")),
      timeoutMs
    );
    if (signal !== undefined) {
      abortListener = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      signal.addEventListener("abort", abortListener, { once: true });
    }
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (signal !== undefined && abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}
