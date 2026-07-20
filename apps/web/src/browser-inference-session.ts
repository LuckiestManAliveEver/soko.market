import {
  buildBrowserModelContext,
  createLexicalContextRetriever,
  estimateTokens,
  selectSokoContextScripts,
  updateRollingConversationSummary
} from "./browser-context-manager";
import { inspectBrowserInferenceCapability } from "./browser-inference-capability";
import { recordBrowserInferenceDiagnostic } from "./browser-inference-diagnostics";
import {
  BrowserInferenceError,
  type BrowserGenerationResult,
  type BrowserInferenceCapability,
  type BrowserInferenceSettings,
  type BrowserModelProgress,
  type BuiltModelContext,
  type ConversationSummary,
  type InferenceRoutingDecision,
  type RetrievedContext
} from "./browser-inference-types";
import { createBrowserModelEngine } from "./browser-model-engine";
import {
  browserLocalInferenceDeploymentEnabled,
  browserModelSupports,
  getBrowserModel
} from "./browser-model-registry";
import {
  decideInferenceRoute,
  requestNeedsComplexReasoning,
  requestRequiresServerTool
} from "./browser-inference-routing";
import {
  openBrowserInferenceRepository,
  type BrowserInferenceRepository
} from "./browser-inference-storage";

let engine = createBrowserModelEngine();
let repositoryPromise: Promise<BrowserInferenceRepository> | null = null;
let loadedModelId: string | null = null;
let initializedBackend: "webgpu" | "wasm" | null = null;
let activeRequestId: string | null = null;

export interface BrowserInferenceState {
  deploymentEnabled: boolean;
  settings: BrowserInferenceSettings | null;
  capability: BrowserInferenceCapability;
}

export interface BrowserChatInput {
  requestId?: string;
  accountId: string;
  businessId: string;
  conversationId: string;
  agentIdentity: string;
  shopIdentity: string;
  systemPrompt: string;
  message: string;
  recentMessages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>;
  catalogueRecords: Array<{
    id: string;
    name: string;
    price: number | null;
    quantity: number;
    updatedAt?: string;
  }>;
  nativeReady: boolean;
  onToken: (token: string) => void;
  onProgress?: (progress: BrowserModelProgress) => void;
}

export async function loadBrowserInferenceState(
  accountId: string,
  businessId: string
): Promise<BrowserInferenceState> {
  const [settings, capability] = await Promise.all([
    getRepository()
      .then((repository) => repository.getSettings(accountId, businessId))
      .catch(() => null),
    inspectBrowserInferenceCapability().catch(() => unsupportedCapability())
  ]);
  recordBrowserInferenceDiagnostic({
    type: "capability",
    backend: capability.backend,
    deviceTier: capability.deviceTier,
    supported: capability.supported,
    crossOriginIsolated: capability.crossOriginIsolated,
    availableStorageBytes: capability.availableStorageBytes ?? null
  });
  return {
    deploymentEnabled: browserLocalInferenceDeploymentEnabled,
    settings,
    capability
  };
}

export async function enableBrowserInference(input: {
  accountId: string;
  businessId: string;
  modelId: string;
  onProgress?: (progress: BrowserModelProgress) => void;
}): Promise<BrowserInferenceState> {
  if (!browserLocalInferenceDeploymentEnabled) {
    throw new BrowserInferenceError(
      "UNSUPPORTED_BROWSER",
      "Browser-local inference is disabled for this deployment."
    );
  }
  const capability = await inspectBrowserInferenceCapability();
  const backend = capability.backend;
  const model = getBrowserModel(input.modelId);
  if (
    model === null ||
    !capability.supported ||
    backend === "none" ||
    !browserModelSupports(model, capability.deviceTier, backend)
  ) {
    throw new BrowserInferenceError(
      "UNSUPPORTED_BROWSER",
      capability.reasons[0] ?? "This device cannot safely run the selected browser model."
    );
  }
  if (
    capability.availableStorageBytes !== undefined &&
    capability.availableStorageBytes < model.approximateDownloadBytes * 1.15
  ) {
    throw new BrowserInferenceError(
      "STORAGE_QUOTA_EXCEEDED",
      "There is not enough browser storage for this model."
    );
  }
  await navigator.storage?.persist?.().catch(() => false);
  const repository = await getRepository();
  const loadStartedAt = performance.now();
  const downloading = settingsRecord(input, "downloading", false, null);
  await repository.putSettings(downloading);
  await repository.putModel(input.accountId, model, "downloading");
  try {
    await ensureModelLoaded(model.id, capability, input.onProgress);
    const ready = settingsRecord(input, "ready", true, null);
    await repository.putModel(input.accountId, model, "ready");
    await repository.putSettings(ready);
    recordBrowserInferenceDiagnostic({
      type: "model-load",
      backend,
      modelId: model.id,
      durationMs: Math.round(performance.now() - loadStartedAt),
      outcome: "ready",
      errorCode: null
    });
    return { deploymentEnabled: true, settings: ready, capability };
  } catch (error) {
    const normalized = normalizeSessionError(error);
    const failed = settingsRecord(
      input,
      normalized.code === "GENERATION_CANCELLED" ? "paused" : "error",
      false,
      normalized.code === "GENERATION_CANCELLED" ? null : normalized.code
    );
    await repository.putSettings(failed);
    recordBrowserInferenceDiagnostic({
      type: "model-load",
      backend,
      modelId: model.id,
      durationMs: Math.round(performance.now() - loadStartedAt),
      outcome: normalized.code === "GENERATION_CANCELLED" ? "cancelled" : "error",
      errorCode: normalized.code
    });
    throw normalized;
  }
}

export function cancelBrowserModelLoad(): void {
  recordBrowserInferenceDiagnostic({ type: "cancellation", target: "download" });
  engine.terminate();
  engine = createBrowserModelEngine();
  initializedBackend = null;
  loadedModelId = null;
}

export async function disableBrowserInference(
  accountId: string,
  businessId: string
): Promise<BrowserInferenceState> {
  const state = await loadBrowserInferenceState(accountId, businessId);
  const next: BrowserInferenceSettings = {
    accountId,
    businessId,
    enabled: false,
    selectedModelId: state.settings?.selectedModelId ?? null,
    status: loadedModelId === null ? "idle" : "ready",
    downloadedAt: state.settings?.downloadedAt ?? null,
    updatedAt: new Date().toISOString(),
    lastErrorCode: null
  };
  await (await getRepository()).putSettings(next);
  return { ...state, settings: next };
}

export async function removeBrowserModel(
  accountId: string,
  businessId: string
): Promise<BrowserInferenceState> {
  await engine.unload().catch(() => undefined);
  engine.terminate();
  engine = createBrowserModelEngine();
  initializedBackend = null;
  loadedModelId = null;
  await (await getRepository()).clearModelAssets(accountId);
  if ("caches" in globalThis) {
    await globalThis.caches.delete("transformers-cache").catch(() => false);
  }
  const capability = await inspectBrowserInferenceCapability().catch(() => unsupportedCapability());
  const settings: BrowserInferenceSettings = {
    accountId,
    businessId,
    enabled: false,
    selectedModelId: null,
    status: "idle",
    downloadedAt: null,
    updatedAt: new Date().toISOString(),
    lastErrorCode: null
  };
  await (await getRepository()).putSettings(settings);
  return {
    deploymentEnabled: browserLocalInferenceDeploymentEnabled,
    settings,
    capability
  };
}

export async function browserInferenceEnabled(
  accountId: string,
  businessId: string
): Promise<boolean> {
  if (!browserLocalInferenceDeploymentEnabled) return false;
  const settings = await (
    await getRepository()
  )
    .getSettings(accountId, businessId)
    .catch(() => null);
  return settings?.enabled === true && settings.selectedModelId !== null;
}

export async function listCachedBrowserModelIds(accountId: string): Promise<string[]> {
  return (await getRepository()).listCachedModelIds(accountId);
}

export async function generateBrowserAgentResponse(input: BrowserChatInput): Promise<{
  result: BrowserGenerationResult;
  context: BuiltModelContext;
  route: InferenceRoutingDecision;
  summary: ConversationSummary | null;
}> {
  const repository = await getRepository();
  const settings = await repository.getSettings(input.accountId, input.businessId);
  const capability = await inspectBrowserInferenceCapability();
  const reservedGenerationTokens = generationTokenBudget(capability.deviceTier);
  const model =
    settings?.selectedModelId === null || settings?.selectedModelId === undefined
      ? null
      : getBrowserModel(settings.selectedModelId);
  const summary = await repository.getSummary(input.accountId, input.conversationId);
  const scripts = selectSokoContextScripts(input.message);
  const catalogueSource = input.catalogueRecords.map((record): RetrievedContext => ({
    sourceType: "catalogue",
    sourceId: record.id,
    content: `${record.name}; price=${record.price ?? "not set"}; quantity=${record.quantity}`,
    relevanceScore: 0,
    timestamp: record.updatedAt ?? new Date(0).toISOString(),
    tokenEstimate: estimateTokens(record.name) + 8,
    trustLevel: "authoritative"
  }));
  const retriever = createLexicalContextRetriever({
    conversation: [],
    catalogue: catalogueSource,
    contextScripts: scripts
  });
  const retrievalInput = {
    accountId: input.accountId,
    businessId: input.businessId,
    query: input.message,
    limit: 5
  };
  const [catalogue, contextScripts] = await Promise.all([
    retriever.retrieveCatalogueContext(retrievalInput),
    retriever.retrieveContextScripts(retrievalInput)
  ]);
  let context =
    model === null
      ? null
      : await buildBrowserModelContext({
          systemPrompt: input.systemPrompt,
          agentIdentity: input.agentIdentity,
          shopIdentity: input.shopIdentity,
          currentMessage: input.message,
          recentMessages: input.recentMessages,
          contextScripts,
          catalogue,
          memory: [],
          summary,
          contextWindowTokens: Math.min(
            model.contextWindowTokens,
            capability.maxRecommendedContextTokens
          ),
          reservedGenerationTokens
        });
  const route = decideInferenceRoute({
    deploymentEnabled: browserLocalInferenceDeploymentEnabled,
    settings,
    capability,
    modelLoaded: model !== null,
    nativeReady: input.nativeReady,
    promptTokens: context?.estimatedPromptTokens ?? Number.POSITIVE_INFINITY,
    contextLimit: model?.contextWindowTokens ?? 0,
    requiresServerTool: requestRequiresServerTool(input.message),
    complexReasoning: requestNeedsComplexReasoning(input.message),
    pageActive: document.visibilityState === "visible"
  });
  if (
    route.route !== "browser-local" ||
    model === null ||
    context === null ||
    settings === null ||
    capability.backend === "none"
  ) {
    recordBrowserInferenceDiagnostic({
      type: "fallback",
      route: route.route === "browser-local" ? "server" : route.route,
      reasonCode: route.reasonCode
    });
    throw new BrowserInferenceError(
      route.reasonCode === "CONTEXT_TOO_LARGE" ? "CONTEXT_LIMIT_EXCEEDED" : "MODEL_LOAD_FAILED",
      route.explanation
    );
  }
  const backend = capability.backend;
  await ensureModelLoaded(model.id, capability, input.onProgress);
  context = await buildBrowserModelContext({
    systemPrompt: input.systemPrompt,
    agentIdentity: input.agentIdentity,
    shopIdentity: input.shopIdentity,
    currentMessage: input.message,
    recentMessages: input.recentMessages,
    contextScripts,
    catalogue,
    memory: [],
    summary,
    contextWindowTokens: Math.min(
      model.contextWindowTokens,
      capability.maxRecommendedContextTokens
    ),
    reservedGenerationTokens,
    tokenizer: {
      countTokens: (messages) => engine.countTokens(messages)
    }
  });
  const requestId =
    input.requestId ??
    globalThis.crypto?.randomUUID?.() ??
    `browser-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  activeRequestId = requestId;
  try {
    const result = await engine.generate(
      {
        requestId,
        messages: context.messages,
        maxNewTokens: context.reservedGenerationTokens,
        temperature: 0.2,
        ...(context.cacheKey === undefined ? {} : { cacheKey: context.cacheKey })
      },
      {
        onToken: input.onToken,
        ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress })
      }
    );
    recordBrowserInferenceDiagnostic({
      type: "generation",
      backend,
      modelId: model.id,
      promptTokenCount: result.promptTokenCount ?? context.estimatedPromptTokens,
      generatedTokenCount: result.generatedTokenCount,
      durationMs: result.durationMs,
      timeToFirstTokenMs: result.timeToFirstTokenMs,
      tokensPerSecond: result.tokensPerSecond
    });
    const nextSummary = updateRollingConversationSummary({
      conversationId: input.conversationId,
      messages: input.recentMessages,
      previous: summary
    });
    if (nextSummary !== null && nextSummary !== summary) {
      await repository.putSummary(input.accountId, nextSummary);
    }
    await repository.putSettings({
      ...settings,
      status: "ready",
      updatedAt: new Date().toISOString(),
      lastErrorCode: null
    });
    return { result, context, route, summary: nextSummary };
  } finally {
    if (activeRequestId === requestId) activeRequestId = null;
  }
}

function generationTokenBudget(deviceTier: "low" | "medium" | "high" | "unsupported"): number {
  const defaultBudget = deviceTier === "low" ? 96 : 160;
  if (__DEPLOYMENT_ENV__ !== "staging" || typeof window === "undefined") return defaultBudget;
  const requested = Number(
    new URLSearchParams(window.location.search).get("browserInferenceMaxNewTokens")
  );
  return Number.isInteger(requested) && requested === 32 ? requested : defaultBudget;
}

export async function cancelBrowserGeneration(): Promise<void> {
  if (activeRequestId === null) return;
  recordBrowserInferenceDiagnostic({ type: "cancellation", target: "generation" });
  await engine.cancel(activeRequestId);
}

export async function clearBrowserInferenceAccountData(accountId: string): Promise<void> {
  engine.terminate();
  engine = createBrowserModelEngine();
  activeRequestId = null;
  initializedBackend = null;
  loadedModelId = null;
  const repository = await getRepository().catch(() => null);
  await repository?.clearAccountData(accountId).catch(() => undefined);
}

async function ensureModelLoaded(
  modelId: string,
  capability: BrowserInferenceCapability,
  onProgress?: (progress: BrowserModelProgress) => void
): Promise<void> {
  const model = getBrowserModel(modelId);
  if (
    model === null ||
    capability.backend === "none" ||
    !browserModelSupports(model, capability.deviceTier, capability.backend)
  ) {
    throw new BrowserInferenceError(
      "UNSUPPORTED_BROWSER",
      "The selected browser model is not compatible with this device."
    );
  }
  if (initializedBackend !== capability.backend) {
    engine.terminate();
    engine = createBrowserModelEngine();
    await engine.initialize({
      backend: capability.backend,
      approvedModelOrigins: ["https://huggingface.co"],
      maxContextTokens: Math.min(model.contextWindowTokens, capability.maxRecommendedContextTokens)
    });
    initializedBackend = capability.backend;
    loadedModelId = null;
  }
  if (loadedModelId === model.id && engine.getStatus() === "ready") return;
  await engine.loadModel(model, onProgress === undefined ? {} : { onProgress });
  loadedModelId = model.id;
}

function getRepository(): Promise<BrowserInferenceRepository> {
  repositoryPromise ??= openBrowserInferenceRepository();
  return repositoryPromise;
}

function settingsRecord(
  input: { accountId: string; businessId: string; modelId: string },
  status: BrowserInferenceSettings["status"],
  enabled: boolean,
  lastErrorCode: BrowserInferenceSettings["lastErrorCode"]
): BrowserInferenceSettings {
  const now = new Date().toISOString();
  return {
    accountId: input.accountId,
    businessId: input.businessId,
    enabled,
    selectedModelId: input.modelId,
    status,
    downloadedAt: status === "ready" ? now : null,
    updatedAt: now,
    lastErrorCode
  };
}

function normalizeSessionError(error: unknown): BrowserInferenceError {
  if (error instanceof BrowserInferenceError) return error;
  return new BrowserInferenceError(
    /quota|storage/i.test(error instanceof Error ? error.message : String(error))
      ? "STORAGE_QUOTA_EXCEEDED"
      : "MODEL_LOAD_FAILED",
    error instanceof Error ? error.message : "The browser model could not be loaded."
  );
}

function unsupportedCapability(): BrowserInferenceCapability {
  return {
    supported: false,
    backend: "none",
    deviceTier: "low",
    maxRecommendedContextTokens: 1_024,
    reasons: ["Browser capability inspection failed safely."],
    browser: { name: "Unknown", version: null, mobile: false },
    crossOriginIsolated: false,
    logicalProcessors: 1,
    indexedDbAvailable: false,
    persistentStorage: false,
    installedPwa: false,
    workerAvailable: false
  };
}
