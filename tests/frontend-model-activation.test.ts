import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
const styles = readFileSync("apps/web/src/styles.css", "utf8");

describe("frontend model activation contracts", () => {
  it("validates and tests a local model before assigning it through the backend", () => {
    const backendValidation = sourceBetween(
      "async function validateInstalledModelOnBackend",
      "async function useModelWithAgent"
    );
    const activation = sourceBetween(
      "async function useModelWithAgent",
      "async function useBackendModelWithAgent"
    );
    const binding = sourceBetween(
      "async function synchronizeAgentModelAssignment",
      "async function useModelWithAgent"
    );

    expect(backendValidation).toContain("/v1/models/${encodeURIComponent(model.id)}/validate");
    expect(activation).toContain("registerInstalledModel(verified, signal)");
    expect(activation).toContain("validateInstalledModelOnBackend(verified, signal)");
    expect(activation).toContain("await testAgentModelRuntime(getModelRuntime(), verified, {");
    expect(binding).toContain("/businesses/${business.id}/agent-model");
    expect(activation).toContain("inferencePreferences.nativePermission");
    expect(activation).toContain("saveClientInferencePreferences");
    expect(activation).toContain("assignmentAfterReadiness(pending, result)");
    expect(activation).toContain("synchronizeAgentModelAssignment(readyAssignment, signal)");
    expect(activation).toContain("The previous working model was left unchanged");
    expect(application).toContain("new ModelActivationCoordinator()");
    expect(activation).toContain("withActivationTimeout");
    expect(activation).toContain("activationApiReachable");

    expect(activation.indexOf("validateInstalledModelOnBackend(verified, signal)")).toBeLessThan(
      activation.indexOf("await testAgentModelRuntime(getModelRuntime(), verified")
    );
    expect(
      activation.indexOf("await testAgentModelRuntime(getModelRuntime(), verified")
    ).toBeLessThan(activation.indexOf("synchronizeAgentModelAssignment(readyAssignment, signal)"));
  });

  it("sets a cloud fallback without detaching the downloaded model", () => {
    const activation = sourceBetween(
      "async function useBackendModelWithAgent",
      "async function testAssignedModel"
    );

    expect(activation).toContain("await onEnsureRuntimeSession()");
    expect(activation).toContain("/businesses/${business.id}/ai-model");
    expect(activation).toContain("if (activated.modelId !== model.id)");
    expect(activation).toContain("setCloudFallbackModelId(activated.modelId)");
    expect(activation).toContain("hasReadyLocalModel");
    expect(activation).toContain("lastSuccessfulInferenceAt !== null");
    expect(activation).not.toContain("await deleteJson");
    expect(activation).not.toContain("getModelRuntime().unload");
    expect(activation).not.toContain("updateAgent({ model: activated.modelId })");
    expect(activation).not.toContain("onAgentChange({ ...agent, model: activated.modelId })");
    expect(activation).toContain("inferencePreferences.cloudConsent");
    expect(application).toContain('aria-label="Backend models"');
    expect(application).toContain('"Set as fallback"');
    expect(application).toContain('"Default fallback"');
    expect(application).not.toContain('<option value="CLOUD_ONLY">Cloud only</option>');
  });

  it("uses the provider-neutral route in the actual chat send path", () => {
    const chat = sourceBetween(
      "async function sendChatDraft",
      "async function confirmRuntimeAction"
    );

    expect(chat).toContain("decideClientInferenceRoute");
    expect(chat).toContain("executeInferenceRoute");
    expect(chat).toContain('id: "native-llama-cpp"');
    expect(chat).toContain("generateBrowserAgentResponse");
    expect(chat).toContain("createRemoteInferenceProvider");
    expect(chat).toContain('runtime: "cloud-fallback"');
    expect(chat).toContain("readClientInferencePreferences");
    expect(chat).toContain("localInstallation?.modelId");
    expect(chat).toContain("selectedCloudFallback?.modelId");
  });

  it("shows installation-scoped red and green model usage controls", () => {
    expect(application).toContain("agentModelAssignment?.activeModelInstallationId === model.id");
    expect(application).toContain("className={`model-use-button ${");
    expect(application).toContain("aria-pressed={modelInUse}");
    expect(application).toContain('"Not in use · Use model"');
    expect(application).toContain('"In use"');
    expect(styles).toContain(".model-use-button.in-use");
    expect(styles).toContain(".model-use-button {");
  });

  it("loads canonical agent binding state and uses server test and activation APIs", () => {
    expect(application).toContain("/api/agents/${encodeURIComponent(");
    expect(application).toContain(")}/model-binding?shopId=${encodeURIComponent(");
    expect(application).toContain(")}/models/${encodeURIComponent(model.id)}/test");
    expect(application).toContain(")}/models/${encodeURIComponent(model.id)}/activate");
    expect(application).toContain("setActiveAgentModelBinding(result.binding)");
    expect(application).toContain('executionTarget: "backend"');
    expect(application).toContain("Active for ${agent.name}");
    expect(application).toContain("Browser-local inference is unavailable in this deployment");
    expect(application).toContain("<summary>Advanced routing</summary>");
  });
});

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = application.indexOf(startMarker);
  const end = application.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return application.slice(start, end);
}
