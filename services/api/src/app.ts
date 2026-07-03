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

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173") {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
      reply.header("access-control-allow-headers", "content-type");
    }

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
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
