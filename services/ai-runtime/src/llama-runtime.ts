import { getLlama, LlamaChatSession, type LlamaModel } from "node-llama-cpp";

import type { DisposableRuntime } from "./runtime-cache.js";
import { InferenceServiceError } from "./service-error.js";

export interface LoadedLlamaRuntime extends DisposableRuntime {
  generate(input: {
    prompt: string;
    maximumTokens: number;
    temperature: number;
    signal?: AbortSignal;
    onText(text: string): void;
  }): Promise<{
    text: string;
    finishReason: string | null;
    inputTokens: number;
    outputTokens: number;
  }>;
}

export async function loadLlamaRuntime(modelPath: string): Promise<LoadedLlamaRuntime> {
  const llama = await getLlama({ gpu: false });
  let model: LlamaModel;
  try {
    model = await llama.loadModel({ modelPath });
  } catch (error) {
    await llama.dispose();
    throw new InferenceServiceError(
      "MODEL_LOADING_FAILED",
      "llama.cpp could not load the selected model.",
      true,
      503,
      { cause: error }
    );
  }
  return {
    async generate(input) {
      const context = await model.createContext({ contextSize: 4096 });
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        autoDisposeSequence: false
      });
      const chunks: string[] = [];
      try {
        const result = await session.promptWithMeta(input.prompt, {
          maxTokens: input.maximumTokens,
          temperature: input.temperature,
          ...(input.signal === undefined ? {} : { signal: input.signal, stopOnAbortSignal: true }),
          onTextChunk: (text) => {
            chunks.push(text);
            input.onText(text);
          }
        });
        const text = result.responseText.trim() || chunks.join("").trim();
        if (text === "") {
          throw new InferenceServiceError(
            "INVALID_INFERENCE_RESPONSE",
            "The model returned no text.",
            true,
            502
          );
        }
        return {
          text,
          finishReason: result.stopReason,
          inputTokens: model.tokenize(input.prompt).length,
          outputTokens: model.tokenize(text).length
        };
      } catch (error) {
        if (error instanceof InferenceServiceError) throw error;
        if (input.signal?.aborted === true) {
          throw new InferenceServiceError(
            "INFERENCE_CANCELLED",
            "Inference was cancelled.",
            true,
            499,
            { cause: error }
          );
        }
        throw new InferenceServiceError(
          "MODEL_GENERATION_FAILED",
          "llama.cpp inference failed.",
          true,
          503,
          { cause: error }
        );
      } finally {
        session.dispose({ disposeSequence: false });
        await context.dispose();
      }
    },
    async dispose() {
      await model.dispose();
      await llama.dispose();
    }
  };
}
