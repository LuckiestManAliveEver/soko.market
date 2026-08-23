import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface McpTokenResponse {
  accessToken: string;
  token: { id: string; shopId: string | null; scopes: string[] };
}

describe("CP23 MCP tool gateway", () => {
  it("authenticates scoped tokens and preserves runtime confirmation gates", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const cookie = await createSession(app, "254700000231");
    await postJson(app, "/auth/pin/setup", { pin: "2749" }, cookie);
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "MCP Secure Shop", language: "en" },
      cookie
    );
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      {
        name: "Phase 4 integration",
        scopes: ["mcp:read", "mcp:act"],
        shopId: shop.business.id,
        expiresInSeconds: 2_592_000
      },
      cookie,
      { origin: "http://localhost:5173" }
    );

    expect(token.accessToken).toMatch(/^soko_mcp_[a-f0-9]{64}$/);
    expect(JSON.stringify(store.snapshot())).not.toContain(token.accessToken);
    expect(store.snapshot().mcpAccessTokens[0]?.tokenHash).toHaveLength(64);

    const shopLinkInitialized = await app.inject({
      method: "POST",
      url: `/mcp?shopId=${encodeURIComponent(shop.business.id)}`,
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      payload: JSON.stringify(initializeRequest())
    });
    expect(shopLinkInitialized.statusCode).toBe(200);

    const mismatchedShopLink = await app.inject({
      method: "POST",
      url: "/mcp?shopId=another-shop",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      payload: JSON.stringify(initializeRequest())
    });
    expect(mismatchedShopLink.statusCode).toBe(403);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: initializeRequest()
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");

    const hostileOrigin = await mcpPost(app, token.accessToken, initializeRequest(), undefined, {
      origin: "https://attacker.invalid"
    });
    expect(hostileOrigin.statusCode).toBe(403);

    const initialized = await mcpPost(app, token.accessToken, initializeRequest());
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result).toMatchObject({
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: false } }
    });
    const mcpSessionId = String(initialized.headers["mcp-session-id"]);

    const listed = await mcpPost(
      app,
      token.accessToken,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      mcpSessionId
    );
    expect(listed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "soko.list_shops",
      "soko.get_sync_changes",
      "soko.query_catalogue",
      "soko.runtime_turn",
      "soko.confirm_runtime_action"
    ]);

    // product.create is auto-accepted (no confirmation gate), so it can't prove the confirmation
    // gate works over MCP - create it first (completes in this same call), then use
    // product.update (still confirmed) as the confirmation-gate proof below.
    const createdResponse = await mcpPost(
      app,
      token.accessToken,
      toolCall(3, "soko.runtime_turn", {
        shopId: shop.business.id,
        message: "add product sugar"
      }),
      mcpSessionId
    );
    const created = createdResponse.json().result.structuredContent;
    expect(created.turn).toMatchObject({
      status: "completed",
      plan: { toolName: "product.create", requiresConfirmation: false }
    });
    expect(store.snapshot().products).toEqual([expect.objectContaining({ name: "Sugar" })]);

    const proposedResponse = await mcpPost(
      app,
      token.accessToken,
      toolCall(4, "soko.runtime_turn", {
        shopId: shop.business.id,
        runtimeSessionId: created.session.id,
        message: "update product sugar ksh 200"
      }),
      mcpSessionId
    );
    const proposed = proposedResponse.json().result.structuredContent;
    expect(proposed.turn).toMatchObject({
      status: "needs_confirmation",
      plan: { toolName: "product.update", requiresConfirmation: true, executedAt: null }
    });
    expect(store.snapshot().products[0]?.sellingPrice).not.toBe(200);

    const confirmedResponse = await mcpPost(
      app,
      token.accessToken,
      toolCall(5, "soko.confirm_runtime_action", {
        shopId: shop.business.id,
        runtimeSessionId: proposed.session.id,
        confirmationToken: proposed.turn.plan.confirmationToken
      }),
      mcpSessionId
    );
    const confirmed = confirmedResponse.json().result.structuredContent;
    expect(confirmed.turn).toMatchObject({
      status: "completed",
      verification: { confirmationSatisfied: true }
    });
    expect(store.snapshot().products).toEqual([
      expect.objectContaining({ name: "Sugar", sellingPrice: 200 })
    ]);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/mcp/tokens/${token.token.id}`,
      headers: { cookie, origin: "http://localhost:5173" }
    });
    expect(revoked.statusCode).toBe(200);
    const afterRevocation = await mcpPost(
      app,
      token.accessToken,
      { jsonrpc: "2.0", id: 6, method: "tools/list", params: {} },
      mcpSessionId
    );
    expect(afterRevocation.statusCode).toBe(401);
    await app.close();
  });

  it("enforces read-only scopes and shop binding", async () => {
    const app = buildApi();
    const cookie = await createSession(app, "254700000232");
    await postJson(app, "/auth/pin/setup", { pin: "8031" }, cookie);
    const first = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "Bound Shop", language: "en" },
      cookie
    );
    const secondCookie = await createSession(app, "254700000233");
    const second = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "Other Shop", language: "en" },
      secondCookie
    );
    const product = await postJson<{ id: string }>(
      app,
      `/businesses/${first.business.id}/products`,
      { name: "Fresh Tomatoes", aliases: ["nyanya"], unit: "kg", quantity: 3, sellingPrice: 120 },
      cookie
    );
    const readOnlyToken = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      { name: "Read only token", scopes: ["mcp:read"], shopId: first.business.id },
      cookie,
      { origin: "http://localhost:5173" }
    );
    const readInitialized = await mcpPost(app, readOnlyToken.accessToken, initializeRequest());
    const readListed = await mcpPost(
      app,
      readOnlyToken.accessToken,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      String(readInitialized.headers["mcp-session-id"])
    );
    expect(readListed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "soko.list_shops",
      "soko.get_sync_changes",
      "soko.query_catalogue"
    ]);
    const catalogue = await mcpPost(
      app,
      readOnlyToken.accessToken,
      toolCall(3, "soko.query_catalogue", {
        shopId: first.business.id,
        query: "nyanya"
      }),
      String(readInitialized.headers["mcp-session-id"])
    );
    expect(catalogue.json().result).toMatchObject({
      isError: false,
      structuredContent: {
        products: [
          {
            productId: product.id,
            businessId: first.business.id,
            sellingPrice: 120,
            availability: "available"
          }
        ]
      }
    });
    const crossBusinessCatalogue = await mcpPost(
      app,
      readOnlyToken.accessToken,
      toolCall(4, "soko.query_catalogue", {
        shopId: second.business.id,
        query: "tomatoes"
      }),
      String(readInitialized.headers["mcp-session-id"])
    );
    expect(crossBusinessCatalogue.json().result).toMatchObject({
      isError: true,
      structuredContent: { code: "mcp_shop_forbidden" }
    });
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      {
        name: "Shop bound token",
        scopes: ["mcp:read", "mcp:act"],
        shopId: first.business.id
      },
      cookie,
      { origin: "http://localhost:5173" }
    );
    const initialized = await mcpPost(app, token.accessToken, initializeRequest());
    const sessionId = String(initialized.headers["mcp-session-id"]);
    const listed = await mcpPost(
      app,
      token.accessToken,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      sessionId
    );
    expect(listed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "soko.list_shops",
      "soko.get_sync_changes",
      "soko.query_catalogue",
      "soko.runtime_turn",
      "soko.confirm_runtime_action"
    ]);
    const forbidden = await mcpPost(
      app,
      token.accessToken,
      toolCall(3, "soko.runtime_turn", {
        shopId: second.business.id,
        message: "show products"
      }),
      sessionId
    );
    expect(forbidden.json().result).toMatchObject({
      isError: true,
      structuredContent: { code: "mcp_shop_forbidden" }
    });
    await app.close();
  });

  it("lets an account-wide token connect with a shopId it owns", async () => {
    const app = buildApi();
    const cookie = await createSession(app, "254700000234");
    await postJson(app, "/auth/pin/setup", { pin: "5170" }, cookie);
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "Account-Wide Shop", language: "en" },
      cookie
    );
    const accountWideToken = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      { name: "Account-wide token", scopes: ["mcp:read"] },
      cookie,
      { origin: "http://localhost:5173" }
    );
    expect(accountWideToken.token.shopId).toBeNull();

    const shopLinked = await app.inject({
      method: "POST",
      url: `/mcp?shopId=${encodeURIComponent(shop.business.id)}`,
      headers: {
        authorization: `Bearer ${accountWideToken.accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      payload: JSON.stringify(initializeRequest())
    });
    expect(shopLinked.statusCode).toBe(200);
    await app.close();
  });
});

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "soko-test", version: "1.0.0" }
    }
  };
}

function toolCall(id: number, name: string, args: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

async function mcpPost(
  app: FastifyInstance,
  token: string,
  payload: unknown,
  sessionId?: string,
  extraHeaders: Record<string, string> = {}
) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
      ...extraHeaders
    },
    payload: JSON.stringify(payload)
  });
}

async function createSession(app: FastifyInstance, destination: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ method: "phone", contact: destination, pin: "1234" })
  });
  expect(response.statusCode).toBe(200);
  return extractCookie(response.headers["set-cookie"]);
}

async function postJson<T = unknown>(
  app: FastifyInstance,
  url: string,
  payload: unknown,
  cookie?: string,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
      ...extraHeaders
    },
    payload: JSON.stringify(payload)
  });
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function extractCookie(header: string | string[] | number | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  expect(typeof value).toBe("string");
  return String(value).split(";")[0] ?? "";
}
