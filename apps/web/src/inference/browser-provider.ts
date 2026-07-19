import type { InferenceChunk, InferenceProvider, InferenceRequest } from "@soko/shared-types";
import type {
  BrowserInferenceBackend,
  BrowserModelDescriptor,
  BrowserModelEngine
} from "../browser-inference-types";

export function createBrowserInferenceProvider(input: {
  backend: Exclude<BrowserInferenceBackend, "none">;
  engine: BrowserModelEngine;
  model: BrowserModelDescriptor;
  enabled: boolean;
}): InferenceProvider {
  const runtime =
    input.backend === "webgpu" ? ("browser-webgpu" as const) : ("browser-wasm" as const);
  return {
    id: runtime,
    runtime,
    async isAvailable() {
      if (!input.enabled || input.engine.getStatus() !== "ready") return false;
      const capabilities = await input.engine.getCapabilities().catch(() => null);
      return capabilities?.backend === input.backend;
    },
    async supports(modelId) {
      return (
        modelId === input.model.id &&
        input.model.supportedBackends.includes(input.backend) &&
        input.model.supportedRuntimes.includes(runtime)
      );
    },
    async *generate(request: InferenceRequest): AsyncIterable<InferenceChunk> {
      const result = await input.engine.generate(
        {
          requestId: request.requestId,
          messages: [
            ...(request.systemPrompt === undefined
              ? []
              : [{ role: "system" as const, content: request.systemPrompt }]),
            ...request.messages
          ],
          maxNewTokens: request.maxTokens ?? 128,
          temperature: request.temperature ?? 0.2
        },
        {}
      );
      yield {
        requestId: request.requestId,
        text: result.text,
        done: true,
        runtime,
        modelId: request.modelId,
        usage: {
          ...(result.promptTokenCount === null ? {} : { promptTokens: result.promptTokenCount }),
          ...(result.generatedTokenCount === null
            ? {}
            : { completionTokens: result.generatedTokenCount })
        }
      };
    },
    cancel: (requestId) => input.engine.cancel(requestId)
  };
}
