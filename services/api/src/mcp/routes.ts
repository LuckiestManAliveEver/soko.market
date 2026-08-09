import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { McpAccessScope, McpPrincipal } from "@soko/shared-types";
import { Cp2Error, readSessionCookie, type Cp2Store } from "../cp2/store.js";

const protocolVersion = "2025-11-25";
const maxRequestsPerMinute = 120;

export interface McpRouteOptions {
  allowedOrigins: string[];
  store: Cp2Store;
}

interface McpSession {
  tokenId: string;
  expiresAt: string;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export function registerMcpRoutes(app: FastifyInstance, options: McpRouteOptions): void {
  const allowedOrigins = new Set(options.allowedOrigins);
  const sessions = new Map<string, McpSession>();
  const rateWindows = new Map<string, { startedAt: number; requests: number }>();

  app.post("/v1/mcp/tokens", async (request, reply) => {
    try {
      requireTrustedOrigin(request, allowedOrigins);
      const body = objectValue(request.body, "request body");
      const expiresInSeconds = optionalIntegerValue(body.expiresInSeconds, "expiresInSeconds");
      return options.store.createMcpAccessToken({
        sessionId: readSessionCookie(request.headers.cookie),
        name: stringValue(body.name, "name"),
        scopes: scopesValue(body.scopes),
        shopId: optionalStringValue(body.shopId, "shopId"),
        ...(expiresInSeconds === undefined ? {} : { expiresInSeconds })
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/v1/mcp/tokens", async (request, reply) => {
    try {
      return {
        tokens: options.store.listMcpAccessTokens({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.delete(
    "/v1/mcp/tokens/:tokenId",
    async (request: FastifyRequest<{ Params: { tokenId: string } }>, reply) => {
      try {
        requireTrustedOrigin(request, allowedOrigins);
        return options.store.revokeMcpAccessToken({
          sessionId: readSessionCookie(request.headers.cookie),
          tokenId: request.params.tokenId
        });
      } catch (error) {
        return sendHttpError(reply, error);
      }
    }
  );

  app.get("/mcp", async (_request, reply) => {
    return reply.header("allow", "POST, DELETE").code(405).send();
  });

  app.delete("/mcp", async (request, reply) => {
    try {
      requireTrustedOrigin(request, allowedOrigins);
      const principal = authenticateBearer(request, options.store);
      const sessionId = stringHeader(request.headers["mcp-session-id"]);
      requireMcpSession(sessions, sessionId, principal);
      sessions.delete(sessionId);
      return reply.code(204).send();
    } catch (error) {
      return sendMcpHttpError(reply, error, null);
    }
  });

  app.post("/mcp", async (request, reply) => {
    const rpc = isJsonRpcRequest(request.body) ? request.body : null;
    const id = rpc?.id ?? null;
    try {
      requireTrustedOrigin(request, allowedOrigins);
      const principal = authenticateBearer(request, options.store);
      enforceRateLimit(rateWindows, principal.tokenId);
      if (rpc === null || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
        return reply.send(jsonRpcError(id, -32600, "Invalid Request"));
      }

      if (rpc.method === "initialize") {
        const sessionId = randomUUID();
        sessions.set(sessionId, { tokenId: principal.tokenId, expiresAt: principal.expiresAt });
        return reply.header("mcp-session-id", sessionId).send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "soko-market", version: "0.1.0" },
            instructions:
              "Soko business tools are tenant-scoped. Mutations require a separate confirmation call."
          }
        });
      }

      const sessionId = stringHeader(request.headers["mcp-session-id"]);
      requireMcpSession(sessions, sessionId, principal);

      if (rpc.method === "notifications/initialized") {
        return reply.code(202).send();
      }
      if (rpc.method === "ping") {
        return reply.send({ jsonrpc: "2.0", id, result: {} });
      }
      if (rpc.method === "tools/list") {
        return reply.send({
          jsonrpc: "2.0",
          id,
          result: { tools: mcpToolsForPrincipal(principal) }
        });
      }
      if (rpc.method === "tools/call") {
        const result = await callMcpTool(options.store, principal, rpc.params);
        return reply.send({ jsonrpc: "2.0", id, result });
      }
      return reply.send(jsonRpcError(id, -32601, "Method not found"));
    } catch (error) {
      return sendMcpHttpError(reply, error, id);
    }
  });
}

function mcpToolsForPrincipal(principal: McpPrincipal) {
  const tools: Array<Record<string, unknown>> = [];
  if (principal.scopes.includes("mcp:read")) {
    tools.push(
      {
        name: "soko.list_shops",
        description: "List shops the authenticated Soko account can access.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false }
      },
      {
        name: "soko.get_sync_changes",
        description: "Read the account's durable incremental sync journal.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: ["string", "null"] },
            limit: { type: "integer", minimum: 1, maximum: 100 }
          }
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
      },
      {
        name: "soko.query_catalogue",
        description:
          "Query canonical products in one authorized shop. Returns authoritative selling price, availability, and product IDs.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["shopId", "query"],
          properties: {
            shopId: { type: "string", format: "uuid" },
            query: { type: "string", minLength: 1, maxLength: 120 },
            limit: { type: "integer", minimum: 1, maximum: 50 }
          }
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
      }
    );
  }
  if (principal.scopes.includes("mcp:act")) {
    tools.push(
      {
        name: "soko.runtime_turn",
        description:
          "Propose a deterministic Soko runtime action. Business mutations return needs_confirmation and are not executed yet.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["shopId", "message"],
          properties: {
            shopId: { type: "string", format: "uuid" },
            message: { type: "string", minLength: 1, maxLength: 2000 },
            runtimeSessionId: { type: "string", format: "uuid" }
          }
        },
        annotations: { readOnlyHint: false, destructiveHint: false }
      },
      {
        name: "soko.confirm_runtime_action",
        description: "Explicitly confirm one previously proposed Soko runtime action.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["shopId", "runtimeSessionId", "confirmationToken"],
          properties: {
            shopId: { type: "string", format: "uuid" },
            runtimeSessionId: { type: "string", format: "uuid" },
            confirmationToken: { type: "string", minLength: 1 }
          }
        },
        annotations: { readOnlyHint: false, destructiveHint: true }
      }
    );
  }
  return tools;
}

async function callMcpTool(store: Cp2Store, principal: McpPrincipal, params: unknown) {
  const record = objectValue(params, "params");
  const name = stringValue(record.name, "name");
  const args = objectValue(record.arguments ?? {}, "arguments");
  try {
    let result: unknown;
    if (name === "soko.list_shops") {
      requireScope(principal, "mcp:read");
      result = store.listAccountShops({ sessionId: principal.sessionId });
    } else if (name === "soko.get_sync_changes") {
      requireScope(principal, "mcp:read");
      const limit = optionalIntegerValue(args.limit, "limit");
      result = store.pullSyncChanges({
        sessionId: principal.sessionId,
        cursor: optionalStringValue(args.cursor, "cursor"),
        ...(limit === undefined ? {} : { limit })
      });
    } else if (name === "soko.query_catalogue") {
      requireScope(principal, "mcp:read");
      const shopId = requiredShop(principal, args.shopId);
      const limit = optionalIntegerValue(args.limit, "limit");
      result = store.queryCatalogue({
        sessionId: principal.sessionId,
        businessId: shopId,
        query: stringValue(args.query, "query"),
        ...(limit === undefined ? {} : { limit })
      });
    } else if (name === "soko.runtime_turn") {
      requireScope(principal, "mcp:act");
      const shopId = requiredShop(principal, args.shopId);
      result = await store.createRuntimeTurn({
        sessionId: principal.sessionId,
        businessId: shopId,
        message: stringValue(args.message, "message"),
        ...(args.runtimeSessionId === undefined
          ? {}
          : { runtimeSessionId: stringValue(args.runtimeSessionId, "runtimeSessionId") })
      });
    } else if (name === "soko.confirm_runtime_action") {
      requireScope(principal, "mcp:act");
      const shopId = requiredShop(principal, args.shopId);
      result = await store.createRuntimeTurn({
        sessionId: principal.sessionId,
        businessId: shopId,
        runtimeSessionId: stringValue(args.runtimeSessionId, "runtimeSessionId"),
        confirmationToken: stringValue(args.confirmationToken, "confirmationToken"),
        message: "Confirm the previously proposed MCP action."
      });
    } else {
      throw new Cp2Error(404, "mcp_tool_not_found", "MCP tool was not found.");
    }
    return toolResult(result, false);
  } catch (error) {
    if (error instanceof Cp2Error) {
      return toolResult({ code: error.code, message: error.message }, true);
    }
    throw error;
  }
}

function toolResult(value: unknown, isError: boolean) {
  const text = JSON.stringify(value);
  return { content: [{ type: "text", text }], structuredContent: value, isError };
}

function authenticateBearer(request: FastifyRequest, store: Cp2Store): McpPrincipal {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw new Cp2Error(401, "mcp_bearer_required", "Bearer authorization is required.");
  }
  return store.authenticateMcpAccessToken({ accessToken: authorization.slice(7).trim() });
}

function requireMcpSession(
  sessions: Map<string, McpSession>,
  sessionId: string,
  principal: McpPrincipal
): void {
  const session = sessions.get(sessionId);
  if (
    session === undefined ||
    session.tokenId !== principal.tokenId ||
    Date.parse(session.expiresAt) <= Date.now()
  ) {
    throw new Cp2Error(400, "mcp_session_invalid", "MCP session is invalid or expired.");
  }
}

function enforceRateLimit(
  windows: Map<string, { startedAt: number; requests: number }>,
  tokenId: string
): void {
  const now = Date.now();
  const current = windows.get(tokenId);
  if (current === undefined || now - current.startedAt >= 60_000) {
    windows.set(tokenId, { startedAt: now, requests: 1 });
    return;
  }
  current.requests += 1;
  if (current.requests > maxRequestsPerMinute) {
    throw new Cp2Error(429, "mcp_rate_limited", "MCP request rate limit exceeded.");
  }
}

function requireTrustedOrigin(request: FastifyRequest, allowedOrigins: Set<string>): void {
  const origin = request.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    throw new Cp2Error(403, "mcp_origin_forbidden", "MCP origin is not allowed.");
  }
}

function requireScope(principal: McpPrincipal, scope: McpAccessScope): void {
  if (!principal.scopes.includes(scope)) {
    throw new Cp2Error(403, "mcp_scope_forbidden", "MCP token lacks the required scope.");
  }
}

function requiredShop(principal: McpPrincipal, value: unknown): string {
  const shopId = stringValue(value, "shopId");
  if (principal.shopId !== null && principal.shopId !== shopId) {
    throw new Cp2Error(403, "mcp_shop_forbidden", "MCP token is bound to another shop.");
  }
  return shopId;
}

function sendHttpError(reply: FastifyReply, error: unknown) {
  if (error instanceof Cp2Error) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  throw error;
}

function sendMcpHttpError(reply: FastifyReply, error: unknown, id: unknown) {
  if (error instanceof Cp2Error) {
    if (error.statusCode === 401) {
      reply.header("www-authenticate", 'Bearer realm="soko-mcp"');
    }
    return reply.code(error.statusCode).send(jsonRpcError(id, -32000, error.message));
  }
  throw error;
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Cp2Error(400, "mcp_input_invalid", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Cp2Error(400, "mcp_input_invalid", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalStringValue(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : stringValue(value, field);
}

function optionalIntegerValue(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new Cp2Error(400, "mcp_input_invalid", `${field} must be an integer.`);
  }
  return value as number;
}

function scopesValue(value: unknown): McpAccessScope[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "mcp_input_invalid", "scopes must be an array.");
  }
  return value.map((scope) => {
    if (scope !== "mcp:read" && scope !== "mcp:act") {
      throw new Cp2Error(400, "mcp_scope_invalid", "Unsupported MCP scope.");
    }
    return scope;
  });
}

function stringHeader(value: string | string[] | undefined): string {
  return stringValue(Array.isArray(value) ? value[0] : value, "Mcp-Session-Id");
}
