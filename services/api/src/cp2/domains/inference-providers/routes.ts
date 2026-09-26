/**
 * AI provider routes (docs/architecture/multi-provider-inference-implementation.md §13):
 *
 *   GET    /v1/ai/providers                          configured providers (no credential data)
 *   GET    /v1/ai/models                             provider-routed catalog models
 *   GET    /v1/ai/provider-connections[?businessId]  the caller's BYOK connections (redacted)
 *   POST   /v1/ai/provider-connections               connect or replace a key
 *   DELETE /v1/ai/provider-connections/:id           disconnect (revokes and erases the key)
 *   POST   /v1/ai/provider-connections/:id/test      cheapest safe verification
 *
 * Same shape as domains/external-connections/routes.ts. Every handler returns only the redacted
 * summaries built in inference/providers/connections.ts; the API key travels inbound only, in the
 * POST body, and is never echoed back, logged, or placed in an error.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { InferenceProviderConnectionScope } from "@soko/shared-types";
import { readSessionCookie, type Cp2Store } from "../../store.js";
import { Cp2Error } from "../../cp2-error.js";
import {
  enforceAuthIpRate,
  parseOptionalString,
  parseString,
  sendCp2Error
} from "../../route-helpers.js";

interface ConnectBody {
  providerId?: unknown;
  apiKey?: unknown;
  scope?: unknown;
  businessId?: unknown;
  baseUrl?: unknown;
}

interface ConnectionParams {
  id: string;
}

interface ConnectionsQuery {
  businessId?: string;
}

export function registerInferenceProviderRoutes(
  app: FastifyInstance,
  store: Cp2Store,
  authAttemptsByIp: Map<string, number[]>
): void {
  app.get("/v1/ai/providers", async (request, reply) => {
    try {
      return { providers: store.listInferenceProviders(readSessionCookie(request.headers.cookie)) };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/v1/ai/models", async (request, reply) => {
    try {
      return { models: store.listInferenceModels(readSessionCookie(request.headers.cookie)) };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get(
    "/v1/ai/provider-connections",
    async (request: FastifyRequest<{ Querystring: ConnectionsQuery }>, reply) => {
      try {
        const businessId = parseOptionalString(request.query.businessId);
        return {
          connections: await store.listInferenceProviderConnections({
            sessionId: readSessionCookie(request.headers.cookie),
            ...(businessId === undefined || businessId === "" ? {} : { businessId })
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/ai/provider-connections",
    async (request: FastifyRequest<{ Body: ConnectBody }>, reply) => {
      try {
        // Each attempt may cost one verification call to the provider; bound it like other
        // credential-submission endpoints.
        enforceAuthIpRate(authAttemptsByIp, request, "inference_provider_connect", 10);
        const body = request.body ?? {};
        const providerId = parseString(body.providerId, "providerId");
        const apiKey = parseString(body.apiKey, "apiKey");
        const scope = parseScope(body.scope);
        const businessId = parseOptionalString(body.businessId);
        const baseUrl = parseOptionalString(body.baseUrl);
        return await store.connectInferenceProvider({
          sessionId: readSessionCookie(request.headers.cookie),
          providerId,
          apiKey,
          scope,
          ...(businessId === undefined ? {} : { businessId }),
          ...(baseUrl === undefined ? {} : { baseUrl })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/ai/provider-connections/:id/test",
    async (request: FastifyRequest<{ Params: ConnectionParams }>, reply) => {
      try {
        enforceAuthIpRate(authAttemptsByIp, request, "inference_provider_test", 20);
        return await store.testInferenceProviderConnection({
          sessionId: readSessionCookie(request.headers.cookie),
          id: request.params.id
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/v1/ai/provider-connections/:id",
    async (request: FastifyRequest<{ Params: ConnectionParams }>, reply) => {
      try {
        return await store.disconnectInferenceProviderConnection({
          sessionId: readSessionCookie(request.headers.cookie),
          id: request.params.id
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}

function parseScope(value: unknown): InferenceProviderConnectionScope {
  if (value === undefined || value === "user") return "user";
  if (value === "tenant") return "tenant";
  throw new Cp2Error(400, "inference_connection_scope_invalid", "scope must be user or tenant.");
}
