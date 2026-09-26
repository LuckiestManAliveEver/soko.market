import type { AiModelSummary, ModelExecutionTarget } from "@soko/shared-types";

import type { InferenceExecutionTarget, ModelDefinition } from "./contract.js";
import { isInferenceExecutionTarget } from "./contract.js";

/**
 * The router's model view is a projection of the existing catalog row (cp2_model_catalog /
 * AiModelSummary) - not a second registry. A catalog row participates in provider routing only when
 * it carries a well-formed `inference` block; every other row keeps its pre-existing execution path.
 */
export function modelDefinitionFromCatalog(summary: AiModelSummary): ModelDefinition | null {
  const routing = summary.inference;
  if (routing === undefined || routing === null) return null;
  if (
    typeof routing.providerId !== "string" ||
    routing.providerId.trim() === "" ||
    typeof routing.providerModelId !== "string" ||
    routing.providerModelId.trim() === "" ||
    !isInferenceExecutionTarget(routing.executionTarget) ||
    typeof routing.capabilities !== "object" ||
    routing.capabilities === null
  ) {
    return null;
  }
  return {
    id: summary.id,
    displayName: summary.label,
    providerId: routing.providerId,
    providerModelId: routing.providerModelId,
    executionTarget: routing.executionTarget,
    capabilities: {
      text: routing.capabilities.text === true,
      ...(routing.capabilities.vision === undefined ? {} : { vision: routing.capabilities.vision }),
      // The pre-existing, verified catalog flags stay authoritative when present: a model that was
      // never confirmed to accept tools is not promoted to tool-capable by the routing block.
      tools: routing.capabilities.tools === true && summary.supportsToolCalling !== false,
      structuredOutput:
        routing.capabilities.structuredOutput === true &&
        summary.supportsStructuredOutput !== false,
      ...(routing.capabilities.reasoning === undefined
        ? {}
        : { reasoning: routing.capabilities.reasoning }),
      ...(routing.capabilities.streaming === undefined
        ? {}
        : { streaming: routing.capabilities.streaming })
    },
    ...(summary.contextWindow === null ? {} : { contextWindow: summary.contextWindow }),
    ...(typeof routing.maxOutputTokens === "number" && routing.maxOutputTokens > 0
      ? { maxOutputTokens: routing.maxOutputTokens }
      : {}),
    // Both switches must be on: the catalog's own availability and the routing block's enabled.
    enabled: routing.enabled === true && summary.available,
    ...(routing.pricing === undefined || routing.pricing === null
      ? {}
      : { pricing: routing.pricing }),
    metadata: { source: summary.source }
  };
}

/**
 * Maps a provider-layer execution target onto the native runtime graph. Client-executed targets
 * map to null: they never become a native host, binding role, or server adapter key.
 */
export function nativeExecutionTargetFor(
  target: InferenceExecutionTarget
): ModelExecutionTarget | null {
  switch (target) {
    case "remote-inference":
      return "backend";
    case "remote-shop-device":
      return "remote-shop-device";
    case "browser-local":
    case "installed-app":
      return null;
  }
}
