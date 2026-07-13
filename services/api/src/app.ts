import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { HealthResponse } from "@soko/shared-types";
import { registerCp2Routes, type Cp2RouteOptions } from "./cp2/routes.js";
import { registerMcpRoutes } from "./mcp/routes.js";

const defaultAllowedCorsOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];

export interface BuildApiOptions {
  allowedCorsOrigins?: string[];
  cp2?: Cp2RouteOptions;
  databaseHealth?: () => Promise<Record<string, unknown>>;
}

export function buildApi(options: BuildApiOptions = {}) {
  const app = Fastify({
    logger: true
  });
  const allowedCorsOrigins = new Set(options.allowedCorsOrigins ?? defaultAllowedCorsOrigins);
  const oauthAllowedRedirectOrigins = readOAuthAllowedRedirectOrigins([...allowedCorsOrigins]);

  void app.register(websocket, {
    options: {
      maxPayload: 1_024
    }
  });

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

  void app.register(async (routes) => {
    routes.get("/health", async (): Promise<HealthResponse> => {
      return {
        service: "api",
        status: "ok",
        timestamp: new Date().toISOString()
      };
    });

    if (options.databaseHealth !== undefined) {
      routes.get("/health/db", async () => {
        const database = await options.databaseHealth?.();

        return {
          service: "api",
          timestamp: new Date().toISOString(),
          database
        };
      });
    }

    const store = registerCp2Routes(routes, {
      ...options.cp2,
      oauthAllowedRedirectOrigins:
        options.cp2?.oauthAllowedRedirectOrigins ?? oauthAllowedRedirectOrigins,
      realtimeAllowedOrigins: [...allowedCorsOrigins]
    });
    registerMcpRoutes(routes, { store, allowedOrigins: [...allowedCorsOrigins] });
  });

  return app;
}

function readOAuthAllowedRedirectOrigins(fallback: string[]): string[] {
  const configured = process.env.AUTH_ALLOWED_REDIRECT_ORIGINS;

  if (configured === undefined || configured.trim().length === 0) {
    return fallback;
  }

  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => new URL(origin).origin);

  return origins.length > 0 ? [...new Set(origins)] : fallback;
}
