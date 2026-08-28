import { useState, type Dispatch, type SetStateAction } from "react";

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
import {
  readClientInferencePreferences,
  saveClientInferencePreferences
} from "../inference/preferences";
import {
  clientInferenceFeatureFlags,
  type ActiveAiModelSummary,
  type ActiveBusiness,
  type AgentSettings,
  type AiModelSummary,
  type SessionResponse
} from "../soko-application-shared";

interface UseAgentModelStateDeps {
  business: ActiveBusiness | null;
  session: SessionResponse | null;
  setAgentSettings: Dispatch<SetStateAction<AgentSettings>>;
  setStatusMessage: (message: string) => void;
  registerReset: (domainKey: string, fn: () => void) => void;
}

export function useAgentModelState(deps: UseAgentModelStateDeps) {
  const [deviceCloudFallbackModelId, setDeviceCloudFallbackModelId] = useState<string | null>(null);

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
            fallbackPolicy: localAssignment.fallbackPolicy,
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

  async function findSelectedCloudFallback(businessId: string): Promise<string | null> {
    if (!navigator.onLine || !clientInferenceFeatureFlags.cloudFallback) return null;
    const [registry, selectedFallback] = await Promise.all([
      getJson<{ models: AiModelSummary[] }>("/v1/ai-models").catch(() => ({ models: [] })),
      getJson<ActiveAiModelSummary>(`/businesses/${businessId}/ai-model`).catch(() => null)
    ]);
    const cloudModel = registry.models.find(
      (model) =>
        model.id === selectedFallback?.modelId && model.available && model.source === "hosted"
    );
    return cloudModel?.id ?? null;
  }

  function enableDeviceCloudFallback() {
    if (deps.session === null || deps.business === null || deviceCloudFallbackModelId === null)
      return;
    const preferences = readClientInferencePreferences(deps.session.account.id, deps.business.id);
    saveClientInferencePreferences(deps.session.account.id, deps.business.id, {
      ...preferences,
      cloudConsent: true
    });
    deps.setAgentSettings((current) => ({ ...current, model: deviceCloudFallbackModelId }));
    setDeviceCloudFallbackModelId(null);
    deps.setStatusMessage(
      "The explicitly selected backend model is enabled only as a fallback on this device."
    );
  }

  function declineDeviceCloudFallback() {
    setDeviceCloudFallbackModelId(null);
    const localModelId =
      deps.business === null
        ? "sokoclaw-local"
        : (readDeviceAgentModelAssignment(deps.business.id, getOrCreateDeviceModelScopeId())
            ?.modelId ?? "sokoclaw-local");
    deps.setAgentSettings((current) => ({ ...current, model: localModelId }));
    deps.setStatusMessage(
      "The backend fallback remains off. Downloaded-model-first routing is unchanged."
    );
  }

  deps.registerReset("agent-model", () => {
    setDeviceCloudFallbackModelId(null);
  });

  return {
    deviceCloudFallbackModelId,
    setDeviceCloudFallbackModelId,
    restoreDeviceModelForLaunch,
    findSelectedCloudFallback,
    enableDeviceCloudFallback,
    declineDeviceCloudFallback
  };
}
