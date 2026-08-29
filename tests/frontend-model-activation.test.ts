import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatState = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");
const agentModelPanel = readFileSync("apps/web/src/AgentModelPanel.tsx", "utf8");
const sharedModule = readFileSync("apps/web/src/soko-application-shared.ts", "utf8");
const agentProfileSurface = readFileSync("apps/web/src/AgentProfileSurface.tsx", "utf8");
const agentIdentityPanel = readFileSync("apps/web/src/AgentIdentityPanel.tsx", "utf8");
const ossSelectionState = readFileSync("apps/web/src/hooks/useOssAgentSelectionState.ts", "utf8");
const styles = readFileSync("apps/web/src/styles.css", "utf8");

describe("frontend model activation contracts", () => {
  it("validates and tests a local model before assigning it through the backend", () => {
    const backendValidation = sourceBetween(
      agentModelPanel,
      "async function validateInstalledModelOnBackend",
      "async function useModelWithAgent"
    );
    const activation = sourceBetween(
      agentModelPanel,
      "async function useModelWithAgent",
      "async function testServerBackendModel"
    );
    const binding = sourceBetween(
      agentModelPanel,
      "async function synchronizeAgentModelAssignment",
      "async function activationApiReachable"
    );

    expect(backendValidation).toContain("/v1/models/${encodeURIComponent(model.id)}/validate");
    expect(activation).toContain("registerInstalledModel(verified, signal)");
    expect(activation).toContain("validateInstalledModelOnBackend(verified, signal)");
    expect(activation).toContain("testAgentModelRuntime(getModelRuntime(), verified, {");
    expect(binding).toContain("/businesses/${business.id}/agent-model");
    expect(activation).toContain("inferencePreferences.nativePermission");
    expect(activation).toContain("saveClientInferencePreferences");
    expect(activation).toContain("assignmentAfterReadiness(pending, result)");
    expect(activation).toContain("synchronizeAgentModelAssignment(readyAssignment, signal)");
    expect(activation).toContain("The previous working model was left unchanged");
    expect(agentModelPanel).toContain("new ModelActivationCoordinator()");
    expect(activation).toContain("withActivationTimeout");
    expect(activation).toContain("activationApiReachable");

    expect(activation.indexOf("validateInstalledModelOnBackend(verified, signal)")).toBeLessThan(
      activation.indexOf("testAgentModelRuntime(getModelRuntime(), verified")
    );
    expect(activation.indexOf("testAgentModelRuntime(getModelRuntime(), verified")).toBeLessThan(
      activation.indexOf("synchronizeAgentModelAssignment(readyAssignment, signal)")
    );
  });

  it("never reintroduces the removed automatic local-to-cloud escalation UI", () => {
    expect(agentModelPanel).not.toContain("useBackendModelWithAgent");
    expect(agentModelPanel).not.toContain("cloudFallbackModelId");
    expect(agentModelPanel).not.toContain("inferencePreferences.cloudConsent");
    expect(agentModelPanel).not.toContain('aria-label="Backend fallback models"');
    expect(agentModelPanel).not.toContain('"Set as fallback"');
    expect(agentModelPanel).not.toContain('"Default fallback"');
    expect(agentModelPanel).not.toContain('<option value="CLOUD_ONLY">Cloud only</option>');
    expect(agentModelPanel).not.toContain("fallbackPolicy");
  });

  it("keeps logical agent and model choice independent from the current device", () => {
    expect(agentProfileSurface).not.toContain(
      "Install ${selectedCatalogModel.label} on this phone"
    );
    expect(agentProfileSurface).not.toContain("linkInstalledOssAgent");
    expect(ossSelectionState).not.toContain("readDeviceOssAgentBinding");
    expect(ossSelectionState).not.toContain("inspectDeviceModelCapability");
    expect(agentIdentityPanel).toContain("Device independent");
    expect(agentIdentityPanel).toContain("same logical agent on every signed-in device");
  });

  it("uses the provider-neutral route in the actual chat send path", () => {
    const chat = sourceBetween(
      chatState,
      "async function sendChatDraft",
      "async function confirmRuntimeAction"
    );

    expect(chat).toContain("decideClientInferenceRoute");
    expect(chat).toContain("executeInferenceRoute");
    expect(chat).toContain('("native-llama-cpp" as const)');
    expect(chat).toContain('("browser-wasm" as const)');
    expect(chat).toContain("getSharedAgentModelRuntime");
    expect(chat).toContain("clientInferenceCompletion");
    expect(chat).toContain("availableRuntimeTools");
    expect(chat).toContain("generateBrowserAgentResponse");
    expect(chat).toContain("createRemoteInferenceProvider");
    expect(chat).toContain("readClientInferencePreferences");
    expect(chat).toContain("localInstallation?.modelId");
    expect(chat).toContain("const canonicalRuntimeAgentId = business?.id ?? null");
    expect(chat).toContain("agentId: canonicalRuntimeAgentId ?? business.id");
    expect(chat).not.toContain("agentId: agentSettings.globalAgentId");
    expect(chat).not.toContain("&& !requiresServerTool");
  });

  it("shows installation-scoped red and green model usage controls", () => {
    expect(agentModelPanel).toContain(
      "agentModelAssignment?.activeModelInstallationId === model.id"
    );
    expect(agentModelPanel).toContain("className={`model-use-button ${");
    expect(agentModelPanel).toContain("aria-pressed={modelInUse}");
    expect(agentModelPanel).toContain("resolveModelLifecycleState");
    expect(agentModelPanel).toContain("modelLifecycleActionLabel(lifecycleState)");
    expect(agentModelPanel).toContain("It is separate from the persisted backend");
    expect(styles).toContain(".model-use-button.in-use");
    expect(styles).toContain(".model-use-button {");
  });

  it("loads canonical agent binding state and uses server test and activation APIs", () => {
    const profile = sourceBetween(
      agentModelPanel,
      "function AgentModelPanel",
      "const bestFitModels ="
    );
    const models = sourceBetween(
      agentModelPanel,
      "async function loadAiModels",
      "async function loadGitHubModels"
    );
    const binding = sourceBetween(
      agentModelPanel,
      "async function loadCanonicalAgentModelBinding",
      "async function validateInstalledModelOnBackend"
    );
    const serverActivation = sourceBetween(
      agentModelPanel,
      "async function testServerBackendModel",
      "async function testAssignedModel"
    );

    expect(profile).toContain("const canonicalRuntimeAgentId = business.id");
    expect(models).toContain("canonicalRuntimeAgentId");
    expect(models).not.toContain("agent.globalAgentId");
    expect(binding).toContain("canonicalRuntimeAgentId");
    expect(binding).not.toContain("agent.globalAgentId");
    expect(serverActivation).toContain("canonicalRuntimeAgentId");
    expect(serverActivation).not.toContain("agent.globalAgentId");
    expect(agentModelPanel).toContain("/api/agents/${encodeURIComponent(");
    expect(agentModelPanel).toContain(")}/model-binding?shopId=${encodeURIComponent(");
    expect(agentModelPanel).toContain(")}/models/${encodeURIComponent(model.id)}/test");
    expect(agentModelPanel).toContain(")}/models/${encodeURIComponent(model.id)}/activate");
    expect(sharedModule).toContain("backendModelProbeRequestTimeoutMs = 105_000");
    expect(serverActivation).toContain("timeoutMs: backendModelProbeRequestTimeoutMs");
    expect(serverActivation).toContain("setTestingBackendModelId(model.id)");
    expect(agentModelPanel).toContain(
      'testingBackendModelId === model.id ? "Testing…" : "Test model"'
    );
    expect(agentModelPanel).toContain(")}/model-binding?shopId=${encodeURIComponent(business.id)}");
    expect(agentModelPanel).toContain("setActiveAgentModelBinding(result.binding)");
    expect(agentModelPanel).toContain("removeServerBackendModelFromAgent(model)");
    expect(agentModelPanel).toContain('"Remove from agent"');
    expect(agentModelPanel).toContain('executionTarget: "backend"');
    expect(agentModelPanel).toContain("Active for ${agent.name}");
    expect(agentModelPanel).toContain("Browser-local inference is unavailable in this deployment");
    expect(agentModelPanel).toContain("<summary>Advanced routing</summary>");
  });

  it("locks removeModelFromAgent behind the shared busy flag so concurrent clicks can't race", () => {
    const removal = sourceBetween(
      agentModelPanel,
      "async function removeModelFromAgent",
      "async function updateAgentModelPolicy"
    );

    expect(removal).toContain("if (modelRuntimeBusyRef.current) return;");
    expect(removal).toContain("modelRuntimeBusyRef.current = true;");
    expect(removal).toContain("setModelRuntimeBusy(true);");
    expect(removal).toContain("modelRuntimeBusyRef.current = false;");
    expect(removal).toContain("setModelRuntimeBusy(false);");
    expect(removal.indexOf("modelRuntimeBusyRef.current = true;")).toBeLessThan(
      removal.indexOf("await deleteJson(")
    );
    expect(removal.indexOf("await deleteJson(")).toBeLessThan(
      removal.indexOf("modelRuntimeBusyRef.current = false;")
    );
  });

  it("skips a superseded activation's stale unload when a fresh attempt re-claimed the same model", () => {
    const activation = sourceBetween(
      agentModelPanel,
      "async function useModelWithAgent",
      "async function testServerBackendModel"
    );

    expect(activation).toContain("modelActivationCoordinator.current.activeModelId() === model.id");
    expect(activation).toContain("if (!supersededBySameModel) {");
    expect(activation.indexOf("supersededBySameModel")).toBeLessThan(
      activation.indexOf("void getModelRuntime().unload(model.id);")
    );
  });
});

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}
