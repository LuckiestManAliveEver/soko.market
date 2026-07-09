import Fastify from "fastify";
import type { HealthResponse } from "@soko/shared-types";
import { registerCp2Routes, type Cp2RouteOptions } from "./cp2/routes.js";

const defaultAllowedCorsOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];

export interface BuildApiOptions {
  allowedCorsOrigins?: string[];
  cp2?: Cp2RouteOptions;
}

export function buildApi(options: BuildApiOptions = {}) {
  const app = Fastify({
    logger: true
  });
  const allowedCorsOrigins = new Set(options.allowedCorsOrigins ?? defaultAllowedCorsOrigins);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;

    if (origin !== undefined && allowedCorsOrigins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
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
