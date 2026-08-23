import type {
  BrowserCheckpointCompatibilityContract,
  BrowserRuntimeAdapterId,
  BrowserRuntimeContract,
  InferenceRuntime
} from "@soko/shared-types";

export type {
  BrowserCheckpointCompatibilityContract,
  BrowserRuntimeAdapterId,
  BrowserRuntimeContract
} from "@soko/shared-types";

export type BrowserInferenceBackend = "webgpu" | "wasm" | "none";
export type BrowserDeviceTier = "low" | "medium" | "high";
export type BrowserModelDtype = "q4" | "q8" | "fp16";
export type BrowserCheckpointKind = "task-state" | "token-replay" | "native-kv";
export type BrowserModelTaskClass =
  "short-chat" | "classification" | "field-extraction" | "summarization";

export interface BrowserTaskBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallTimeMs: number;
  maxEstimatedMemoryBytes: number;
  continuationAllowed: boolean;
}

export interface BrowserInferenceCapability {
  supported: boolean;
  backend: BrowserInferenceBackend;
  deviceTier: BrowserDeviceTier;
  estimatedMemoryGb?: number;
  recommendedModelId?: string;
  maxRecommendedContextTokens: number;
  reasons: string[];
  browser: { name: string; version: string | null; mobile: boolean };
  crossOriginIsolated: boolean;
  logicalProcessors: number;
  availableStorageBytes?: number;
  indexedDbAvailable: boolean;
  persistentStorage: boolean;
  installedPwa: boolean;
  workerAvailable: boolean;
}

export interface BrowserModelDescriptor {
  manifestVersion: number;
  id: string;
  modelFamilyId: string;
  displayName: string;
  provider: "browser-local";
  runtimeAdapter: BrowserRuntimeAdapterId;
  runtimeAdapterVersion: string;
  runtimeModelId: string;
  runtimeLibraryRevision?: string;
  architecture: string;
  modelUrl: string;
  modelRevision: string;
  tokenizerUrl?: string;
  modelFormat: string;
  quantization: string;
  pipeline: "text-generation";
  dtypeByBackend: Partial<Record<Exclude<BrowserInferenceBackend, "none">, BrowserModelDtype>>;
  promptTemplateId: string;
  approximateDownloadBytes: number;
  approximateRuntimeMemoryBytes: number;
  contextWindowTokens: number;
  recommendedContextTokens: Record<BrowserDeviceTier, number>;
  recommendedOutputTokens: Record<BrowserDeviceTier, number>;
  maximumGenerationTimeMs: Record<BrowserDeviceTier, number>;
  taskClasses: BrowserModelTaskClass[];
  readinessPrompt: string;
  readinessMaxTokens: number;
  sha256?: string;
  supportedRuntimes: InferenceRuntime[];
  minimumDeviceTier: BrowserDeviceTier;
  supportedBackends: Array<Exclude<BrowserInferenceBackend, "none">>;
  license: string;
  licenseUrl?: string;
  enabled: boolean;
}

export type BrowserEngineStatus =
  | "idle"
  | "initializing"
  | "downloading"
  | "loading"
  | "ready"
  | "generating"
  | "paused"
  | "unsupported"
  | "error";

export interface BrowserEngineCapabilities {
  backend: Exclude<BrowserInferenceBackend, "none">;
  tokenizerAvailable: boolean;
  streaming: boolean;
  cancellation: boolean;
  contextWindowTokens: number;
  runtimeContract: BrowserRuntimeContract;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BrowserModelConfig {
  backend: Exclude<BrowserInferenceBackend, "none">;
  approvedModelOrigins: string[];
  maxContextTokens: number;
  runtimeContract: BrowserRuntimeContract;
}

export interface BrowserGenerationRequest {
  requestId: string;
  messages: ModelMessage[];
  maxNewTokens: number;
  maxWallTimeMs: number;
  temperature: number;
  cacheKey?: string;
}

export interface BrowserGenerationHandlers {
  onToken?: (token: string) => void;
  onProgress?: (progress: BrowserModelProgress) => void;
}

export interface BrowserGenerationResult {
  requestId: string;
  text: string;
  promptTokenCount: number | null;
  generatedTokenCount: number | null;
  durationMs: number;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: number | null;
}

export interface BrowserModelProgress {
  status: "downloading" | "loading";
  file?: string;
  loadedBytes?: number;
  totalBytes?: number;
  percent: number;
}

export interface BrowserModelEngine {
  initialize(config: BrowserModelConfig): Promise<void>;
  loadModel(
    model: BrowserModelDescriptor,
    handlers?: Pick<BrowserGenerationHandlers, "onProgress">
  ): Promise<void>;
  generate(
    request: BrowserGenerationRequest,
    handlers: BrowserGenerationHandlers
  ): Promise<BrowserGenerationResult>;
  countTokens(messages: ModelMessage[]): Promise<number>;
  cancel(requestId: string): Promise<void>;
  unload(): Promise<void>;
  getCapabilities(): Promise<BrowserEngineCapabilities>;
  getStatus(): BrowserEngineStatus;
  terminate(): void;
}

export type BrowserInferenceErrorCode =
  | "WEBGPU_UNAVAILABLE"
  | "WASM_UNAVAILABLE"
  | "MODEL_DOWNLOAD_FAILED"
  | "MODEL_CACHE_CORRUPT"
  | "MODEL_LOAD_FAILED"
  | "OUT_OF_MEMORY"
  | "CONTEXT_LIMIT_EXCEEDED"
  | "TASK_BUDGET_EXCEEDED"
  | "GENERATION_CANCELLED"
  | "WORKER_CRASHED"
  | "STORAGE_QUOTA_EXCEEDED"
  | "UNSUPPORTED_BROWSER"
  | "UNKNOWN";

export class BrowserInferenceError extends Error {
  constructor(
    readonly code: BrowserInferenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BrowserInferenceError";
  }
}

export interface BrowserInferenceSettings {
  accountId: string;
  businessId: string;
  enabled: boolean;
  selectedModelId: string | null;
  status: BrowserEngineStatus;
  downloadedAt: string | null;
  updatedAt: string;
  lastErrorCode: BrowserInferenceErrorCode | null;
}

export interface BrowserModelExecutionOutcome {
  deviceProfileId: string;
  modelId: string;
  backend: Exclude<BrowserInferenceBackend, "none">;
  successful: boolean;
  loadTimeMs: number;
  readinessTimeMs: number | null;
  readinessTokensPerSecond: number | null;
  failureCode: BrowserInferenceErrorCode | null;
  updatedAt: string;
}

export interface BrowserModelOption {
  model: BrowserModelDescriptor;
  compatible: boolean;
  reason: string | null;
  score: number;
  previousOutcome: BrowserModelExecutionOutcome | null;
}

export type BrowserTaskCheckpointReason =
  "task-start" | "page-hidden" | "page-freeze" | "generation-failed" | "manual-suspend";

export interface BrowserTaskStateCheckpoint {
  version: 2;
  id: string;
  accountId: string;
  businessId: string;
  conversationId: string;
  requestId: string;
  modelId: string;
  runtimeContract: BrowserRuntimeContract;
  compatibilityContract: BrowserCheckpointCompatibilityContract;
  objective: string;
  relevantMessages: ModelMessage[];
  partialOutput: string;
  continuationInstruction: string;
  reason: BrowserTaskCheckpointReason;
  status: "running" | "interrupted";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ContextSourceMetadata {
  type:
    | "system"
    | "identity"
    | "current-message"
    | "recent-message"
    | "context-script"
    | "catalogue"
    | "memory"
    | "summary"
    | "tool";
  id: string;
  tokenEstimate: number;
  priority: number;
}

export interface BuiltModelContext {
  messages: ModelMessage[];
  estimatedPromptTokens: number;
  tokenCountEstimated: boolean;
  reservedGenerationTokens: number;
  totalBudgetTokens: number;
  includedSources: ContextSourceMetadata[];
  droppedSources: ContextSourceMetadata[];
  warnings: string[];
  cacheKey?: string;
}

export interface ConversationSummary {
  conversationId: string;
  version: number;
  coveredThroughMessageId: string;
  summaryText: string;
  facts: Array<{ key: string; value: string; sourceMessageIds: string[] }>;
  pendingActions: string[];
  updatedAt: string;
}

export interface RetrievedContext {
  sourceType: "conversation" | "catalogue" | "context-script";
  sourceId: string;
  content: string;
  relevanceScore: number;
  timestamp: string;
  tokenEstimate: number;
  trustLevel: "authoritative" | "user-provided" | "derived";
}

export interface RetrievalInput {
  accountId: string;
  businessId: string;
  query: string;
  limit: number;
}

export interface BrowserContextRetriever {
  retrieveConversationMemory(input: RetrievalInput): Promise<RetrievedContext[]>;
  retrieveCatalogueContext(input: RetrievalInput): Promise<RetrievedContext[]>;
  retrieveContextScripts(input: RetrievalInput): Promise<RetrievedContext[]>;
}

export interface InferenceRoutingDecision {
  route: "browser-local" | "server" | "native";
  modelId: string;
  reasonCode:
    | "LOCAL_READY"
    | "LOCAL_DISABLED"
    | "MODEL_NOT_LOADED"
    | "DEVICE_UNSUPPORTED"
    | "CONTEXT_TOO_LARGE"
    | "SERVER_TOOL_REQUIRED"
    | "COMPLEXITY_ESCALATION"
    | "LOCAL_FAILURE";
  explanation: string;
}

export function unavailableBrowserInferenceCapability(): BrowserInferenceCapability {
  return {
    supported: false,
    backend: "none",
    deviceTier: "low",
    maxRecommendedContextTokens: 1_024,
    reasons: ["Browser inference is not enabled for this shop."],
    browser: { name: "Unknown", version: null, mobile: false },
    crossOriginIsolated: false,
    logicalProcessors: navigator.hardwareConcurrency || 1,
    indexedDbAvailable: false,
    persistentStorage: false,
    installedPwa: false,
    workerAvailable: false
  };
}
