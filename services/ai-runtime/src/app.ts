import Fastify from "fastify";
import type { HealthResponse } from "@soko/shared-types";
export {
  buildLlamaPrompt,
  createLlamaCppRuntimeModelProvider,
  type LlamaCppRuntimeModelOptions
} from "./local-model.js";
export {
  createOpenAiRuntimeModelProvider,
  type OpenAiRuntimeModelOptions
} from "./openai-model.js";

export function buildAiRuntime() {
  const app = Fastify({
    logger: true
  });

  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      service: "ai-runtime",
      status: "ok",
      timestamp: new Date().toISOString()
    };
  });

  return app;
}
