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
  inferenceRequired?: boolean;
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
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);

    if (origin !== undefined && allowedCorsOrigins.has(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-credentials", "true");
      reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header(
        "access-control-allow-headers",
        "content-type,x-request-id,idempotency-key,x-soko-device-id,x-soko-device-name,x-soko-platform,x-soko-client"
      );
    }

    const hasRouteSpecificOriginValidation = request.url.startsWith("/auth/passkeys/");
    if (
      origin !== undefined &&
      !allowedCorsOrigins.has(origin) &&
      isMutation &&
      !hasRouteSpecificOriginValidation
    ) {
      return reply.code(403).send({
        code: "origin_not_allowed",
        message: "This request origin is not allowed."
      });
    }

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (
      request.url.startsWith("/auth/") ||
      request.url === "/session" ||
      request.url.startsWith("/session/") ||
      request.url === "/logout" ||
      request.url === "/logout-all" ||
      request.url === "/sessions" ||
      request.url.startsWith("/sessions/")
    ) {
      reply.header("cache-control", "no-store");
    }

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
    try {
      await options.mutationPersistenceFlush();
    } catch (error) {
      const syncFailure = readAccountSyncFailure(error);
      if (syncFailure === null || reply.getHeader("set-cookie") === undefined) {
        throw error;
      }

      request.log.error(
        {
          event: "auth.account_sync_degraded",
          operation: "persist_account_sync_change",
          accountId: syncFailure.accountId,
          attemptedCollection: syncFailure.attemptedCollection,
          constraintName: syncFailure.constraintName,
          requestCorrelationId: request.id,
          authenticationBlocked: false
        },
        "Authentication committed without the non-critical account sync journal."
      );
      return payload;
    }
    if (request.routeOptions.url === "/auth/pin/login") {
      request.log.info(
        {
          event: "auth.transaction_committed",
          requestCorrelationId: request.id
        },
        "PIN login transaction committed."
      );
    }
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    if (
      request.routeOptions.url === "/auth/pin/login" &&
      reply.statusCode < 400 &&
      reply.getHeader("set-cookie") !== undefined
    ) {
      request.log.info(
        {
          event: "auth.session_cookie_returned",
          requestCorrelationId: request.id,
          statusCode: reply.statusCode
        },
        "PIN login session cookie returned."
      );
    }
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

    routes.get("/health/live", async () => ({
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString()
    }));

    routes.get("/health/ready", async (_request, reply) => {
      const [database, model] = await Promise.all([
        options.databaseHealth?.(),
        options.agentRuntimeDiagnostic?.(false)
      ]);
      const databaseOk = database === undefined || database.status === "ok";
      const inferenceEnabled = options.agentRuntimeDiagnostic !== undefined;
      const inferenceOk = model?.status === "ready";
      const ready =
        databaseOk && (options.inferenceRequired !== true || (inferenceEnabled && inferenceOk));
      if (!ready) reply.code(503);
      return {
        service: "api",
        status: ready ? "ready" : "unavailable",
        timestamp: new Date().toISOString(),
        dispatch: { mode: "synchronous" },
        database: {
          configured: options.databaseHealth !== undefined,
          ok: databaseOk,
          detail: database ?? null
        },
        inference: {
          enabled: inferenceEnabled,
          required: options.inferenceRequired === true,
          ok: inferenceEnabled ? inferenceOk : null,
          model: model ?? null
        },
        model: model ?? null
      };
    });

    if (options.agentRuntimeDiagnostic !== undefined) {
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
