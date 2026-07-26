import type { AgentModelRuntimeBackend } from "@soko/shared-types";
import type { LocalAiModel } from "../ai-model-manager";

export const nativeModelPackageManifestVersion = "1.0";
export const minimumNativeBridgeApiVersion = "1.0.0";

export type NativeModelCompatibilityErrorCode =
  | "MODEL_INCOMPATIBLE"
  | "MODEL_CHECKSUM_MISMATCH"
  | "MODEL_SIGNATURE_INVALID"
  | "BRIDGE_VERSION_UNSUPPORTED"
  | "INSUFFICIENT_MEMORY"
  | "UNSUPPORTED_ARCHITECTURE"
  | "UNSUPPORTED_QUANTIZATION";

export interface NativeModelInspectionAttestation {
  compatible: boolean;
  backend?: AgentModelRuntimeBackend;
  estimatedMemoryBytes?: number | null;
  errorCode?: NativeModelCompatibilityErrorCode | null;
  bridgeApiVersion?: string;
  availableMemoryBytes?: number | null;
  supportedArchitectures?: string[];
  supportedQuantizations?: string[];
  artifactChecksumSha256?: string | null;
  checksumVerified?: boolean;
  signatureVerified?: boolean;
  trustedKeyId?: string | null;
}

export interface NativeModelCompatibilityProfile {
  passed: boolean;
  interfaceCompatible: boolean;
  runtimeCompatible: boolean;
  resourceProfileFit: boolean;
  architectureCompatible: boolean;
  quantizationCompatible: boolean;
  checksumValid: boolean;
  signatureValid: boolean;
  blockingIssues: NativeModelCompatibilityErrorCode[];
  warnings: string[];
  errorCode: NativeModelCompatibilityErrorCode | null;
}

export function evaluateNativeModelCompatibility(input: {
  model: LocalAiModel;
  inspection: NativeModelInspectionAttestation;
  minimumBridgeVersion?: string;
}): NativeModelCompatibilityProfile {
  const minimumBridgeVersion = input.minimumBridgeVersion ?? minimumNativeBridgeApiVersion;
  const blockingIssues: NativeModelCompatibilityErrorCode[] = [];
  const warnings: string[] = [];

  const interfaceCompatible =
    input.inspection.bridgeApiVersion !== undefined &&
    compareVersions(input.inspection.bridgeApiVersion, minimumBridgeVersion) >= 0;
  if (!interfaceCompatible) blockingIssues.push("BRIDGE_VERSION_UNSUPPORTED");

  const runtimeCompatible =
    input.inspection.compatible &&
    (input.inspection.backend === undefined ||
      input.inspection.backend === input.model.runtimeBackend);
  if (!runtimeCompatible) {
    blockingIssues.push(input.inspection.errorCode ?? "MODEL_INCOMPATIBLE");
  }

  const requiredMemory =
    input.inspection.estimatedMemoryBytes ?? Math.ceil(input.model.fileSizeBytes * 2.5);
  const availableMemory = input.inspection.availableMemoryBytes;
  const resourceProfileFit =
    availableMemory === undefined || availableMemory === null || availableMemory >= requiredMemory;
  if (!resourceProfileFit) blockingIssues.push("INSUFFICIENT_MEMORY");
  if (availableMemory === undefined || availableMemory === null) {
    warnings.push("available_memory_not_reported");
  }

  const architectureCompatible = supportsValue(
    input.model.architecture,
    input.inspection.supportedArchitectures
  );
  if (!architectureCompatible) blockingIssues.push("UNSUPPORTED_ARCHITECTURE");

  const quantizationCompatible = supportsValue(
    input.model.quantization,
    input.inspection.supportedQuantizations
  );
  if (!quantizationCompatible) blockingIssues.push("UNSUPPORTED_QUANTIZATION");

  const checksumConfigured = input.model.checksum !== null;
  const expectedChecksum = normalizeSha256(input.model.checksum);
  const actualChecksum = normalizeSha256(input.inspection.artifactChecksumSha256);
  const checksumValid =
    checksumConfigured && expectedChecksum === null
      ? false
      : expectedChecksum === null
        ? actualChecksum === null || input.inspection.checksumVerified === true
        : input.inspection.checksumVerified === true && actualChecksum === expectedChecksum;
  if (!checksumValid) blockingIssues.push("MODEL_CHECKSUM_MISMATCH");
  if (expectedChecksum === null) warnings.push("model_checksum_not_pinned");

  const signatureConfigured =
    input.model.packageSignature != null || input.model.packageSigningKeyId != null;
  const signatureValid =
    !signatureConfigured ||
    (input.model.packageManifestVersion === nativeModelPackageManifestVersion &&
      input.model.packageSignature != null &&
      input.model.packageSigningKeyId != null &&
      input.inspection.signatureVerified === true &&
      input.inspection.trustedKeyId === input.model.packageSigningKeyId);
  if (!signatureValid) blockingIssues.push("MODEL_SIGNATURE_INVALID");
  if (!signatureConfigured) warnings.push("model_package_unsigned");

  const distinctIssues = [...new Set(blockingIssues)];
  return {
    passed: distinctIssues.length === 0,
    interfaceCompatible,
    runtimeCompatible,
    resourceProfileFit,
    architectureCompatible,
    quantizationCompatible,
    checksumValid,
    signatureValid,
    blockingIssues: distinctIssues,
    warnings,
    errorCode: distinctIssues[0] ?? null
  };
}

function supportsValue(value: string | null, supported: string[] | undefined): boolean {
  if (value === null) return true;
  if (supported === undefined || supported.length === 0) return false;
  const normalized = value.trim().toLowerCase();
  return supported.some((candidate) => candidate.trim().toLowerCase() === normalized);
}

function normalizeSha256(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (leftParts === null || rightParts === null) return -1;
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
