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
  downloadUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  license: string | null;
}

export interface LocalAiModel {
  id: string;
  label: string;
  fileName: string;
  fileSizeBytes: number;
  license: string;
  source: "catalog" | "custom";
  storedAt: string;
}

export interface ModelTransferProgress {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

const modelDirectoryName = "soko-ai-models";
const localModelMetadataKey = "soko.local-ai-models.v1";

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

export function listLocalAiModels(): LocalAiModel[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(localModelMetadataKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isLocalAiModel) : [];
  } catch {
    return [];
  }
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
    onProgress
  );
  const localModel: LocalAiModel = {
    id: model.id,
    label: model.label,
    fileName: model.fileName,
    fileSizeBytes: model.fileSizeBytes,
    license: model.license,
    source: "catalog",
    storedAt: new Date().toISOString()
  };
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
  const localModel: LocalAiModel = {
    id,
    label: file.name.replace(/\.gguf$/i, ""),
    fileName: storedFileName,
    fileSizeBytes: file.size,
    license: "User-confirmed commercial license",
    source: "custom",
    storedAt: new Date().toISOString()
  };
  saveLocalModel(localModel);
  return localModel;
}

export async function removeLocalAiModel(model: LocalAiModel): Promise<void> {
  const directory = await openModelDirectory();
  await directory.removeEntry(model.fileName).catch(() => undefined);
  saveLocalModels(listLocalAiModels().filter((candidate) => candidate.id !== model.id));
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
  onProgress: (progress: ModelTransferProgress) => void
): Promise<void> {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const reader = stream.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      await writable.write(chunk);
      receivedBytes += value.byteLength;
      onProgress({
        receivedBytes,
        totalBytes,
        percent: Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
      });
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

function saveLocalModel(model: LocalAiModel): void {
  saveLocalModels([...listLocalAiModels().filter((candidate) => candidate.id !== model.id), model]);
}

function saveLocalModels(models: LocalAiModel[]): void {
  localStorage.setItem(localModelMetadataKey, JSON.stringify(models));
}

function isLocalAiModel(value: unknown): value is LocalAiModel {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Partial<LocalAiModel>;
  return (
    typeof model.id === "string" &&
    typeof model.label === "string" &&
    typeof model.fileName === "string" &&
    typeof model.fileSizeBytes === "number" &&
    typeof model.license === "string" &&
    (model.source === "catalog" || model.source === "custom") &&
    typeof model.storedAt === "string"
  );
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
