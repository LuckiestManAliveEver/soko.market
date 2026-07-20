import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");

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

    expect(backendValidation).toContain("/v1/models/${encodeURIComponent(model.id)}/validate");
    expect(activation).toContain("await registerInstalledModel(verified)");
    expect(activation).toContain("await validateInstalledModelOnBackend(verified)");
    expect(activation).toContain("await testAgentModelRuntime(getModelRuntime(), verified)");
    expect(activation).toContain("/businesses/${business.id}/agent-model");
    expect(activation).toContain("inferencePreferences.nativePermission");

    expect(activation.indexOf("await validateInstalledModelOnBackend(verified)")).toBeLessThan(
      activation.indexOf("await testAgentModelRuntime(getModelRuntime(), verified)")
    );
    expect(
      activation.indexOf("await testAgentModelRuntime(getModelRuntime(), verified)")
    ).toBeLessThan(activation.indexOf("/businesses/${business.id}/agent-model"));
  });

  it("activates configured backend models and reflects only confirmed selections", () => {
    const activation = sourceBetween(
      "async function useBackendModelWithAgent",
      "async function testAssignedModel"
    );

    expect(activation).toContain("await onEnsureRuntimeSession()");
    expect(activation).toContain("/businesses/${business.id}/ai-model");
    expect(activation).toContain("if (activated.modelId !== model.id)");
    expect(activation).toContain("setActiveAiModelId(activated.modelId)");
    expect(activation).toContain("inferencePreferences.cloudConsent");
    expect(application).toContain('aria-label="Backend models"');
    expect(application).toContain('"Use model"');
    expect(application).toContain('"Model in use"');
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
  });
});

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = application.indexOf(startMarker);
  const end = application.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return application.slice(start, end);
}
