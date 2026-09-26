import type { DeviceInferenceBroker } from "../device-inference-broker.js";
import type { InferenceProvider, ModelDefinition } from "./contract.js";
import { isClientExecutedTarget, messageText } from "./contract.js";
import { InferenceError } from "./errors.js";
import type { InferenceProviderConfig } from "./provider-config.js";

/**
 * Device-local models (browser-local / installed-app). The server never runs them and never sends
 * them to a cloud provider: generate() hands the already-built prompt to the requesting member's
 * own device through the DeviceInferenceBroker and waits for that device's output
 * (ADR-explicit-device-local-models.md). Without a broker, or without an identified member (a
 * public storefront visitor, an MCP token with no account), it refuses with
 * LOCAL_EXECUTION_REQUIRED.
 */
export function createLocalInferenceProvider(
  config: InferenceProviderConfig,
  deps: { broker?: DeviceInferenceBroker; now?: () => number } = {}
): InferenceProvider {
  const now = deps.now ?? Date.now;
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
        checkedAt: new Date(now()).toISOString(),
        message: "Runs on the member's own device; each device reports its own availability."
      };
    },
    async generate(request, context) {
      const userId = context.caller?.userId ?? null;
      if (deps.broker === undefined || userId === null) {
        throw new InferenceError("LOCAL_EXECUTION_REQUIRED", {
          providerId: config.id,
          modelId: request.modelId
        });
      }
      const target = context.model.executionTarget;
      if (target !== "browser-local" && target !== "installed-app") {
        throw new InferenceError("LOCAL_EXECUTION_REQUIRED", {
          providerId: config.id,
          modelId: request.modelId
        });
      }
      const startedAt = now();
      const outcome = await deps.broker.dispatch({
        accountId: userId,
        turnId: context.caller?.turnId ?? null,
        modelId: context.model.id,
        providerModelId: context.model.providerModelId,
        executionTarget: target,
        messages: request.messages.map((message) => ({
          // On-device models get the same prompt; tool results (unused here) are folded into user turns.
          role: message.role === "tool" ? "user" : message.role,
          content: messageText(message.content)
        })),
        generation: {
          maxOutputTokens: request.generation?.maxOutputTokens ?? 512,
          temperature: request.generation?.temperature ?? 0.2,
          jsonOutput: request.responseFormat !== undefined && request.responseFormat.type !== "text"
        },
        ...(context.signal === undefined ? {} : { signal: context.signal })
      });
      return {
        requestId: request.requestId,
        providerId: config.id,
        modelId: request.modelId,
        output: { text: outcome.text, toolCalls: [] },
        finishReason: "stop",
        ...(outcome.usage === undefined
          ? {}
          : {
              usage: {
                ...outcome.usage,
                ...(outcome.usage.inputTokens !== undefined &&
                outcome.usage.outputTokens !== undefined
                  ? { totalTokens: outcome.usage.inputTokens + outcome.usage.outputTokens }
                  : {})
              }
            }),
        latency: {
          totalMs: outcome.latencyMs ?? now() - startedAt,
          ...(outcome.firstTokenMs === undefined ? {} : { firstTokenMs: outcome.firstTokenMs })
        }
      };
    }
  };
}
