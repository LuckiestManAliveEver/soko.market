/**
 * Request-body parsing/validation for the agent-runtime route cluster (see routes.ts). Split out
 * purely to keep routes.ts under its modularity budget - every function here is a pure body ->
 * validated-input transform with no route registration or store access, so this file has no
 * dependency on `registerAgentRuntimeRoutes` and nothing outside routes.ts calls into it.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  isModelExecutionTarget,
  defaultAgentDefinitionId,
  isAgentDefinitionId,
  type AgentContextSource,
  type AgentDefinition,
  type AiModelSummary,
  type AgentEvaluationPolicy,
  type AgentInstructions,
  type AgentMemoryPolicy,
  type AgentModelBindingPermissions,
  type AgentModelReadinessStatus,
  type AgentModelRuntimeBackend,
  type AgentOwnerCorrection,
  type AgentPersonality,
  type AgentSkillBinding,
  type BrowserCheckpointCompatibilityContract,
  type BrowserDeviceTier,
  type BrowserRuntimeContract,
  type InstalledAgentModelSummary,
  type ModelCompatibilityStatus,
  type ModelExecutionTarget,
  type ModelInstallationStatus,
  type PreferredExecutionMode,
  type OssAgentSummary,
  type RuntimeToolName
} from "@soko/shared-types";
import { runtimeToolRegistry } from "@soko/tool-core";
import { Cp2Error } from "../../cp2-error.js";
import { isSupportedLanguage } from "../../store.js";
import { normalizeAdapterId } from "../../../agent-runtime/agent-runtime-adapter.js";
import type { BusinessAgentProfileInput } from "./shared.js";
import {
  parseBoolean,
  parseIsoTimestamp,
  parseNullableNumber,
  parseNullableString,
  parseNumber,
  parsePositiveInteger,
  parseRequestBody,
  parseString,
  parseStringArray
} from "../../route-helpers.js";

export interface AgentProfileBody {
  agentDefinitionId?: string;
  name?: string;
  description?: string;
  modelId?: string;
  role?: string;
  language?: string;
  personality?: string;
  instructions?: string;
  knowledge?: string;
  tools?: unknown;
  integrations?: unknown;
  contextScripts?: unknown;
  status?: string;
  personalityConfig?: unknown;
  instructionPolicy?: unknown;
  skillBindings?: unknown;
  memoryPolicy?: unknown;
  evaluationPolicy?: unknown;
  supportedLanguages?: unknown;
  businessCategory?: string;
  publicIntroduction?: string;
}

export interface AgentContextSourceBody {
  id?: string;
  type?: string;
  title?: string;
  content?: string;
  sensitivity?: string;
  customerVisible?: boolean;
  status?: string;
}

export interface AgentCorrectionBody {
  correction?: string;
  category?: string;
  sourceMessageId?: string | null;
  promoteToInstruction?: boolean;
}

export interface AgentFeedbackBody {
  messageId?: string | null;
  correct?: boolean;
  reason?: string | null;
}

export interface InstalledModelBody {
  id?: unknown;
  deviceId?: unknown;
  modelId?: unknown;
  displayName?: unknown;
  provider?: unknown;
  repositoryId?: unknown;
  filename?: unknown;
  format?: unknown;
  quantization?: unknown;
  architecture?: unknown;
  parameterCount?: unknown;
  contextLength?: unknown;
  fileSizeBytes?: unknown;
  checksum?: unknown;
  packageManifestVersion?: unknown;
  packageSignature?: unknown;
  packageSigningKeyId?: unknown;
  license?: unknown;
  commercialUseAllowed?: unknown;
  storageKey?: unknown;
  runtimeBackend?: unknown;
  installationStatus?: unknown;
  compatibilityStatus?: unknown;
  installedAt?: unknown;
  lastVerifiedAt?: unknown;
  validationError?: unknown;
}

export function parseAgentProfileBody(body: AgentProfileBody): BusinessAgentProfileInput {
  const agentDefinitionId = body.agentDefinitionId ?? defaultAgentDefinitionId;
  if (!isAgentDefinitionId(agentDefinitionId)) {
    throw new Cp2Error(
      400,
      "agent_definition_invalid",
      "Agent definition is not in the approved catalogue."
    );
  }
  const language = parseString(body.language, "language");
  if (!isSupportedLanguage(language)) {
    throw new Cp2Error(400, "language_invalid", "language is not supported.");
  }
  const status = parseString(body.status, "status");
  if (status !== "active" && status !== "draft") {
    throw new Cp2Error(400, "agent_status_invalid", "Agent status is invalid.");
  }

  const personalityConfig =
    body.personalityConfig === undefined
      ? undefined
      : (parseRequestBody(body.personalityConfig) as unknown as AgentPersonality);
  const instructionPolicy =
    body.instructionPolicy === undefined
      ? undefined
      : (parseRequestBody(body.instructionPolicy) as unknown as AgentInstructions);
  const skillBindings =
    body.skillBindings === undefined
      ? undefined
      : parseStructuredArray<AgentSkillBinding>(
          body.skillBindings,
          "skillBindings",
          Object.keys(runtimeToolRegistry).length
        );
  const memoryPolicy =
    body.memoryPolicy === undefined
      ? undefined
      : (parseRequestBody(body.memoryPolicy) as unknown as AgentMemoryPolicy);
  const evaluationPolicy =
    body.evaluationPolicy === undefined
      ? undefined
      : (parseRequestBody(body.evaluationPolicy) as unknown as AgentEvaluationPolicy);
  const supportedLanguages =
    body.supportedLanguages === undefined
      ? undefined
      : parseStringArray(body.supportedLanguages, "supportedLanguages", 2).map((item) => {
          if (!isSupportedLanguage(item)) {
            throw new Cp2Error(400, "language_invalid", "language is not supported.");
          }
          return item;
        });
  return {
    agentDefinitionId,
    name: parseString(body.name, "name"),
    description: parseString(body.description, "description"),
    modelId: parseString(body.modelId, "modelId"),
    role: parseString(body.role, "role"),
    language,
    personality: parseString(body.personality, "personality"),
    instructions: parseString(body.instructions, "instructions"),
    knowledge: parseString(body.knowledge, "knowledge"),
    tools: parseStringArray(body.tools, "tools", 24),
    integrations: parseStringArray(body.integrations, "integrations", 24),
    contextScripts: parseStringArray(body.contextScripts, "contextScripts", 12),
    ...(personalityConfig === undefined ? {} : { personalityConfig }),
    ...(instructionPolicy === undefined ? {} : { instructionPolicy }),
    ...(skillBindings === undefined ? {} : { skillBindings }),
    ...(memoryPolicy === undefined ? {} : { memoryPolicy }),
    ...(evaluationPolicy === undefined ? {} : { evaluationPolicy }),
    ...(supportedLanguages === undefined ? {} : { supportedLanguages }),
    ...(body.businessCategory === undefined
      ? {}
      : { businessCategory: parseString(body.businessCategory, "businessCategory") }),
    ...(body.publicIntroduction === undefined
      ? {}
      : { publicIntroduction: parseString(body.publicIntroduction, "publicIntroduction") }),
    status
  };
}

export function parseAgentContextSourceBody(body: AgentContextSourceBody | null | undefined): {
  sourceId?: string;
  type: AgentContextSource["type"];
  title: string;
  content: string;
  sensitivity: AgentContextSource["sensitivity"];
  customerVisible: boolean;
  status: AgentContextSource["status"];
} {
  const record = parseRequestBody(body);
  const type = parseString(record.type, "type");
  const sensitivity = parseString(record.sensitivity, "sensitivity");
  const status = parseString(record.status, "status");
  const types: AgentContextSource["type"][] = [
    "catalogue",
    "inventory",
    "customer",
    "supplier",
    "receipt",
    "order",
    "policy",
    "document",
    "conversation",
    "context_script",
    "owner_note"
  ];
  if (!types.includes(type as AgentContextSource["type"])) {
    throw new Cp2Error(400, "context_source_type_invalid", "Context source type is invalid.");
  }
  if (!["public", "internal", "confidential", "restricted"].includes(sensitivity)) {
    throw new Cp2Error(
      400,
      "context_source_sensitivity_invalid",
      "Context source sensitivity is invalid."
    );
  }
  if (!["active", "disabled", "archived"].includes(status)) {
    throw new Cp2Error(400, "context_source_status_invalid", "Context source status is invalid.");
  }
  return {
    ...(record.id === undefined ? {} : { sourceId: parseString(record.id, "id") }),
    type: type as AgentContextSource["type"],
    title: parseString(record.title, "title"),
    content: parseString(record.content, "content"),
    sensitivity: sensitivity as AgentContextSource["sensitivity"],
    customerVisible: parseBoolean(record.customerVisible, "customerVisible"),
    status: status as AgentContextSource["status"]
  };
}

export function parseAgentCorrectionBody(body: AgentCorrectionBody | null | undefined): {
  correction: string;
  category: AgentOwnerCorrection["category"];
  sourceMessageId?: string | null;
  promoteToInstruction: boolean;
} {
  const record = parseRequestBody(body);
  const category = parseString(record.category, "category");
  if (!["instruction", "business_fact", "memory", "response"].includes(category)) {
    throw new Cp2Error(400, "agent_correction_category_invalid", "Correction category is invalid.");
  }
  return {
    correction: parseString(record.correction, "correction"),
    category: category as AgentOwnerCorrection["category"],
    ...(record.sourceMessageId === undefined
      ? {}
      : { sourceMessageId: parseNullableString(record.sourceMessageId) }),
    promoteToInstruction: parseBoolean(record.promoteToInstruction, "promoteToInstruction")
  };
}

export function parseAgentFeedbackBody(body: AgentFeedbackBody | null | undefined): {
  messageId?: string | null;
  correct: boolean;
  reason?: string | null;
} {
  const record = parseRequestBody(body);
  return {
    ...(record.messageId === undefined ? {} : { messageId: parseNullableString(record.messageId) }),
    correct: parseBoolean(record.correct, "correct"),
    ...(record.reason === undefined ? {} : { reason: parseNullableString(record.reason) })
  };
}

export function parseModelCatalogEntry(value: unknown, expectedId: string): AiModelSummary {
  const record = parseRequestBody(value);
  const id = record.id === undefined ? expectedId : parseString(record.id, "id");
  if (id !== expectedId) {
    throw new Cp2Error(
      400,
      "model_catalog_entry_invalid",
      "Model id in the body must match the URL."
    );
  }
  const source = record.source;
  if (
    source !== "huggingface" &&
    source !== "github" &&
    source !== "builtin" &&
    source !== "hosted"
  ) {
    throw new Cp2Error(400, "model_catalog_entry_invalid", "Model source is invalid.");
  }
  const format = record.format;
  if (format !== "GGUF" && format !== "remote") {
    throw new Cp2Error(400, "model_catalog_entry_invalid", "Model format is invalid.");
  }
  return {
    id,
    label: parseString(record.label, "label"),
    provider: parseString(record.provider, "provider"),
    description: parseString(record.description, "description"),
    capabilities: parseStringArray(record.capabilities, "capabilities", 40),
    available: parseBoolean(record.available, "available"),
    source,
    format,
    license: parseNullableString(record.license),
    licenseUrl: parseNullableString(record.licenseUrl),
    modelCardUrl: parseNullableString(record.modelCardUrl),
    downloadUrl: parseNullableString(record.downloadUrl),
    fileName: parseNullableString(record.fileName),
    fileSizeBytes: parseNullableNumber(record.fileSizeBytes, "fileSizeBytes"),
    minimumMemoryGb: parseNullableNumber(record.minimumMemoryGb, "minimumMemoryGb"),
    recommended: parseBoolean(record.recommended, "recommended"),
    contextWindow: parseNullableNumber(record.contextWindow, "contextWindow")
  };
}

export function parseAgentCatalogEntry(value: unknown, expectedId: string): AgentDefinition {
  const record = parseRequestBody(value);
  const id = record.id === undefined ? expectedId : parseString(record.id, "id");
  if (id !== expectedId) {
    throw new Cp2Error(
      400,
      "agent_catalog_entry_invalid",
      "Agent id in the body must match the URL."
    );
  }
  if (!isAgentDefinitionId(id) || !id.startsWith("builtin:")) {
    throw new Cp2Error(
      400,
      "agent_catalog_entry_invalid",
      "Agent catalog entries must use a builtin: id."
    );
  }
  const workloadClass = record.workloadClass;
  if (workloadClass !== "focused") {
    throw new Cp2Error(400, "agent_catalog_entry_invalid", "Agent workload class is invalid.");
  }
  const minimumDeviceTier = record.minimumDeviceTier;
  if (
    minimumDeviceTier !== "low" &&
    minimumDeviceTier !== "medium" &&
    minimumDeviceTier !== "high"
  ) {
    throw new Cp2Error(400, "agent_catalog_entry_invalid", "Minimum device tier is invalid.");
  }
  const skillIds = parseStringArray(
    record.skillIds,
    "skillIds",
    Object.keys(runtimeToolRegistry).length
  );
  if (skillIds.some((skillId) => !(skillId in runtimeToolRegistry))) {
    throw new Cp2Error(
      400,
      "agent_catalog_entry_invalid",
      "Agent skill ids must reference registered runtime tools."
    );
  }
  return {
    id: id as AgentDefinition["id"],
    displayName: parseString(record.displayName, "displayName"),
    role: parseString(record.role, "role"),
    description: parseString(record.description, "description"),
    operatingPattern: parseString(record.operatingPattern, "operatingPattern"),
    workloadClass,
    minimumDeviceTier,
    minimumMemoryGb: parseNumber(record.minimumMemoryGb, "minimumMemoryGb"),
    recommendedContextTokens: parseNumber(
      record.recommendedContextTokens,
      "recommendedContextTokens"
    ),
    personality: parseString(record.personality, "personality"),
    instructions: parseString(record.instructions, "instructions"),
    knowledge: parseString(record.knowledge, "knowledge"),
    tools: parseStringArray(record.tools, "tools", 40),
    skillIds: skillIds as RuntimeToolName[]
  };
}

export function parseStructuredArray<T>(value: unknown, name: string, maximumItems: number): T[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Cp2Error(
      400,
      `${name}_invalid`,
      `${name} must be an array with ${maximumItems} items or fewer.`
    );
  }
  return value.map((item) => parseRequestBody(item) as unknown as T);
}

export function parseInstalledModelBody(
  body: InstalledModelBody
): Omit<InstalledAgentModelSummary, "accountId" | "userId"> {
  return {
    id: parseString(body.id, "id"),
    deviceId: parseString(body.deviceId, "deviceId"),
    modelId: parseString(body.modelId, "modelId"),
    displayName: parseString(body.displayName, "displayName"),
    provider: parseModelProvider(body.provider),
    repositoryId: parseNullableString(body.repositoryId),
    filename: parseString(body.filename, "filename"),
    format: parseModelFormat(body.format),
    quantization: parseNullableString(body.quantization),
    architecture: parseNullableString(body.architecture),
    parameterCount: parseNullablePositiveInteger(body.parameterCount, "parameterCount"),
    contextLength: parseNullablePositiveInteger(body.contextLength, "contextLength"),
    fileSizeBytes: parsePositiveInteger(body.fileSizeBytes, "fileSizeBytes"),
    checksum: parseNullableString(body.checksum),
    packageManifestVersion: parseNullableString(body.packageManifestVersion),
    packageSignature: parseNullableString(body.packageSignature),
    packageSigningKeyId: parseNullableString(body.packageSigningKeyId),
    license: parseString(body.license, "license"),
    commercialUseAllowed: parseBoolean(body.commercialUseAllowed, "commercialUseAllowed"),
    storageKey: parseString(body.storageKey, "storageKey"),
    runtimeBackend: parseAgentModelRuntimeBackend(body.runtimeBackend),
    installationStatus: parseModelInstallationStatus(body.installationStatus),
    compatibilityStatus: parseModelCompatibilityStatus(body.compatibilityStatus),
    installedAt: parseIsoTimestamp(body.installedAt, "installedAt"),
    lastVerifiedAt:
      body.lastVerifiedAt === null
        ? null
        : parseIsoTimestamp(body.lastVerifiedAt, "lastVerifiedAt"),
    validationError: parseNullableString(body.validationError)
  };
}

export function parseOssAgentSummary(value: unknown): OssAgentSummary {
  const agent = parseRequestBody(value);
  const id = parseString(agent.id, "agent.id");
  if (!isAgentDefinitionId(id) || id === "builtin:shopkeeper") {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent manifest ID is invalid.");
  }
  const source = agent.source;
  if (source !== "github" && source !== "huggingface") {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent manifest source is invalid.");
  }
  const runtime = agent.runtime;
  if (
    runtime !== "docker" &&
    runtime !== "gradio" &&
    runtime !== "javascript" &&
    runtime !== "python" &&
    runtime !== "typescript" &&
    runtime !== "unknown"
  ) {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent runtime is invalid.");
  }
  const executionMode = agent.executionMode;
  if (executionMode !== "hosted-api" && executionMode !== "backend-adapter") {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent execution mode is invalid.");
  }
  const minimumDeviceTier = agent.minimumDeviceTier;
  if (
    minimumDeviceTier !== "low" &&
    minimumDeviceTier !== "medium" &&
    minimumDeviceTier !== "high"
  ) {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent device tier is invalid.");
  }
  const popularity = agent.popularity;
  if (!Number.isSafeInteger(popularity) || (popularity as number) < 0) {
    throw new Cp2Error(400, "agent_manifest_invalid", "Agent popularity is invalid.");
  }
  return {
    id,
    label: parseString(agent.label, "agent.label"),
    description: parseString(agent.description, "agent.description"),
    source,
    sourceId: parseString(agent.sourceId, "agent.sourceId"),
    sourceUrl: parseString(agent.sourceUrl, "agent.sourceUrl"),
    license: parseString(agent.license, "agent.license"),
    licenseUrl: parseString(agent.licenseUrl, "agent.licenseUrl"),
    licenseVerified: parseBoolean(agent.licenseVerified, "agent.licenseVerified"),
    runtime,
    executionMode,
    minimumDeviceTier,
    minimumMemoryGb: parsePositiveInteger(agent.minimumMemoryGb, "agent.minimumMemoryGb"),
    requiresGpu: parseBoolean(agent.requiresGpu, "agent.requiresGpu"),
    popularity: popularity as number,
    capabilities: parseStringArray(agent.capabilities, "agent.capabilities", 40),
    updatedAt:
      agent.updatedAt === null ? null : parseIsoTimestamp(agent.updatedAt, "agent.updatedAt")
  };
}

export function parseModelProvider(value: unknown): InstalledAgentModelSummary["provider"] {
  if (value === "huggingface" || value === "github" || value === "custom") return value;
  throw new Cp2Error(400, "model_provider_invalid", "Model provider is invalid.");
}

export function parseModelFormat(value: unknown): "GGUF" {
  if (value === "GGUF") return value;
  throw new Cp2Error(400, "model_format_invalid", "Only GGUF models are supported.");
}

export function parseModelInstallationStatus(value: unknown): ModelInstallationStatus {
  if (
    value === "DOWNLOADING" ||
    value === "INSTALLED" ||
    value === "CORRUPT" ||
    value === "REMOVED" ||
    value === "FAILED"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_installation_status_invalid", "Installation status is invalid.");
}

export function parseModelCompatibilityStatus(value: unknown): ModelCompatibilityStatus {
  if (
    value === "UNKNOWN" ||
    value === "COMPATIBLE" ||
    value === "INCOMPATIBLE" ||
    value === "INSUFFICIENT_MEMORY" ||
    value === "UNSUPPORTED_ARCHITECTURE" ||
    value === "UNSUPPORTED_QUANTIZATION"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_compatibility_status_invalid", "Compatibility status is invalid.");
}

export function parseAgentModelRuntimeBackend(value: unknown): AgentModelRuntimeBackend {
  if (
    value === "LLAMA_CPP_ANDROID" ||
    value === "LLAMA_CPP_BROWSER" ||
    value === "OLLAMA" ||
    value === "CLOUD"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_runtime_backend_invalid", "Runtime backend is invalid.");
}

export function parsePreferredExecutionMode(value: unknown): PreferredExecutionMode {
  if (value === "LOCAL_ONLY" || value === "LOCAL_FIRST" || value === "CLOUD_ONLY") return value;
  throw new Cp2Error(400, "execution_mode_invalid", "Execution mode is invalid.");
}

export function parseModelExecutionTarget(value: unknown): ModelExecutionTarget {
  if (isModelExecutionTarget(value)) {
    return value;
  }
  throw new Cp2Error(400, "execution_target_invalid", "Execution target is invalid.");
}

/** Absent leaves the shop's current harness (or the platform default) unchanged; present selects
 *  a specific registered AgentRuntimeAdapter. */
export function parseAgentRuntimeAdapterId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Cp2Error(
      400,
      "agent_runtime_adapter_id_invalid",
      "agentRuntimeAdapterId must be a non-empty string."
    );
  }
  try {
    return normalizeAdapterId(value);
  } catch {
    throw new Cp2Error(
      400,
      "agent_runtime_adapter_id_invalid",
      "agentRuntimeAdapterId is not a valid adapter id."
    );
  }
}

export function parseAgentModelBindingPermissions(value: unknown): AgentModelBindingPermissions {
  const permissions = parseRequestBody(value);
  return {
    allowInstalledApp: parseBoolean(permissions.allowInstalledApp, "permissions.allowInstalledApp"),
    allowRemoteShopDevice: parseBoolean(
      permissions.allowRemoteShopDevice,
      "permissions.allowRemoteShopDevice"
    )
  };
}

export function parseAgentModelReadinessStatus(value: unknown): AgentModelReadinessStatus {
  if (value === "ATTACHED" || value === "LOADING" || value === "READY" || value === "FAILED") {
    return value;
  }
  throw new Cp2Error(400, "model_readiness_status_invalid", "Readiness status is invalid.");
}

export function parseBrowserDeviceTier(value: unknown): BrowserDeviceTier | null {
  if (value === null || value === undefined) return null;
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Cp2Error(400, "browser_device_tier_invalid", "Browser device tier is invalid.");
}

export function parseBrowserRuntimeContract(value: unknown): BrowserRuntimeContract | null {
  if (value === null || value === undefined) return null;
  const contract = parseRequestBody(value);
  if (
    contract.schemaVersion !== 1 ||
    (contract.adapterId !== "transformers-js" && contract.adapterId !== "webllm") ||
    (contract.runtime !== "browser-webgpu" && contract.runtime !== "browser-wasm") ||
    (contract.backend !== "webgpu" && contract.backend !== "wasm") ||
    contract.streaming !== true ||
    contract.cancellation !== true ||
    (contract.tokenCounting !== "exact" && contract.tokenCounting !== "estimated") ||
    !Array.isArray(contract.checkpointKinds) ||
    contract.checkpointKinds.some(
      (kind) => kind !== "task-state" && kind !== "token-replay" && kind !== "native-kv"
    ) ||
    (contract.nativeStateFormat !== null && typeof contract.nativeStateFormat !== "string")
  ) {
    throw new Cp2Error(
      400,
      "browser_runtime_contract_invalid",
      "Browser runtime contract is invalid."
    );
  }
  return {
    schemaVersion: 1,
    adapterId: contract.adapterId,
    adapterVersion: parseString(contract.adapterVersion, "runtimeContract.adapterVersion"),
    libraryRevision: parseNullableString(contract.libraryRevision),
    runtime: contract.runtime,
    backend: contract.backend,
    streaming: true,
    cancellation: true,
    tokenCounting: contract.tokenCounting,
    checkpointKinds: [...contract.checkpointKinds] as BrowserRuntimeContract["checkpointKinds"],
    nativeStateFormat: parseNullableString(contract.nativeStateFormat)
  };
}

export function parseBrowserCheckpointContract(
  value: unknown
): BrowserCheckpointCompatibilityContract | null {
  if (value === null || value === undefined) return null;
  const contract = parseRequestBody(value);
  if (
    contract.schemaVersion !== 1 ||
    contract.checkpointKind !== "task-state" ||
    contract.taskStateSchema !== "soko.browser-task-state.v2" ||
    (contract.sourceAdapterId !== "transformers-js" && contract.sourceAdapterId !== "webllm") ||
    contract.promptRepresentation !== "role-content-messages" ||
    contract.portableAcrossAdapters !== true
  ) {
    throw new Cp2Error(
      400,
      "browser_checkpoint_contract_invalid",
      "Browser checkpoint compatibility contract is invalid."
    );
  }
  return {
    schemaVersion: 1,
    checkpointKind: "task-state",
    taskStateSchema: "soko.browser-task-state.v2",
    modelFamilyId: parseString(contract.modelFamilyId, "checkpointContract.modelFamilyId"),
    sourceModelId: parseString(contract.sourceModelId, "checkpointContract.sourceModelId"),
    sourceModelRevision: parseString(
      contract.sourceModelRevision,
      "checkpointContract.sourceModelRevision"
    ),
    sourceAdapterId: contract.sourceAdapterId,
    promptRepresentation: "role-content-messages",
    portableAcrossAdapters: true
  };
}

export function parseNullablePositiveInteger(value: unknown, name: string): number | null {
  return value === null ? null : parsePositiveInteger(value, name);
}

export function observeRequestAbort(
  request: FastifyRequest,
  reply: FastifyReply
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("The HTTP client disconnected."));
  const abortIfResponseClosed = () => {
    if (!reply.raw.writableEnded) abort();
  };
  if (request.raw.aborted) {
    abort();
  } else {
    request.raw.once("aborted", abort);
    reply.raw.once("close", abortIfResponseClosed);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.off("aborted", abort);
      reply.raw.off("close", abortIfResponseClosed);
    }
  };
}
