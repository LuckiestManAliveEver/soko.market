import type { AiModelSummary } from "./soko-application-shared";
import type { LocalAiModel } from "./ai-model-manager";

export function isDownloadableCatalogModel(model: AiModelSummary): boolean {
  return model.source === "huggingface" || model.source === "github";
}

export function applyDeploymentRuntimeAvailability(
  models: AiModelSummary[],
  deploymentCatalog: AiModelSummary[]
): AiModelSummary[] {
  const availabilityByModelId = new Map(
    deploymentCatalog
      .filter((model) => model.runtimeAvailability !== undefined)
      .map((model) => [model.id, model.runtimeAvailability] as const)
  );
  return models.map((model) => {
    const runtimeAvailability = availabilityByModelId.get(model.id);
    return runtimeAvailability === undefined
      ? model
      : { ...model, runtimeAvailability: { ...runtimeAvailability } };
  });
}

export function installedModelRequest(model: LocalAiModel): Record<string, unknown> {
  return {
    id: model.id,
    deviceId: model.deviceId,
    modelId: model.modelId,
    displayName: model.displayName,
    provider: model.provider,
    repositoryId: model.repositoryId,
    filename: model.fileName,
    format: model.format,
    quantization: model.quantization,
    architecture: model.architecture,
    parameterCount: model.parameterCount,
    contextLength: model.contextLength,
    fileSizeBytes: model.fileSizeBytes,
    checksum: model.checksum,
    packageManifestVersion: model.packageManifestVersion ?? null,
    packageSignature: model.packageSignature ?? null,
    packageSigningKeyId: model.packageSigningKeyId ?? null,
    license: model.license,
    commercialUseAllowed: model.commercialUseAllowed,
    storageKey: model.storageKey,
    runtimeBackend: model.runtimeBackend,
    installationStatus: model.installationStatus,
    compatibilityStatus: model.compatibilityStatus,
    installedAt: model.installedAt,
    lastVerifiedAt: model.lastVerifiedAt,
    validationError: model.validationError
  };
}
