import { describe, expect, it } from "vitest";

import type { LocalAiModel } from "../apps/web/src/ai-model-manager";
import type { DeviceAgentModelAssignment } from "../apps/web/src/agent-model-assignment";
import {
  modelLifecycleActionLabel,
  resolveModelLifecycleState
} from "../apps/web/src/model-lifecycle";

const installation = {
  id: "install-qwen",
  modelId: "qwen",
  installationStatus: "INSTALLED",
  compatibilityStatus: "COMPATIBLE"
} as LocalAiModel;

const assignment = {
  activeModelInstallationId: installation.id,
  readinessStatus: "READY",
  lastSuccessfulInferenceAt: "2026-08-25T12:00:00.000Z"
} as DeviceAgentModelAssignment;

describe("canonical model lifecycle projection", () => {
  it("never conflates an installed artifact with an active runtime", () => {
    expect(
      resolveModelLifecycleState({
        installation,
        assignment: null,
        activationState: "idle",
        activationMatches: false,
        downloading: false
      })
    ).toBe("installed");
    expect(modelLifecycleActionLabel("installed")).toBe("Use with agent");
  });

  it("reports active only for a readiness-verified assignment", () => {
    expect(
      resolveModelLifecycleState({
        installation,
        assignment,
        activationState: "idle",
        activationMatches: false,
        downloading: false
      })
    ).toBe("active");
  });

  it.each([
    ["validating", "verifying"],
    ["creating_runtime", "loading_runtime"],
    ["loading_model", "loading_runtime"],
    ["binding_agent", "activating"],
    ["failed", "activation_failed"]
  ] as const)("maps %s activation to %s", (activationState, expected) => {
    expect(
      resolveModelLifecycleState({
        installation,
        assignment: null,
        activationState,
        activationMatches: true,
        downloading: false
      })
    ).toBe(expected);
  });

  it("reports incompatible durable records without considering transient state", () => {
    expect(
      resolveModelLifecycleState({
        installation: { ...installation, compatibilityStatus: "INCOMPATIBLE" },
        assignment,
        activationState: "active",
        activationMatches: true,
        downloading: false
      })
    ).toBe("incompatible");
  });
});
