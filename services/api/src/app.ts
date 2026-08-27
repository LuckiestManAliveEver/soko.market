import Fastify, { type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { HealthResponse, RuntimeModelDiagnostic } from "@soko/shared-types";
import { registerCp2Routes, type Cp2RouteOptions } from "./cp2/routes.js";
import { registerMcpRoutes } from "./mcp/routes.js";

const defaultAllowedCorsOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];

// Coarse, HTTP-level request throttling. This is a backstop against scraping/DoS across the
// entire surface, not the primary brute-force defense for auth actions - the OTP/PIN/signup
// flows already enforce tighter, purpose-specific limits deeper in cp2/routes.ts and cp2/store.ts.
const defaultRateLimitMax = 300;
const authRateLimitMax = 60;
const rateLimitWindowMs = 60_000;

export interface BuildApiOptions {
  allowedCorsOrigins?: string[];
  bodyLimit?: number;
  cp2?: Cp2RouteOptions;
  agentRuntimeDiagnostic?: (runInference: boolean) => Promise<RuntimeModelDiagnostic>;
  databaseHealth?: () => Promise<Record<string, unknown>>;
  inferenceRequired?: boolean;
  mutationPersistenceFlush?: () => Promise<void>;
  /**
   * ioredis-compatible client used to share rate-limit counters across API instances/restarts.
   * When omitted, rate limiting still runs but falls back to an in-memory, per-process store.
   */
  rateLimitRedisClient?: unknown;
}

export function buildApi(options: BuildApiOptions = {}) {
  const app = Fastify({
    logger: true,
    bodyLimit: options.bodyLimit ?? 15_000_000
  });
  const allowedCorsOrigins = new Set(options.allowedCorsOrigins ?? defaultAllowedCorsOrigins);
  const oauthAllowedRedirectOrigins = readOAuthAllowedRedirectOrigins([...allowedCorsOrigins]);
  const persistenceBarrierRequests = new WeakSet<object>();

  void app.register(websocket, {
    options: {
      maxPayload: 1_024
    }
  });

  void app.register(rateLimit, {
    global: true,
    max: (request) => (request.url.startsWith("/auth/") ? authRateLimitMax : defaultRateLimitMax),
    timeWindow: rateLimitWindowMs,
    hook: "onRequest",
    keyGenerator: (request) => request.ip,
    allowList: (request) => request.url.startsWith("/health"),
    skipOnError: true,
    ...(options.rateLimitRedisClient === undefined ? {} : { redis: options.rateLimitRedisClient }),
    errorResponseBuilder: (_request, context) => ({
      code: "rate_limited",
      message: `Too many requests. Please retry after ${context.after}.`
    })
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
      reply.header("pragma", "no-cache");
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
    const persistenceStartedAt = Date.now();
    try {
      await withPersistenceFlushDeadline(options.mutationPersistenceFlush(), request);
      if (request.routeOptions.url === "/api/agents/:agentId/models/:modelId/activate") {
        request.log.info(
          {
            event: "model.activation_persisted",
            requestId: request.id,
            persistenceLatencyMs: Date.now() - persistenceStartedAt
          },
          "Verified agent model binding crossed the persistence barrier."
        );
      }
    } catch (error) {
      if (error instanceof PersistenceFlushDeadlineExceeded) {
        // The write is still queued and will complete/retry in the background (see
        // Cp2Store.flush()) - holding this response open until then would leave the caller's
        // "Working..." state spinning for as long as the queue is backed up, with no bound. A
        // request that already succeeded in memory - including a freshly issued session cookie -
        // should not wait forever on a best-effort durability sync, and a deadline timeout is not
        // itself a persistence failure: the flush has not failed, it is merely still running (see
        // withPersistenceFlushDeadline below). Treating "not confirmed yet" the same as "failed"
        // here would turn ordinary Postgres latency (a Neon cold start, a slow query sharing the
        // pool) into a hard login failure even though the in-memory session this response's
        // cookie points to is already valid and immediately usable on this single API instance -
        // exactly the tradeoff docs/single-instance-store-ceiling.md already made deliberately
        // ("a failed save no longer reverts anything... discarding it was strictly worse than
        // keeping it"). A genuinely failed flush (the branch below, not this one) still fails
        // authentication closed.
        request.log.warn(
          {
            event: "auth.persistence_flush_deadline_exceeded",
            requestCorrelationId: request.id
          },
          "Persistence flush exceeded the response deadline; responding without waiting further."
        );
        return payload;
      }

      const syncFailure = readAccountSyncFailure(error);
      const hasAuthenticationCookies = reply.getHeader("set-cookie") !== undefined;
      if (syncFailure === null) {
        if (hasAuthenticationCookies) {
          reply.removeHeader("set-cookie");
          throw new AuthenticationPersistenceUnavailable();
        }
        throw error;
      }
      if (!hasAuthenticationCookies) {
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
    if (error instanceof AuthenticationPersistenceUnavailable) {
      reply.removeHeader("set-cookie");
      return reply.code(503).send({
        code: error.code,
        message: error.message
      });
    }
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
    routes.get("/", async () => ({
      service: "api" as const,
      status: "ok" as const,
      health: "/health" as const,
      liveness: "/health/live" as const,
      readiness: "/health/ready" as const
    }));

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

class PersistenceFlushDeadlineExceeded extends Error {}

class AuthenticationPersistenceUnavailable extends Error {
  readonly code = "AUTH_PERSISTENCE_UNAVAILABLE";

  constructor() {
    super("Authentication could not be saved safely. Please try again.");
    this.name = "AuthenticationPersistenceUnavailable";
  }
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Bounds how long a response can be held open waiting on the shared persistence queue
// (Cp2Store.flush()). The queue's own retries are already timeout-bounded per attempt, but under
// a sustained outage it keeps re-queueing (see postgres-store.ts scheduleSaveRetry), so a request
// that lands behind a large backlog could otherwise wait indefinitely. This does not cancel the
// underlying flush - it keeps running - it only stops this response from waiting on it forever.
function withPersistenceFlushDeadline<T>(flush: Promise<T>, request: FastifyRequest): Promise<T> {
  const deadlineMs = positiveIntegerFromEnv("PERSISTENCE_FLUSH_RESPONSE_DEADLINE_MS", 8_000);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PersistenceFlushDeadlineExceeded());
    }, deadlineMs);
    timer.unref();
    flush.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  }).catch((error) => {
    if (error instanceof PersistenceFlushDeadlineExceeded) {
      // Keep observing the original flush in the background so a later real failure is still
      // logged (readAccountSyncFailure has already lost its chance to inform this response).
      flush.catch((flushError) => {
        request.log.error(
          { event: "auth.persistence_flush_failed_after_deadline", error: flushError },
          "Persistence flush failed after its response deadline had already elapsed."
        );
      });
    }
    throw error;
  });
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
    error.code !== "ACCOUNT_SYNC_INITIALIZATION_FAILED" ||
    !("persistenceStage" in error) ||
    error.persistenceStage !== "account_sync_journal" ||
    !("criticalAuthPersistenceCommitted" in error) ||
    error.criticalAuthPersistenceCommitted !== true
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
