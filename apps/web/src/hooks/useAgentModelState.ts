import type { AgentModelAssignmentSummary } from "@soko/shared-types";

import {
  assignmentFromServer,
  readDeviceAgentModelAssignment,
  saveDeviceAgentModelAssignment,
  type DeviceAgentModelAssignment
} from "../agent-model-assignment";
import { getOrCreateDeviceModelScopeId, listLocalAiModels } from "../ai-model-manager";
import { installedModelRequest } from "../agent-model-panel-utils";
import { getJson, postJson, putJson } from "../api-helpers";

export function useAgentModelState() {
  async function restoreDeviceModelForLaunch(
    businessId: string
  ): Promise<DeviceAgentModelAssignment> {
    const deviceId = getOrCreateDeviceModelScopeId();
    const localAssignment = readDeviceAgentModelAssignment(businessId, deviceId);
    const pendingInstallation =
      localAssignment?.syncStatus === "PENDING" &&
      localAssignment.readinessStatus === "READY" &&
      localAssignment.activeModelInstallationId !== null
        ? (listLocalAiModels().find(
            (model) => model.id === localAssignment.activeModelInstallationId
          ) ?? null)
        : null;
    if (localAssignment !== null && pendingInstallation !== null) {
      try {
        await postJson("/v1/models/installed", installedModelRequest(pendingInstallation));
        await postJson(`/v1/models/${encodeURIComponent(pendingInstallation.id)}/validate`, {
          deviceId,
          installationStatus: pendingInstallation.installationStatus,
          compatibilityStatus: pendingInstallation.compatibilityStatus,
          validationError: pendingInstallation.validationError
        });
        const synchronized = assignmentFromServer(
          await putJson<AgentModelAssignmentSummary>(`/businesses/${businessId}/agent-model`, {
            deviceId,
            installationId: localAssignment.activeModelInstallationId,
            preferredExecutionMode: localAssignment.preferredExecutionMode,
            readinessStatus: localAssignment.readinessStatus,
            lastSuccessfulInferenceAt: localAssignment.lastSuccessfulInferenceAt,
            lastErrorCode: localAssignment.lastErrorCode
          })
        );
        saveDeviceAgentModelAssignment(synchronized);
        return synchronized;
      } catch {
        // Keep the already health-checked local assignment usable. The next online/foreground
        // restore retries the idempotent registration and assignment operations.
        return localAssignment;
      }
    }
    const serverAssignment = assignmentFromServer(
      await getJson<AgentModelAssignmentSummary>(
        `/businesses/${businessId}/agent-model?deviceId=${encodeURIComponent(deviceId)}`
      )
    );
    const installationAvailable =
      serverAssignment.activeModelInstallationId === null ||
      listLocalAiModels().some((model) => model.id === serverAssignment.activeModelInstallationId);
    const restoredAssignment = installationAvailable
      ? serverAssignment
      : {
          ...serverAssignment,
          activeModelInstallationId: null,
          preferredExecutionMode: "LOCAL_FIRST" as const,
          readinessStatus: "FAILED" as const,
          runtimeBackend: null,
          lastSuccessfulInferenceAt: null,
          lastErrorCode: "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE",
          updatedAt: new Date().toISOString()
        };
    saveDeviceAgentModelAssignment(restoredAssignment);
    return restoredAssignment;
  }

  return {
    restoreDeviceModelForLaunch
  };
}
