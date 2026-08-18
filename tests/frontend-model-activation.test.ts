import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatState = readFileSync("apps/web/src/hooks/useChatState.ts", "utf8");
const agentProfileSurface = readFileSync("apps/web/src/AgentProfileSurface.tsx", "utf8");
const sharedModule = readFileSync("apps/web/src/soko-application-shared.ts", "utf8");
const styles = readFileSync("apps/web/src/styles.css", "utf8");

describe("frontend model activation contracts", () => {
  it("validates and tests a local model before assigning it through the backend", () => {
    const backendValidation = sourceBetween(
      agentProfileSurface,
      "async function validateInstalledModelOnBackend",
      "async function useModelWithAgent"
    );
    const activation = sourceBetween(
      agentProfileSurface,
      "async function useModelWithAgent",
      "async function useBackendModelWithAgent"
    );
    const binding = sourceBetween(
      agentProfileSurface,
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
    expect(agentProfileSurface).toContain("new ModelActivationCoordinator()");
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
      agentProfileSurface,
      "async function useBackendModelWithAgent",
      "async function testServerBackendModel"
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
    expect(agentProfileSurface).toContain('aria-label="Cloud fallback models"');
    expect(agentProfileSurface).toContain('"Set as fallback"');
    expect(agentProfileSurface).toContain('"Default fallback"');
    expect(agentProfileSurface).not.toContain('<option value="CLOUD_ONLY">Cloud only</option>');
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
    expect(chat).toContain("createAdaptiveAgentModelRuntime");
    expect(chat).toContain("clientInferenceCompletion");
    expect(chat).toContain("availableRuntimeTools");
    expect(chat).toContain("generateBrowserAgentResponse");
    expect(chat).toContain("createRemoteInferenceProvider");
    expect(chat).toContain('runtime: "cloud-fallback"');
    expect(chat).toContain("readClientInferencePreferences");
    expect(chat).toContain("localInstallation?.modelId");
    expect(chat).toContain("selectedCloudFallback?.modelId");
    expect(chat).toContain("const canonicalRuntimeAgentId = business?.id ?? null");
    expect(chat).toContain("agentId: canonicalRuntimeAgentId ?? business.id");
    expect(chat).not.toContain("agentId: agentSettings.globalAgentId");
    expect(chat).not.toContain("&& !requiresServerTool");
  });

  it("shows installation-scoped red and green model usage controls", () => {
    expect(agentProfileSurface).toContain(
      "agentModelAssignment?.activeModelInstallationId === model.id"
    );
    expect(agentProfileSurface).toContain("className={`model-use-button ${");
    expect(agentProfileSurface).toContain("aria-pressed={modelInUse}");
    expect(agentProfileSurface).toContain('"Not active · Activate on this device"');
    expect(agentProfileSurface).toContain('"Active on this device"');
    expect(agentProfileSurface).toContain("It is separate from the persisted backend");
    expect(styles).toContain(".model-use-button.in-use");
    expect(styles).toContain(".model-use-button {");
  });

  it("loads canonical agent binding state and uses server test and activation APIs", () => {
    const profile = sourceBetween(
      agentProfileSurface,
      "function AgentProfileSurface",
      "function editFirstContextPhrase"
    );
    const models = sourceBetween(
      agentProfileSurface,
      "async function loadAiModels",
      "async function loadGitHubModels"
    );
    const binding = sourceBetween(
      agentProfileSurface,
      "async function loadCanonicalAgentModelBinding",
      "async function registerInstalledModel"
    );
    const serverActivation = sourceBetween(
      agentProfileSurface,
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
    expect(agentProfileSurface).toContain("/api/agents/${encodeURIComponent(");
    expect(agentProfileSurface).toContain(")}/model-binding?shopId=${encodeURIComponent(");
    expect(agentProfileSurface).toContain(")}/models/${encodeURIComponent(model.id)}/test");
    expect(agentProfileSurface).toContain(")}/models/${encodeURIComponent(model.id)}/activate");
    expect(sharedModule).toContain("backendModelProbeRequestTimeoutMs = 105_000");
    expect(serverActivation).toContain("timeoutMs: backendModelProbeRequestTimeoutMs");
    expect(serverActivation).toContain("setTestingBackendModelId(model.id)");
    expect(agentProfileSurface).toContain(
      'testingBackendModelId === model.id ? "Testing…" : "Test model"'
    );
    expect(agentProfileSurface).toContain(
      ")}/model-binding?shopId=${encodeURIComponent(business.id)}"
    );
    expect(agentProfileSurface).toContain("setActiveAgentModelBinding(result.binding)");
    expect(agentProfileSurface).toContain("removeServerBackendModelFromAgent(model)");
    expect(agentProfileSurface).toContain('"Remove from agent"');
    expect(agentProfileSurface).toContain('executionTarget: "backend"');
    expect(agentProfileSurface).toContain("Active for ${agent.name}");
    expect(agentProfileSurface).toContain(
      "Browser-local inference is unavailable in this deployment"
    );
    expect(agentProfileSurface).toContain("<summary>Advanced routing</summary>");
  });
});

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}
