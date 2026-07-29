import type { BrowserInferenceAssignmentSummary } from "@soko/shared-types";
import { getOrCreateDeviceModelScopeId } from "./ai-model-manager";
import {
  browserCheckpointCompatibilityContract,
  browserRuntimeContractForModel
} from "./browser-inference-contracts";
import type { BrowserInferenceState } from "./browser-inference-session";
import { getBrowserModel } from "./browser-model-registry";
import { apiFetch } from "./lib/api";

interface BrowserInferenceAssignmentResponse {
  assignment: BrowserInferenceAssignmentSummary | null;
}

export async function loadSyncedBrowserInferenceAssignment(
  businessId: string,
  deviceId = getOrCreateDeviceModelScopeId()
): Promise<BrowserInferenceAssignmentSummary | null> {
  const response = await apiFetch<BrowserInferenceAssignmentResponse>(
    `/businesses/${encodeURIComponent(
      businessId
    )}/browser-inference?deviceId=${encodeURIComponent(deviceId)}`
  );
  return response.assignment;
}

export async function synchronizeBrowserInferenceAssignment(input: {
  businessId: string;
  state: BrowserInferenceState;
  deviceId?: string;
}): Promise<BrowserInferenceAssignmentSummary | null> {
  const settings = input.state.settings;
  if (settings === null) return null;
  const deviceId = input.deviceId ?? getOrCreateDeviceModelScopeId();
  const model =
    settings.selectedModelId === null ? null : getBrowserModel(settings.selectedModelId);
  const existing =
    model !== null && input.state.capability.backend === "none"
      ? await loadSyncedBrowserInferenceAssignment(input.businessId, deviceId)
      : null;
  const runtimeContract =
    model === null
      ? null
      : input.state.capability.backend === "none"
        ? (existing?.runtimeContract ?? null)
        : browserRuntimeContractForModel(model, input.state.capability.backend);
  const checkpointCompatibilityContract =
    model === null
      ? null
      : (existing?.checkpointCompatibilityContract ??
        browserCheckpointCompatibilityContract(model));
  if (model !== null && (runtimeContract === null || checkpointCompatibilityContract === null)) {
    throw new Error("The browser runtime contract cannot be synchronized on this device.");
  }
  const ready = settings.enabled && settings.status === "ready";
  return apiFetch<BrowserInferenceAssignmentSummary>(
    `/businesses/${encodeURIComponent(input.businessId)}/browser-inference`,
    {
      method: "PUT",
      body: {
        deviceId,
        enabled: settings.enabled,
        selectedModelId: model?.id ?? null,
        modelFamilyId: model?.modelFamilyId ?? null,
        modelRevision: model?.modelRevision ?? null,
        runtimeContract,
        checkpointCompatibilityContract,
        deviceTier: input.state.capability.deviceTier,
        readinessStatus: ready
          ? "READY"
          : settings.status === "downloading"
            ? "LOADING"
            : settings.status === "error"
              ? "FAILED"
              : "ATTACHED",
        lastSuccessfulInferenceAt: ready ? settings.downloadedAt : null,
        lastErrorCode: settings.lastErrorCode
      }
    }
  );
}

export async function recordSyncedBrowserInferenceExecution(input: {
  businessId: string;
  modelId: string;
  successful: boolean;
  errorCode?: string | null;
  occurredAt?: string;
  deviceId?: string;
}): Promise<BrowserInferenceAssignmentSummary> {
  return apiFetch<BrowserInferenceAssignmentSummary>(
    `/businesses/${encodeURIComponent(input.businessId)}/browser-inference/executions`,
    {
      method: "POST",
      body: {
        deviceId: input.deviceId ?? getOrCreateDeviceModelScopeId(),
        modelId: input.modelId,
        successful: input.successful,
        errorCode: input.errorCode ?? null,
        occurredAt: input.occurredAt ?? new Date().toISOString()
      }
    }
  );
}

export async function removeSyncedBrowserInferenceAssignment(
  businessId: string,
  deviceId = getOrCreateDeviceModelScopeId()
): Promise<void> {
  await apiFetch(
    `/businesses/${encodeURIComponent(
      businessId
    )}/browser-inference?deviceId=${encodeURIComponent(deviceId)}`,
    { method: "DELETE" }
  );
}
