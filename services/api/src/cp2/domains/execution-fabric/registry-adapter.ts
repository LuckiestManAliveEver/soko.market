import { runtimeModels } from "@soko/shared-types";
import { reconcileModelRegistries, type ModelRegistryReconciliation } from "@soko/execution-planner";

import { aiModelRegistry } from "../agent-runtime/model-catalog.js";

/**
 * The only file in the repository that feeds the two real model registries the Phase 0 audit
 * found (docs/architecture/soko-execution-fabric-audit.md §2) into the pure reconciliation
 * function in @soko/execution-planner. `aiModelRegistry`
 * (services/api/src/cp2/domains/agent-runtime/model-catalog.ts) is already a live export used
 * throughout the agent-runtime domain; `runtimeModels` (packages/shared-types) is a keyed object,
 * so it is converted to an array here before reconciliation - the pure function itself has no
 * opinion about either source's original shape.
 *
 * Not called by any live route or Cp2Store method in this phase - see
 * docs/architecture/agent-execution-fabric-phase1.md for why this stays a standalone read-side
 * view rather than being wired into chat/inference.
 */
export function reconcileLiveModelRegistries(): ModelRegistryReconciliation {
  return reconcileModelRegistries(aiModelRegistry, Object.values(runtimeModels));
}
