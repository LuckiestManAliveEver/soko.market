import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { HealthResponse, RuntimeModelDiagnostic } from "@soko/shared-types";
import { registerCp2Routes, type Cp2RouteOptions } from "./cp2/routes.js";
import { registerMcpRoutes } from "./mcp/routes.js";

const defaultAllowedCorsOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];

export interface BuildApiOptions {
  allowedCorsOrigins?: string[];
  cp2?: Cp2RouteOptions;
  agentRuntimeDiagnostic?: (runInference: boolean) => Promise<RuntimeModelDiagnostic>;
  databaseHealth?: () => Promise<Record<string, unknown>>;
  mutationPersistenceFlush?: () => Promise<void>;
}

export function buildApi(options: BuildApiOptions = {}) {
  const app = Fastify({
    logger: true,
    bodyLimit: 15_000_000
  });
  const allowedCorsOrigins = new Set(options.allowedCorsOrigins ?? defaultAllowedCorsOrigins);
  const oauthAllowedRedirectOrigins = readOAuthAllowedRedirectOrigins([...allowedCorsOrigins]);
  const persistenceBarrierRequests = new WeakSet<object>();

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
      reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header("access-control-allow-headers", "content-type");
    }

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (
      options.mutationPersistenceFlush === undefined ||
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS" ||
      reply.statusCode >= 400 ||
      persistenceBarrierRequests.has(request)
    ) {
      return payload;
    }

    persistenceBarrierRequests.add(request);
    await options.mutationPersistenceFlush();
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const syncFailure = readAccountSyncFailure(error);
    if (syncFailure === null) {
      return reply.send(error);
    }

    request.log.error(
      {
        operation:
          request.routeOptions.url === "/auth/pin/login"
            ? "phone_pin_owner_login"
            : "persist_account_sync_change",
        accountId: syncFailure.accountId,
        attemptedCollection: syncFailure.attemptedCollection,
        constraintName: syncFailure.constraintName,
        requestCorrelationId: request.id,
        code: "ACCOUNT_SYNC_INITIALIZATION_FAILED"
      },
      "Account sync persistence failed."
    );
    reply.removeHeader("set-cookie");
    return reply.code(503).send({
      code: "ACCOUNT_SYNC_INITIALIZATION_FAILED",
      message: "We could not finish setting up your account. Please try again."
    });
  });

  void app.register(async (routes) => {
    routes.get(
      "/health",
      async (): Promise<
        HealthResponse & { agentDispatch: { configured: boolean; mode: "synchronous" } }
      > => {
        return {
          service: "api",
          status: "ok",
          timestamp: new Date().toISOString(),
          agentDispatch: {
            configured: options.agentRuntimeDiagnostic !== undefined,
            mode: "synchronous"
          }
        };
      }
    );

    if (options.agentRuntimeDiagnostic !== undefined) {
      routes.get("/health/ready", async (_request, reply) => {
        const model = await options.agentRuntimeDiagnostic?.(false);
        if (model?.status !== "ready") reply.code(503);
        return {
          service: "api",
          status: model?.status === "ready" ? "ready" : "unavailable",
          timestamp: new Date().toISOString(),
          dispatch: { mode: "synchronous" },
          model
        };
      });

      routes.get("/health/ai", async (_request, reply) => {
        const model = await options.agentRuntimeDiagnostic?.(true);
        if (model?.status !== "ready") reply.code(503);
        return {
          service: "api",
          status: model?.status === "ready" ? "ready" : "unavailable",
          timestamp: new Date().toISOString(),
          model
        };
      });
    }

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

function readAccountSyncFailure(error: unknown): {
  accountId: string;
  attemptedCollection: string;
  constraintName: string | null;
} | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "ACCOUNT_SYNC_INITIALIZATION_FAILED"
  ) {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.accountId !== "string" || typeof record.attemptedCollection !== "string") {
    return null;
  }

  return {
    accountId: record.accountId,
    attemptedCollection: record.attemptedCollection,
    constraintName: typeof record.constraintName === "string" ? record.constraintName : null
  };
}
