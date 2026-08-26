import type { AiModelSummary, RuntimeModelDefinition } from "@soko/shared-types";
import type { ModelRegistryConflict, ModelRegistryReconciliation, ReconciledModel } from "./types.js";

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §1). For the 3 confirmed conflicting
 * ids (and any future ones this reconciliation finds), the two registries disagree about WHERE a
 * model actually runs - `aiModelRegistry` calls it a downloadable on-device GGUF ("local"),
 * `runtimeModels` calls it a server-hosted model ("backend"). Something has to win so the planner
 * can generate one, unambiguous candidate for that model id; this single named constant is that
 * decision, made once, in one place, so a future decision can flip it without touching any other
 * line of reconciliation logic. Default: trust `runtimeModels`, the server-verified registry that
 * the operator actually deploys and controls, over `aiModelRegistry`'s on-device self-declaration
 * (a value the app itself declares about a file a user downloaded, not independently verified).
 */
export const EXECUTION_TARGET_CONFLICT_TIEBREAK: "trust-runtimeModels" | "trust-aiModelRegistry" =
  "trust-runtimeModels";

/**
 * Thin, pure reconciliation over the two registries the Phase 0 audit found disagree
 * (docs/architecture/soko-execution-fabric-audit.md §2/§6): `aiModelRegistry`
 * (services/api/src/cp2/domains/agent-runtime/model-catalog.ts, an array) and `runtimeModels`
 * (packages/shared-types, a keyed object). This function takes both as plain arrays - the actual
 * data sources are read by the thin server-side adapter in
 * services/api/src/cp2/domains/execution-fabric/registry-adapter.ts, which is the only place that
 * imports the real registries; this function itself has no knowledge of where the arrays came
 * from and does no I/O.
 *
 * Reconciliation does NOT merge or migrate either underlying table/constant (explicitly out of
 * scope for this phase) - it only builds a read-side view for the planner, and reports conflicts
 * rather than silently picking a side.
 *
 * A model present in only one source resolves correctly with no conflict (its own `sources` array
 * has exactly one entry). A genuine conflict - the two sources disagree about the SAME id, not
 * merely one having a field the other lacks - is recorded in `conflicts` and does not block the
 * model from appearing in `models` (the planner still needs to be able to consider it); the
 * conflict list is for the operator to review, not resolved automatically. Confirmed by direct
 * inspection: every one of the three ids present in both registries today
 * (qwen2.5-0.5b-android, qwen2.5-1.5b-android, smollm2-360m-android) produces a real
 * `executionTarget` conflict - `aiModelRegistry` declares each as `provider: "local"`
 * (a downloadable on-device GGUF file), while `runtimeModels` declares the exact same id as
 * `provider: "ollama"`/`executionTarget: "backend"` (a server-hosted model) - see the phase 1
 * report for the worked example.
 */
export function reconcileModelRegistries(
  aiModels: readonly AiModelSummary[],
  runtimeModelDefinitions: readonly RuntimeModelDefinition[]
): ModelRegistryReconciliation {
  const aiById = new Map(aiModels.map((model) => [model.id, model]));
  const runtimeById = new Map(runtimeModelDefinitions.map((model) => [model.id, model]));
  const allIds = [...new Set([...aiById.keys(), ...runtimeById.keys()])].sort();

  const models: ReconciledModel[] = [];
  const conflicts: ModelRegistryConflict[] = [];

  for (const id of allIds) {
    const aiModel = aiById.get(id);
    const runtimeModel = runtimeById.get(id);

    if (aiModel !== undefined && runtimeModel === undefined) {
      models.push(reconciledFromAiModel(aiModel));
      continue;
    }
    if (aiModel === undefined && runtimeModel !== undefined) {
      models.push(reconciledFromRuntimeModel(runtimeModel));
      continue;
    }
    if (aiModel === undefined || runtimeModel === undefined) continue; // unreachable, narrows types

    const aiExecutionTarget = executionTargetFromAiModel(aiModel);
    const runtimeExecutionTarget: ReconciledModel["executionTarget"] = "backend";
    if (aiExecutionTarget !== runtimeExecutionTarget) {
      conflicts.push({
        modelId: id,
        field: "executionTarget",
        aiModelRegistryValue: aiExecutionTarget,
        runtimeModelsValue: runtimeExecutionTarget
      });
    }
    if (aiModel.contextWindow !== null && aiModel.contextWindow !== runtimeModel.contextWindow) {
      conflicts.push({
        modelId: id,
        field: "contextWindow",
        aiModelRegistryValue: aiModel.contextWindow,
        runtimeModelsValue: runtimeModel.contextWindow
      });
    }
    if (aiModel.available !== runtimeModel.enabled) {
      conflicts.push({
        modelId: id,
        field: "availability",
        aiModelRegistryValue: aiModel.available,
        runtimeModelsValue: runtimeModel.enabled
      });
    }

    // Both sources agree the id exists. Metadata (label/capabilities/contextWindow/minimumMemoryGb)
    // is always taken from the richer aiModelRegistry entry regardless of the tiebreak - it already
    // carries capabilities and a non-null context window for every pinned entry, and the tiebreak
    // exists only to resolve the `executionTarget` disagreement itself, not to pick a metadata
    // source wholesale. `sources` always lists both so a conflict-aware caller can tell this id
    // wasn't a clean single-source match, even though the conflict is already resolved here.
    models.push({
      ...reconciledFromAiModel(aiModel),
      executionTarget:
        EXECUTION_TARGET_CONFLICT_TIEBREAK === "trust-runtimeModels"
          ? runtimeExecutionTarget
          : aiExecutionTarget,
      sources: ["aiModelRegistry", "runtimeModels"]
    });
  }

  return { models, conflicts };
}

function reconciledFromAiModel(model: AiModelSummary): ReconciledModel {
  return {
    id: model.id,
    label: model.label,
    executionTarget: executionTargetFromAiModel(model),
    capabilities: model.capabilities,
    contextWindow: model.contextWindow,
    minimumMemoryGb: model.minimumMemoryGb,
    sources: ["aiModelRegistry"]
  };
}

function executionTargetFromAiModel(model: AiModelSummary): ReconciledModel["executionTarget"] {
  if (model.provider === "openai") return "cloud";
  return "local";
}

function reconciledFromRuntimeModel(model: RuntimeModelDefinition): ReconciledModel {
  return {
    id: model.id,
    label: model.displayName,
    executionTarget: "backend",
    capabilities: [],
    contextWindow: model.contextWindow,
    minimumMemoryGb: null,
    sources: ["runtimeModels"]
  };
}
