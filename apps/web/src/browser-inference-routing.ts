import type {
  BrowserInferenceCapability,
  BrowserInferenceSettings,
  InferenceRoutingDecision
} from "./browser-inference-types";

export function decideInferenceRoute(input: {
  deploymentEnabled: boolean;
  settings: BrowserInferenceSettings | null;
  capability: BrowserInferenceCapability | null;
  modelLoaded: boolean;
  nativeReady: boolean;
  promptTokens: number;
  contextLimit: number;
  requiresServerTool: boolean;
  complexReasoning: boolean;
  pageActive: boolean;
}): InferenceRoutingDecision {
  const modelId = input.settings?.selectedModelId ?? "server-default";
  const server = (
    reasonCode: InferenceRoutingDecision["reasonCode"],
    explanation: string
  ): InferenceRoutingDecision => ({
    route: input.nativeReady ? "native" : "server",
    modelId: input.nativeReady ? "native-assignment" : "server-default",
    reasonCode,
    explanation
  });

  if (!input.deploymentEnabled || input.settings?.enabled !== true) {
    return server("LOCAL_DISABLED", "Browser-local inference is not enabled.");
  }
  if (input.requiresServerTool) {
    return server("SERVER_TOOL_REQUIRED", "This request requires an authorized server tool.");
  }
  if (input.complexReasoning || !input.pageActive) {
    return server(
      "COMPLEXITY_ESCALATION",
      input.pageActive
        ? "This request is better handled by the full Soko runtime."
        : "Browser inference is paused while this tab is inactive."
    );
  }
  if (input.capability?.supported !== true) {
    return server("DEVICE_UNSUPPORTED", "This browser cannot safely run the local model.");
  }
  if (input.promptTokens > input.contextLimit) {
    return server("CONTEXT_TOO_LARGE", "The request exceeds the browser model context limit.");
  }
  if (!input.modelLoaded || input.settings.status !== "ready") {
    return server("MODEL_NOT_LOADED", "The browser model is not loaded.");
  }
  return {
    route: "browser-local",
    modelId,
    reasonCode: "LOCAL_READY",
    explanation: "The enabled on-device model is ready for this bounded conversational request."
  };
}

export function requestRequiresServerTool(message: string): boolean {
  return /\b(create|add|delete|remove|update|change|refund|pay|send|invite|sync|order|receipt)\b/i.test(
    message
  );
}

export function requestNeedsComplexReasoning(message: string): boolean {
  return (
    message.length > 1_500 ||
    /\b(analy[sz]e deeply|forecast|legal advice|tax advice|multi-step|background task)\b/i.test(
      message
    )
  );
}
