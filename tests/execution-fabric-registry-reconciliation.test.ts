import { describe, expect, it } from "vitest";
import type { AiModelSummary, RuntimeModelDefinition } from "../packages/shared-types/src";
import { reconcileModelRegistries } from "../packages/execution-planner/src/index";
import { reconcileLiveModelRegistries } from "../services/api/src/cp2/domains/execution-fabric/registry-adapter";
import { aiModelRegistry } from "../services/api/src/cp2/domains/agent-runtime/model-catalog";
import { runtimeModels } from "../packages/shared-types/src/index";

function aiModel(overrides: Partial<AiModelSummary> = {}): AiModelSummary {
  return {
    id: "shared-id",
    label: "Test Model",
    provider: "local",
    description: "",
    capabilities: ["chat"],
    available: true,
    source: "huggingface",
    format: "GGUF",
    license: "Apache-2.0",
    licenseUrl: null,
    modelCardUrl: null,
    downloadUrl: null,
    fileName: null,
    fileSizeBytes: null,
    minimumMemoryGb: 2,
    recommended: false,
    contextWindow: 8_192,
    ...overrides
  };
}

function runtimeModel(overrides: Partial<RuntimeModelDefinition> = {}): RuntimeModelDefinition {
  return {
    id: "shared-id",
    displayName: "Test Model",
    provider: "ollama",
    providerModelId: "test:model",
    executionTarget: "backend",
    deploymentTarget: "render-private-inference",
    contextWindow: 8_192,
    enabled: true,
    ...overrides
  };
}

describe("model registry reconciliation - synthetic data", () => {
  it("resolves a model present only in aiModelRegistry with a single source", () => {
    const { models, conflicts } = reconcileModelRegistries([aiModel({ id: "local-only" })], []);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: "local-only", sources: ["aiModelRegistry"] });
    expect(conflicts).toEqual([]);
  });

  it("resolves a model present only in runtimeModels with a single source", () => {
    const { models, conflicts } = reconcileModelRegistries(
      [],
      [runtimeModel({ id: "backend-only" })]
    );
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "backend-only",
      sources: ["runtimeModels"],
      executionTarget: "backend"
    });
    expect(conflicts).toEqual([]);
  });

  it("surfaces a genuine executionTarget conflict rather than silently picking a side", () => {
    const { models, conflicts } = reconcileModelRegistries(
      [aiModel({ id: "disputed", provider: "local" })],
      [runtimeModel({ id: "disputed", executionTarget: "backend" })]
    );
    expect(models).toHaveLength(1); // still resolves - conflicts don't block the model existing
    expect(models[0]!.sources).toEqual(["aiModelRegistry", "runtimeModels"]);
    const conflict = conflicts.find((entry) => entry.field === "executionTarget");
    expect(conflict).toMatchObject({
      modelId: "disputed",
      aiModelRegistryValue: "local",
      runtimeModelsValue: "backend"
    });
  });

  it("surfaces a genuine contextWindow conflict when the two sources actually disagree", () => {
    const { conflicts } = reconcileModelRegistries(
      [aiModel({ id: "window-mismatch", contextWindow: 4_096 })],
      [runtimeModel({ id: "window-mismatch", contextWindow: 32_768 })]
    );
    const conflict = conflicts.find((entry) => entry.field === "contextWindow");
    expect(conflict).toMatchObject({
      modelId: "window-mismatch",
      aiModelRegistryValue: 4_096,
      runtimeModelsValue: 32_768
    });
  });

  it("does not report a conflict for a mere gap (one source has a field, the other has nothing to compare)", () => {
    // aiModelRegistry's contextWindow is null (genuinely unknowable, e.g. sokoclaw-local) - this
    // must not be treated as "disagrees with runtimeModels' declared window".
    const { conflicts } = reconcileModelRegistries(
      [aiModel({ id: "unknowable-window", contextWindow: null })],
      [runtimeModel({ id: "unknowable-window", contextWindow: 32_768 })]
    );
    expect(conflicts.some((entry) => entry.field === "contextWindow")).toBe(false);
  });

  it("surfaces an availability conflict when one source enables a model the other does not", () => {
    const { conflicts } = reconcileModelRegistries(
      [aiModel({ id: "availability-mismatch", available: true })],
      [runtimeModel({ id: "availability-mismatch", enabled: false })]
    );
    const conflict = conflicts.find((entry) => entry.field === "availability");
    expect(conflict).toMatchObject({
      modelId: "availability-mismatch",
      aiModelRegistryValue: true,
      runtimeModelsValue: false
    });
  });

  it("is deterministic - identical input always reconciles to the same result", () => {
    const inputs: [AiModelSummary[], RuntimeModelDefinition[]] = [
      [aiModel({ id: "a" }), aiModel({ id: "b", provider: "openai" })],
      [runtimeModel({ id: "a", executionTarget: "backend" })]
    ];
    const first = reconcileModelRegistries(...inputs);
    const second = reconcileModelRegistries(...inputs);
    expect(first).toEqual(second);
  });
});

describe("model registry reconciliation - real registries", () => {
  it("reconciles the actual live aiModelRegistry and runtimeModels without throwing", () => {
    const { models, conflicts } = reconcileLiveModelRegistries();
    expect(models.length).toBeGreaterThan(0);
    // Every id declared in runtimeModels must resolve to a reconciled model.
    for (const runtimeModelId of Object.keys(runtimeModels)) {
      expect(models.some((model) => model.id === runtimeModelId)).toBe(true);
    }
    // Every id in aiModelRegistry must resolve too.
    for (const model of aiModelRegistry) {
      expect(models.some((reconciled) => reconciled.id === model.id)).toBe(true);
    }
    expect(Array.isArray(conflicts)).toBe(true);
  });

  it("confirms the three ids shared by both live registries produce a real executionTarget conflict", () => {
    // Ground truth from the Phase 0 audit: aiModelRegistry declares these as provider: "local"
    // (a downloadable on-device GGUF), while runtimeModels declares the exact same three ids as
    // provider: "ollama" / executionTarget: "backend" (a server-hosted model). This test would
    // fail (and should) the moment either registry is edited to actually agree.
    const sharedIds = ["qwen2.5-0.5b-android", "qwen2.5-1.5b-android", "smollm2-360m-android"];
    const { conflicts } = reconcileLiveModelRegistries();
    for (const id of sharedIds) {
      expect(aiModelRegistry.some((model) => model.id === id)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(runtimeModels, id)).toBe(true);
      const conflict = conflicts.find(
        (entry) => entry.modelId === id && entry.field === "executionTarget"
      );
      expect(conflict).toMatchObject({ aiModelRegistryValue: "local", runtimeModelsValue: "backend" });
    }
  });
});
