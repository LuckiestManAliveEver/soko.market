import type {
  AgentModelAssignmentSummary,
  AgentModelFallbackPolicy,
  AgentModelReadinessResult,
  PreferredExecutionMode
} from "@soko/shared-types";
import type { LocalAiModel } from "./ai-model-manager";

const assignmentStorageKey = "soko.agent-model-assignments.v1";

export interface DeviceAgentModelAssignment {
  agentId: string;
  businessId: string;
  deviceId: string;
  activeModelInstallationId: string | null;
  modelId: string | null;
  preferredExecutionMode: PreferredExecutionMode;
  fallbackPolicy: AgentModelFallbackPolicy;
  readinessStatus: "ATTACHED" | "LOADING" | "READY" | "FAILED";
  runtimeBackend: LocalAiModel["runtimeBackend"] | null;
  lastSuccessfulInferenceAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
}

export function readDeviceAgentModelAssignment(
  businessId: string,
  deviceId: string
): DeviceAgentModelAssignment | null {
  return (
    readAssignments().find(
      (assignment) => assignment.businessId === businessId && assignment.deviceId === deviceId
    ) ?? null
  );
}

export function saveDeviceAgentModelAssignment(
  assignment: DeviceAgentModelAssignment
): DeviceAgentModelAssignment {
  const assignments = readAssignments().filter(
    (candidate) =>
      candidate.businessId !== assignment.businessId || candidate.deviceId !== assignment.deviceId
  );
  localStorage.setItem(assignmentStorageKey, JSON.stringify([...assignments, assignment]));
  return assignment;
}

export function createPendingDeviceAssignment(input: {
  businessId: string;
  deviceId: string;
  installation: LocalAiModel;
  preferredExecutionMode: PreferredExecutionMode;
  fallbackPolicy: AgentModelFallbackPolicy;
}): DeviceAgentModelAssignment {
  return {
    agentId: input.businessId,
    businessId: input.businessId,
    deviceId: input.deviceId,
    activeModelInstallationId: input.installation.id,
    modelId: input.installation.modelId,
    preferredExecutionMode:
      input.preferredExecutionMode === "CLOUD_ONLY" ? "LOCAL_FIRST" : input.preferredExecutionMode,
    fallbackPolicy: input.fallbackPolicy,
    readinessStatus: "LOADING",
    runtimeBackend: input.installation.runtimeBackend,
    lastSuccessfulInferenceAt: null,
    lastErrorCode: null,
    updatedAt: new Date().toISOString()
  };
}

export function assignmentAfterReadiness(
  pending: DeviceAgentModelAssignment,
  result: AgentModelReadinessResult
): DeviceAgentModelAssignment {
  return {
    ...pending,
    readinessStatus: result.success ? "READY" : "FAILED",
    lastSuccessfulInferenceAt: result.success ? result.checkedAt : null,
    lastErrorCode: result.errorCode,
    updatedAt: result.checkedAt
  };
}

export function assignmentFromServer(
  assignment: AgentModelAssignmentSummary
): DeviceAgentModelAssignment {
  const legacyCloudPrimary =
    assignment.activeModelInstallationId === null && assignment.runtimeBackend === "CLOUD";
  return {
    agentId: assignment.agentId,
    businessId: assignment.businessId,
    deviceId: assignment.deviceId,
    activeModelInstallationId: legacyCloudPrimary ? null : assignment.activeModelInstallationId,
    modelId: legacyCloudPrimary ? null : assignment.modelId,
    preferredExecutionMode:
      legacyCloudPrimary || assignment.preferredExecutionMode === "CLOUD_ONLY"
        ? "LOCAL_FIRST"
        : assignment.preferredExecutionMode,
    fallbackPolicy: assignment.fallbackPolicy,
    readinessStatus: legacyCloudPrimary ? "ATTACHED" : assignment.readinessStatus,
    runtimeBackend: legacyCloudPrimary ? null : assignment.runtimeBackend,
    lastSuccessfulInferenceAt: legacyCloudPrimary ? null : assignment.lastSuccessfulInferenceAt,
    lastErrorCode: legacyCloudPrimary
      ? "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE"
      : assignment.lastErrorCode,
    updatedAt: assignment.updatedAt
  };
}

export function clearDeviceAgentModelAssignment(businessId: string, deviceId: string): void {
  localStorage.setItem(
    assignmentStorageKey,
    JSON.stringify(
      readAssignments().filter(
        (candidate) => candidate.businessId !== businessId || candidate.deviceId !== deviceId
      )
    )
  );
}

function readAssignments(): DeviceAgentModelAssignment[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(assignmentStorageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isDeviceAgentModelAssignment) : [];
  } catch {
    return [];
  }
}

function isDeviceAgentModelAssignment(value: unknown): value is DeviceAgentModelAssignment {
  if (typeof value !== "object" || value === null) return false;
  const assignment = value as Partial<DeviceAgentModelAssignment>;
  return (
    typeof assignment.agentId === "string" &&
    typeof assignment.businessId === "string" &&
    typeof assignment.deviceId === "string" &&
    (assignment.activeModelInstallationId === null ||
      typeof assignment.activeModelInstallationId === "string") &&
    (assignment.modelId === null || typeof assignment.modelId === "string") &&
    (assignment.preferredExecutionMode === "LOCAL_ONLY" ||
      assignment.preferredExecutionMode === "LOCAL_FIRST" ||
      assignment.preferredExecutionMode === "CLOUD_ONLY") &&
    (assignment.fallbackPolicy === "NEVER" ||
      assignment.fallbackPolicy === "WHEN_LOCAL_UNAVAILABLE" ||
      assignment.fallbackPolicy === "WHEN_LOCAL_FAILS" ||
      assignment.fallbackPolicy === "WHEN_CONTEXT_EXCEEDED") &&
    (assignment.readinessStatus === "ATTACHED" ||
      assignment.readinessStatus === "LOADING" ||
      assignment.readinessStatus === "READY" ||
      assignment.readinessStatus === "FAILED") &&
    typeof assignment.updatedAt === "string"
  );
}
