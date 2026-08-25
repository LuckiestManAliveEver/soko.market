import type { ModelLifecycleState } from "@soko/shared-types";

import type { LocalAiModel } from "./ai-model-manager";
import type { DeviceAgentModelAssignment } from "./agent-model-assignment";
import type { ModelActivationState } from "./model-activation-state";

export interface ModelLifecycleInput {
  installation: LocalAiModel | null;
  assignment: DeviceAgentModelAssignment | null;
  activationState: ModelActivationState;
  activationMatches: boolean;
  downloading: boolean;
  removing?: boolean;
}

/**
 * The canonical UI projection. It deliberately does not persist transient runtime stages or turn
 * an installed artifact into an active model without a successful device assignment.
 */
export function resolveModelLifecycleState(input: ModelLifecycleInput): ModelLifecycleState {
  if (input.removing === true) return "removing";
  if (input.downloading) return "downloading";
  if (input.installation === null) return "available";
  if (
    input.installation.installationStatus === "CORRUPT" ||
    input.installation.installationStatus === "FAILED" ||
    (input.installation.compatibilityStatus !== "UNKNOWN" &&
      input.installation.compatibilityStatus !== "COMPATIBLE")
  ) {
    return "incompatible";
  }
  if (input.activationMatches) {
    switch (input.activationState) {
      case "validating":
        return "verifying";
      case "creating_runtime":
      case "loading_model":
        return "loading_runtime";
      case "binding_agent":
        return "activating";
      case "failed":
      case "offline_blocked":
        return "activation_failed";
      case "active":
        return "active";
      case "idle":
        break;
    }
  }
  if (
    input.assignment?.activeModelInstallationId === input.installation.id &&
    input.assignment.readinessStatus === "READY" &&
    input.assignment.lastSuccessfulInferenceAt !== null
  ) {
    return "active";
  }
  if (
    input.assignment?.activeModelInstallationId === input.installation.id &&
    input.assignment.readinessStatus === "FAILED"
  ) {
    return "activation_failed";
  }
  return "installed";
}

export function modelLifecycleActionLabel(state: ModelLifecycleState): string {
  const labels: Record<ModelLifecycleState, string> = {
    available: "Predownload & install",
    downloading: "Downloading…",
    verifying: "Checking model…",
    installed: "Use with agent",
    loading_runtime: "Starting…",
    activating: "Connecting…",
    active: "Active",
    activation_failed: "Retry activation",
    incompatible: "Not supported on this device",
    removing: "Removing…"
  };
  return labels[state];
}
