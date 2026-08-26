import type { RuntimeAdapter } from "@soko/execution-planner";
import type { InferenceProvider } from "@soko/shared-types";

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §2) - the browser/local
 * RuntimeAdapter. Wraps an ALREADY-EXISTING `InferenceProvider` (the inline browser-webgpu/
 * browser-wasm provider built in apps/web/src/hooks/useChatRuntimeState.ts, which itself wraps
 * `generateBrowserAgentResponse`/the Web Inference Engine backend priority chain) rather than
 * inventing any new execution path. `RuntimeEvent` is `InferenceChunk` verbatim - this adapter
 * does not transform what the provider yields, it only re-shapes the entry point
 * (`canExecute`/`execute` instead of `isAvailable`/`supports`/`generate`) so a planner-produced
 * `ExecutionPlan` can drive it the same way a `BackendRuntimeAdapter`/`CloudRuntimeAdapter` would.
 */
export function createBrowserRuntimeAdapter(provider: InferenceProvider): RuntimeAdapter {
  return {
    async canExecute(plan) {
      if (plan.selected === null || plan.selected.executionTarget !== "local") return false;
      if (!(await provider.isAvailable())) return false;
      return provider.supports(plan.selected.modelId);
    },
    execute(plan, request) {
      if (plan.selected === null) {
        throw new Error("createBrowserRuntimeAdapter.execute called with no selected candidate.");
      }
      return provider.generate({ ...request, modelId: plan.selected.modelId });
    },
    ...(provider.cancel === undefined ? {} : { cancel: provider.cancel.bind(provider) })
  };
}
