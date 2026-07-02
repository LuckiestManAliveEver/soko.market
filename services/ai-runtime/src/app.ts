import Fastify from "fastify";
import type { HealthResponse } from "@soko/shared-types";

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
