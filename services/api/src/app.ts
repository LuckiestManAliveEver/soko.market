import Fastify from "fastify";
import type { HealthResponse } from "@soko/shared-types";

export function buildApi() {
  const app = Fastify({
    logger: true
  });

  app.get("/health", async (): Promise<HealthResponse> => {
    return {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString()
    };
  });

  return app;
}
