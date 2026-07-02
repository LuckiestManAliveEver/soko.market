import Fastify from "fastify";
import type { HealthResponse } from "@soko/shared-types";
import { registerCp2Routes, type Cp2RouteOptions } from "./cp2/routes.js";

export interface BuildApiOptions {
  cp2?: Cp2RouteOptions;
}

export function buildApi(options: BuildApiOptions = {}) {
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

  registerCp2Routes(app, options.cp2);

  return app;
}
