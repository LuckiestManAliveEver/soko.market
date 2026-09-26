import type { InferenceProvider, ModelDefinition } from "./contract.js";
import { isClientExecutedTarget } from "./contract.js";
import { InferenceError } from "./errors.js";
import type { InferenceProviderConfig } from "./provider-config.js";

/**
 * Server-side stand-in for browser/device-local models. It exists so a local model is a normal,
 * registry-described model the router can resolve and report on - but the server never executes
 * it and never forwards it anywhere: generate() always refuses with LOCAL_EXECUTION_REQUIRED
 * (non-retryable, so no runtime fallback loop picks a cloud model instead). Execution happens on
 * the client through the existing opt-in offline runtime (apps/web/src/webllm-runtime.ts), which
 * returns the same normalized shape via apps/web/src/inference/local-inference-response.ts.
 */
export function createLocalInferenceProvider(config: InferenceProviderConfig): InferenceProvider {
  return {
    id: config.id,
    async supports(model: ModelDefinition) {
      return (
        config.enabled &&
        model.enabled &&
        model.providerId === config.id &&
        isClientExecutedTarget(model.executionTarget)
      );
    },
    async health() {
      return {
        providerId: config.id,
        status: config.enabled ? "AVAILABLE" : "UNAVAILABLE",
        checkedAt: new Date().toISOString(),
        message: "Runs on the user's device; availability is decided by the client."
      };
    },
    async generate(request) {
      throw new InferenceError("LOCAL_EXECUTION_REQUIRED", {
        providerId: config.id,
        modelId: request.modelId
      });
    }
  };
}
