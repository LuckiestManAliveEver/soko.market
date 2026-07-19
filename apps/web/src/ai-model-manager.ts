import type {
  AgentModelRuntimeBackend,
  ModelCompatibilityStatus,
  ModelInstallationStatus
} from "@soko/shared-types";

export interface DeviceModelCapability {
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  freeStorageBytes: number | null;
  level: "basic" | "standard" | "high";
  privateStorageSupported: boolean;
  customModelsAllowed: boolean;
  reason: string;
}

export interface DeviceCapabilitySignals {
  deviceMemoryGb?: number | undefined;
  hardwareConcurrency?: number | undefined;
  quotaBytes?: number | undefined;
  usageBytes?: number | undefined;
  privateStorageSupported?: boolean | undefined;
}

export interface DownloadableAiModel {
  id: string;
  label: string;
  source: "huggingface" | "github" | "builtin" | "hosted";
  downloadUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  license: string | null;
}

export interface CatalogModelFitInput extends DownloadableAiModel {
  capabilities: string[];
  minimumMemoryGb: number | null;
  recommended: boolean;
}

export interface RankedCatalogModel<T extends CatalogModelFitInput> {
  model: T;
  score: number;
  reasons: string[];
}

export interface LocalAiModel {
  id: string;
  modelId: string;
  label: string;
  displayName: string;
  provider: "huggingface" | "github" | "custom";
  repositoryId: string | null;
  fileName: string;
  storageKey: string;
  format: "GGUF";
  quantization: string | null;
  architecture: string | null;
  parameterCount: number | null;
  contextLength: number | null;
  fileSizeBytes: number;
  checksum: string | null;
  license: string;
  commercialUseAllowed: boolean;
  runtimeBackend: AgentModelRuntimeBackend;
  installationStatus: ModelInstallationStatus;
  compatibilityStatus: ModelCompatibilityStatus;
  deviceId: string;
  storedAt: string;
  installedAt: string;
  lastVerifiedAt: string | null;
  validationError: string | null;
}

export interface ModelTransferProgress {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface DefaultOfflineAiModel extends CatalogModelFitInput {
  provider: "local";
  description: string;
  available: true;
  format: "GGUF";
  licenseUrl: string;
  modelCardUrl: string;
}

export const defaultOfflineAiModels: DefaultOfflineAiModel[] = [
  {
    id: "smollm2-360m-android",
    label: "SmolLM2 360M offline starter",
    provider: "local",
    description: "The smallest default for quick instructions on entry-level Android phones.",
    capabilities: ["chat", "offline", "english"],
    available: true,
    source: "huggingface",
    format: "GGUF",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/blob/main/LICENSE",
    modelCardUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF",
    downloadUrl:
      "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf?download=true",
    fileName: "smollm2-360m-instruct-q8_0.gguf",
    fileSizeBytes: 386_000_000,
    minimumMemoryGb: 2,
    recommended: false
  },
  {
    id: "qwen2.5-0.5b-android",
    label: "Qwen2.5 0.5B offline default",
    provider: "local",
    description: "The default multilingual model for shop instructions and structured extraction.",
    capabilities: ["chat", "tool-routing", "offline", "multilingual", "instruction-following"],
    available: true,
    source: "huggingface",
    format: "GGUF",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/main/LICENSE",
    modelCardUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf?download=true",
    fileName: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    fileSizeBytes: 491_000_000,
    minimumMemoryGb: 3,
    recommended: true
  }
];

const modelDirectoryName = "soko-ai-models";
const localModelMetadataKey = "soko.local-ai-models.v1";
const canonicalModelMetadataKey = "soko.local-ai-models.v2";
const deviceModelScopeKey = "soko.device-model-scope.v1";

export function assessDeviceModelCapability(
  signals: DeviceCapabilitySignals
): DeviceModelCapability {
  const deviceMemoryGb = finitePositive(signals.deviceMemoryGb);
  const hardwareConcurrency = Math.max(1, Math.floor(signals.hardwareConcurrency ?? 1));
  const quotaBytes = finitePositive(signals.quotaBytes);
  const usageBytes = Math.max(0, signals.usageBytes ?? 0);
  const privateStorageSupported = signals.privateStorageSupported ?? true;
  const freeStorageBytes = quotaBytes === null ? null : Math.max(0, quotaBytes - usageBytes);
  const hasCustomStorage = freeStorageBytes !== null && freeStorageBytes >= 2 * 1024 ** 3;
  const hasCustomCompute =
    (deviceMemoryGb !== null && deviceMemoryGb >= 6 && hardwareConcurrency >= 6) ||
    (deviceMemoryGb === null && hardwareConcurrency >= 8);

  if (hasCustomCompute && hasCustomStorage && privateStorageSupported) {
    return {
      deviceMemoryGb,
      hardwareConcurrency,
      freeStorageBytes,
      level: "high",
      privateStorageSupported,
      customModelsAllowed: true,
      reason:
        "This device has enough memory, CPU capacity, and free storage for custom GGUF models."
    };
  }

  if ((deviceMemoryGb ?? 4) >= 3 && hardwareConcurrency >= 4) {
    return {
      deviceMemoryGb,
      hardwareConcurrency,
      freeStorageBytes,
      level: "standard",
      privateStorageSupported,
      customModelsAllowed: false,
      reason: privateStorageSupported
        ? "Use the compact catalog models; custom models require 6 GB RAM, 6 CPU threads, and 2 GB free storage."
        : "This browser does not support private on-device model storage. Use Android Chrome to predownload models."
    };
  }

  return {
    deviceMemoryGb,
    hardwareConcurrency,
    freeStorageBytes,
    level: "basic",
    privateStorageSupported,
    customModelsAllowed: false,
    reason: privateStorageSupported
      ? "Use SmolLM2 on this device for the most reliable on-device experience."
      : "This browser does not support private on-device model storage. Use Android Chrome to predownload models."
  };
}

export async function inspectDeviceModelCapability(): Promise<DeviceModelCapability> {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const estimate = await navigator.storage?.estimate().catch(() => undefined);
  return assessDeviceModelCapability({
    deviceMemoryGb: navigatorWithMemory.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    quotaBytes: estimate?.quota,
    usageBytes: estimate?.usage,
    privateStorageSupported: navigator.storage?.getDirectory !== undefined
  });
}

export function canRunCatalogModel(
  capability: DeviceModelCapability,
  minimumMemoryGb: number | null,
  fileSizeBytes: number | null
): boolean {
  if (!capability.privateStorageSupported) return false;
  if (
    fileSizeBytes !== null &&
    capability.freeStorageBytes !== null &&
    capability.freeStorageBytes < fileSizeBytes * 1.15
  ) {
    return false;
  }
  return (
    minimumMemoryGb === null ||
    capability.deviceMemoryGb === null ||
    capability.deviceMemoryGb >= minimumMemoryGb
  );
}

export function rankCatalogModelsForDevice<T extends CatalogModelFitInput>(
  models: T[],
  capability: DeviceModelCapability
): Array<RankedCatalogModel<T>> {
  return models
    .filter(
      (model) =>
        (model.source === "huggingface" || model.source === "github") &&
        model.license === "Apache-2.0" &&
        model.downloadUrl !== null &&
        model.fileName !== null &&
        model.fileSizeBytes !== null &&
        canRunCatalogModel(capability, model.minimumMemoryGb, model.fileSizeBytes)
    )
    .map((model) => scoreCatalogModel(model, capability))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.model.fileSizeBytes ?? 0) - (right.model.fileSizeBytes ?? 0) ||
        left.model.label.localeCompare(right.model.label)
    );
}

export function listLocalAiModels(): LocalAiModel[] {
  try {
    const canonical: unknown = JSON.parse(localStorage.getItem(canonicalModelMetadataKey) ?? "[]");
    if (Array.isArray(canonical)) {
      const records = canonical.filter(isLocalAiModel);
      if (records.length > 0 || localStorage.getItem(canonicalModelMetadataKey) !== null) {
        return records.filter((model) => model.installationStatus !== "REMOVED");
      }
    }

    const legacy: unknown = JSON.parse(localStorage.getItem(localModelMetadataKey) ?? "[]");
    const migrated = Array.isArray(legacy)
      ? legacy.flatMap((value) => migrateLegacyLocalModel(value))
      : [];
    if (migrated.length > 0) {
      saveLocalModels(migrated);
    }
    return migrated;
  } catch {
    return [];
  }
}

export function getOrCreateDeviceModelScopeId(): string {
  const existing = localStorage.getItem(deviceModelScopeKey)?.trim();
  if (existing) return existing;
  const generated =
    globalThis.crypto?.randomUUID?.() ??
    `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(deviceModelScopeKey, generated);
  return generated;
}

export async function downloadCatalogModel(
  model: DownloadableAiModel,
  onProgress: (progress: ModelTransferProgress) => void
): Promise<LocalAiModel> {
  if (model.downloadUrl === null || model.fileName === null || model.fileSizeBytes === null) {
    throw new Error("This model does not include a downloadable GGUF file.");
  }
  if (model.license !== "Apache-2.0") {
    throw new Error("Only catalog models with a verified Apache-2.0 license can be downloaded.");
  }
  assertCatalogDownloadUrl(model);

  await ensureStorageAvailable(model.fileSizeBytes);
  await navigator.storage.persist?.();
  const directory = await openModelDirectory();
  const response = await fetch(model.downloadUrl);
  if (!response.ok || response.body === null) {
    throw new Error(`Model download failed (${response.status || "network error"}).`);
  }

  await streamToDeviceFile(
    directory,
    model.fileName,
    response.body,
    model.fileSizeBytes,
    onProgress,
    true
  );
  const now = new Date().toISOString();
  const localModel = createInstalledModelRecord({
    modelId: model.id,
    label: model.label,
    provider: model.source === "github" ? "github" : "huggingface",
    repositoryId: repositoryIdFromModel(model),
    fileName: model.fileName,
    fileSizeBytes: model.fileSizeBytes,
    license: model.license,
    storedAt: now
  });
  saveLocalModel(localModel);
  return localModel;
}

export async function importCustomGgufModel(
  file: File,
  onProgress: (progress: ModelTransferProgress) => void
): Promise<LocalAiModel> {
  if (!file.name.toLowerCase().endsWith(".gguf")) {
    throw new Error("Choose a .gguf model file.");
  }
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...signature) !== "GGUF") {
    throw new Error("The selected file is not a valid GGUF model.");
  }

  await ensureStorageAvailable(file.size);
  await navigator.storage.persist?.();
  const id = `custom:${slugify(file.name.replace(/\.gguf$/i, ""))}-${file.size.toString(36)}`;
  const storedFileName = `${id.replace(":", "-")}.gguf`;
  const directory = await openModelDirectory();
  await streamToDeviceFile(directory, storedFileName, file.stream(), file.size, onProgress);
  const localModel = createInstalledModelRecord({
    modelId: id,
    label: file.name.replace(/\.gguf$/i, ""),
    provider: "custom",
    repositoryId: null,
    fileName: storedFileName,
    fileSizeBytes: file.size,
    license: "User-confirmed commercial license",
    storedAt: new Date().toISOString()
  });
  saveLocalModel(localModel);
  return localModel;
}

export async function removeLocalAiModel(model: LocalAiModel): Promise<void> {
  const directory = await openModelDirectory();
  await directory.removeEntry(model.storageKey).catch(() => undefined);
  saveLocalModels(
    listLocalAiModels().filter(
      (candidate) =>
        candidate.id !== model.id &&
        !(
          candidate.deviceId === model.deviceId &&
          candidate.modelId === model.modelId &&
          candidate.storageKey === model.storageKey
        )
    )
  );
}

export async function validateLocalAiModel(
  model: LocalAiModel,
  capability?: DeviceModelCapability | null
): Promise<LocalAiModel> {
  const verifiedAt = new Date().toISOString();
  let updated: LocalAiModel;

  try {
    const directory = await openModelDirectory();
    const handle = await directory.getFileHandle(model.storageKey);
    const file = await handle.getFile();
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (String.fromCharCode(...signature) !== "GGUF") {
      updated = {
        ...model,
        installationStatus: "CORRUPT",
        compatibilityStatus: "INCOMPATIBLE",
        lastVerifiedAt: verifiedAt,
        validationError: "MODEL_CORRUPT"
      };
    } else if (Math.abs(file.size - model.fileSizeBytes) > Math.max(1024 ** 2, file.size * 0.01)) {
      updated = {
        ...model,
        installationStatus: "CORRUPT",
        compatibilityStatus: "INCOMPATIBLE",
        lastVerifiedAt: verifiedAt,
        validationError: "MODEL_FILE_SIZE_MISMATCH"
      };
    } else {
      const compatible =
        capability === undefined ||
        capability === null ||
        canRunCatalogModel(capability, estimatedMinimumMemoryGb(model), model.fileSizeBytes);
      updated = {
        ...model,
        installationStatus: "INSTALLED",
        compatibilityStatus: compatible ? "COMPATIBLE" : "INSUFFICIENT_MEMORY",
        lastVerifiedAt: verifiedAt,
        validationError: compatible ? null : "INSUFFICIENT_MEMORY"
      };
    }
  } catch {
    updated = {
      ...model,
      installationStatus: "FAILED",
      compatibilityStatus: "UNKNOWN",
      lastVerifiedAt: verifiedAt,
      validationError: "MODEL_FILE_MISSING"
    };
  }

  saveLocalModel(updated);
  return updated;
}

async function openModelDirectory(): Promise<FileSystemDirectoryHandle> {
  if (navigator.storage?.getDirectory === undefined) {
    throw new Error("Private device model storage is not supported by this browser.");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(modelDirectoryName, { create: true });
}

async function ensureStorageAvailable(fileSizeBytes: number): Promise<void> {
  const estimate = await navigator.storage?.estimate().catch(() => undefined);
  if (
    estimate?.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < fileSizeBytes * 1.15
  ) {
    throw new Error("Not enough free device storage for this model and its working space.");
  }
}

async function streamToDeviceFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  stream: ReadableStream<Uint8Array>,
  totalBytes: number,
  onProgress: (progress: ModelTransferProgress) => void,
  requireGgufHeader = false
): Promise<void> {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const reader = stream.getReader();
  let receivedBytes = 0;
  let signature = new Uint8Array();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      if (signature.byteLength < 4) {
        const needed = 4 - signature.byteLength;
        const nextSignature = new Uint8Array(signature.byteLength + Math.min(needed, chunk.length));
        nextSignature.set(signature);
        nextSignature.set(chunk.slice(0, needed), signature.byteLength);
        signature = nextSignature;
      }
      if (receivedBytes + chunk.byteLength > totalBytes + Math.max(1024 ** 2, totalBytes * 0.01)) {
        throw new Error("The downloaded model is larger than the catalog metadata.");
      }
      await writable.write(chunk);
      receivedBytes += value.byteLength;
      onProgress({
        receivedBytes,
        totalBytes,
        percent: Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
      });
    }
    if (requireGgufHeader && String.fromCharCode(...signature) !== "GGUF") {
      throw new Error("The downloaded file is not a valid GGUF model.");
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await directory.removeEntry(fileName).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function scoreCatalogModel<T extends CatalogModelFitInput>(
  model: T,
  capability: DeviceModelCapability
): RankedCatalogModel<T> {
  const reasons: string[] = [];
  let score = 50;
  const minimumMemoryGb = model.minimumMemoryGb ?? 2;
  const fileSizeBytes = model.fileSizeBytes ?? 0;

  if (model.recommended) {
    score += 18;
    reasons.push("catalog recommended");
  }
  if (model.capabilities.includes("tool-routing")) score += 12;
  if (model.capabilities.includes("instruction-following")) score += 10;
  if (model.capabilities.includes("multilingual")) score += 9;
  if (model.capabilities.includes("reasoning")) score += capability.level === "high" ? 12 : 4;

  if (capability.deviceMemoryGb !== null) {
    const usageRatio = minimumMemoryGb / capability.deviceMemoryGb;
    score += Math.max(0, 20 - Math.abs(0.58 - usageRatio) * 28);
    reasons.push(`${minimumMemoryGb} GB minimum fits reported RAM`);
  } else {
    score += Math.max(0, 10 - minimumMemoryGb);
    reasons.push("fits conservative unknown-RAM profile");
  }

  if (capability.freeStorageBytes !== null && fileSizeBytes > 0) {
    const storageRatio = fileSizeBytes / capability.freeStorageBytes;
    score += Math.max(0, 15 - storageRatio * 30);
    reasons.push("download fits available private storage");
  } else {
    score += Math.max(0, 8 - fileSizeBytes / 250_000_000);
  }

  if (model.source === "github") {
    reasons.push("verified GitHub release asset");
  } else {
    reasons.push("verified Hugging Face catalog");
  }

  return {
    model,
    score: Math.round(score * 10) / 10,
    reasons
  };
}

function assertCatalogDownloadUrl(model: DownloadableAiModel): void {
  const url = new URL(model.downloadUrl!);
  const validHost =
    (model.source === "huggingface" && url.hostname === "huggingface.co") ||
    (model.source === "github" && url.hostname === "github.com");

  if (
    url.protocol !== "https:" ||
    !validHost ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !model.fileName?.toLowerCase().endsWith(".gguf")
  ) {
    throw new Error("This catalog model does not have a trusted GGUF download URL.");
  }
}

function saveLocalModel(model: LocalAiModel): void {
  saveLocalModels([
    ...listLocalAiModels().filter(
      (candidate) =>
        candidate.id !== model.id &&
        !(
          candidate.deviceId === model.deviceId &&
          candidate.modelId === model.modelId &&
          candidate.storageKey === model.storageKey
        )
    ),
    model
  ]);
}

function saveLocalModels(models: LocalAiModel[]): void {
  localStorage.setItem(canonicalModelMetadataKey, JSON.stringify(models));
}

function isLocalAiModel(value: unknown): value is LocalAiModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Partial<LocalAiModel>;
  return (
    typeof model.id === "string" &&
    typeof model.modelId === "string" &&
    typeof model.label === "string" &&
    typeof model.displayName === "string" &&
    (model.provider === "huggingface" ||
      model.provider === "github" ||
      model.provider === "custom") &&
    (model.repositoryId === null || typeof model.repositoryId === "string") &&
    typeof model.fileName === "string" &&
    typeof model.storageKey === "string" &&
    model.format === "GGUF" &&
    typeof model.fileSizeBytes === "number" &&
    typeof model.license === "string" &&
    typeof model.commercialUseAllowed === "boolean" &&
    typeof model.deviceId === "string" &&
    typeof model.storedAt === "string" &&
    typeof model.installedAt === "string" &&
    typeof model.runtimeBackend === "string" &&
    typeof model.installationStatus === "string" &&
    typeof model.compatibilityStatus === "string"
  );
}

function migrateLegacyLocalModel(value: unknown): LocalAiModel[] {
  if (typeof value !== "object" || value === null) return [];
  const model = value as {
    id?: unknown;
    label?: unknown;
    fileName?: unknown;
    fileSizeBytes?: unknown;
    license?: unknown;
    source?: unknown;
    storedAt?: unknown;
  };
  if (
    typeof model.id !== "string" ||
    typeof model.label !== "string" ||
    typeof model.fileName !== "string" ||
    typeof model.fileSizeBytes !== "number" ||
    typeof model.license !== "string" ||
    (model.source !== "catalog" && model.source !== "custom") ||
    typeof model.storedAt !== "string"
  ) {
    return [];
  }
  return [
    createInstalledModelRecord({
      modelId: model.id,
      label: model.label,
      provider:
        model.source === "custom"
          ? "custom"
          : model.id.startsWith("github:")
            ? "github"
            : "huggingface",
      repositoryId: model.source === "custom" ? null : repositoryIdFromModelId(model.id),
      fileName: model.fileName,
      fileSizeBytes: model.fileSizeBytes,
      license: model.license,
      storedAt: model.storedAt
    })
  ];
}

function createInstalledModelRecord(input: {
  modelId: string;
  label: string;
  provider: LocalAiModel["provider"];
  repositoryId: string | null;
  fileName: string;
  fileSizeBytes: number;
  license: string;
  storedAt: string;
}): LocalAiModel {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `installation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    modelId: input.modelId,
    label: input.label,
    displayName: input.label,
    provider: input.provider,
    repositoryId: input.repositoryId,
    fileName: input.fileName,
    storageKey: input.fileName,
    format: "GGUF",
    quantization: inferQuantization(input.fileName),
    architecture: inferArchitecture(`${input.modelId} ${input.fileName}`),
    parameterCount: inferParameterCount(`${input.label} ${input.fileName}`),
    contextLength: 2_048,
    fileSizeBytes: input.fileSizeBytes,
    checksum: null,
    license: input.license,
    commercialUseAllowed:
      input.license === "Apache-2.0" || input.license === "User-confirmed commercial license",
    runtimeBackend: "LLAMA_CPP_ANDROID",
    installationStatus: "INSTALLED",
    compatibilityStatus: "UNKNOWN",
    deviceId: getOrCreateDeviceModelScopeId(),
    storedAt: input.storedAt,
    installedAt: input.storedAt,
    lastVerifiedAt: null,
    validationError: null
  };
}

function repositoryIdFromModel(model: DownloadableAiModel): string | null {
  return repositoryIdFromModelId(model.id);
}

function repositoryIdFromModelId(modelId: string): string | null {
  if (modelId.startsWith("huggingface:")) {
    return modelId.slice("huggingface:".length).split(".").slice(0, 2).join("/");
  }
  if (modelId.startsWith("github:")) {
    return modelId.slice("github:".length).split(".").slice(0, 2).join("/");
  }
  if (modelId === "qwen2.5-0.5b-android") return "Qwen/Qwen2.5-0.5B-Instruct-GGUF";
  if (modelId === "smollm2-360m-android") {
    return "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF";
  }
  return null;
}

function inferQuantization(fileName: string): string | null {
  return fileName.match(/(?:^|[._-])(q\d(?:_[a-z0-9]+)+)(?:[._-]|$)/i)?.[1]?.toUpperCase() ?? null;
}

function inferArchitecture(value: string): string | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("qwen")) return "qwen2";
  if (normalized.includes("smollm")) return "llama";
  if (normalized.includes("tinyllama") || normalized.includes("llama")) return "llama";
  return null;
}

function inferParameterCount(value: string): number | null {
  const match = value.toLowerCase().match(/(\d+(?:\.\d+)?)\s*([bm])\b/);
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * (match[2] === "b" ? 1_000_000_000 : 1_000_000));
}

function estimatedMinimumMemoryGb(model: LocalAiModel): number {
  return Math.max(2, Math.ceil((model.fileSizeBytes * 2.5) / 1024 ** 3));
}

function finitePositive(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 54) || "model"
  );
}
