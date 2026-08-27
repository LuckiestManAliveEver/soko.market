import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface McpTokenResponse {
  accessToken: string;
  token: {
    id: string;
    shopId: string | null;
    scopes: string[];
    createdAt: string;
    expiresAt: string;
  };
}

describe("CP23 MCP tool gateway", () => {
  it("authenticates scoped tokens and preserves runtime confirmation gates", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const cookie = await createSession(app, "254700000231");
    await postJson(
      app,
      "/auth/pin/change",
      { currentPin: "1234", pin: "2749", pinConfirmation: "2749" },
      cookie
    );
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
    await postJson(
      app,
      "/auth/pin/change",
      { currentPin: "1234", pin: "8031", pinConfirmation: "8031" },
      cookie
    );
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
    const readOnlyAction = await mcpPost(
      app,
      readOnlyToken.accessToken,
      toolCall(20, "soko.runtime_turn", {
        shopId: first.business.id,
        message: "add product forbidden"
      }),
      String(readInitialized.headers["mcp-session-id"])
    );
    expect(readOnlyAction.json().result).toMatchObject({
      isError: true,
      structuredContent: { code: "mcp_scope_forbidden" }
    });
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
    await postJson(
      app,
      "/auth/pin/change",
      { currentPin: "1234", pin: "5170", pinConfirmation: "5170" },
      cookie
    );
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

    const otherCookie = await createSession(app, "254700000237");
    const otherShop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "Unauthorized Account-Wide Shop", language: "en" },
      otherCookie
    );
    const unauthorizedShopLink = await app.inject({
      method: "POST",
      url: `/mcp?shopId=${encodeURIComponent(otherShop.business.id)}`,
      headers: {
        authorization: `Bearer ${accountWideToken.accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      payload: JSON.stringify(initializeRequest())
    });
    expect(unauthorizedShopLink.statusCode).toBe(403);
    await app.close();
  });

  it("keeps the same credential and its tools valid across browser rotation and logout", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const cookies = await createSession(app, "254700000235");
    await postJson(
      app,
      "/auth/pin/change",
      { currentPin: "1234", pin: "6428", pinConfirmation: "6428" },
      cookies
    );
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "Rotation Independent Shop", language: "en" },
      cookies
    );
    await postJson(
      app,
      `/businesses/${shop.business.id}/products`,
      { name: "Rotation Tea", unit: "box", quantity: 4, sellingPrice: 320 },
      cookies
    );
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      {
        name: "Thirty day independent token",
        scopes: ["mcp:read", "mcp:act"],
        shopId: shop.business.id,
        expiresInSeconds: 2_592_000
      },
      cookies,
      { origin: "http://localhost:5173" }
    );
    expect(Date.parse(token.token.expiresAt) - Date.parse(token.token.createdAt)).toBe(
      2_592_000_000
    );
    const originalSession = store
      .snapshot()
      .sessions.find((session) => session.revokedAt === null)!;
    expect(Date.parse(token.token.expiresAt)).toBeGreaterThan(
      Date.parse(originalSession.expiresAt)
    );
    expect(store.authenticateMcpAccessToken({ accessToken: token.accessToken }).tokenId).toBe(
      token.token.id
    );

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/session/refresh",
      headers: { cookie: cookies }
    });
    expect(refreshed.statusCode).toBe(200);
    expect(store.getSession(originalSession.id)).toBeNull();
    expect(
      store.snapshot().sessions.find((session) => session.id === originalSession.id)
    ).toMatchObject({ revokedAt: expect.any(String), revocationReason: "rotated" });
    expect(store.authenticateMcpAccessToken({ accessToken: token.accessToken }).tokenId).toBe(
      token.token.id
    );

    const initialized = await app.inject({
      method: "POST",
      url: `/mcp?shopId=${encodeURIComponent(shop.business.id)}`,
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      payload: JSON.stringify(initializeRequest())
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.headers["mcp-session-id"]).toEqual(expect.any(String));
    const mcpSessionId = String(initialized.headers["mcp-session-id"]);
    const initializedNotification = await mcpPost(
      app,
      token.accessToken,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      mcpSessionId
    );
    expect(initializedNotification.statusCode).toBe(202);
    const listed = await mcpPost(
      app,
      token.accessToken,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      mcpSessionId
    );
    expect(listed.statusCode).toBe(200);
    const shops = await mcpPost(
      app,
      token.accessToken,
      toolCall(3, "soko.list_shops", {}),
      mcpSessionId
    );
    expect(shops.json().result.structuredContent).toEqual([
      expect.objectContaining({ business: expect.objectContaining({ id: shop.business.id }) })
    ]);
    const catalogue = await mcpPost(
      app,
      token.accessToken,
      toolCall(4, "soko.query_catalogue", { shopId: shop.business.id, query: "tea" }),
      mcpSessionId
    );
    expect(catalogue.json().result).toMatchObject({
      isError: false,
      structuredContent: { products: [expect.objectContaining({ sellingPrice: 320 })] }
    });
    const runtime = await mcpPost(
      app,
      token.accessToken,
      toolCall(5, "soko.runtime_turn", {
        shopId: shop.business.id,
        message: "add product coffee"
      }),
      mcpSessionId
    );
    expect(runtime.json().result).toMatchObject({
      isError: false,
      structuredContent: {
        turn: { status: "completed", plan: { toolName: "product.create" } }
      }
    });

    const loggedOut = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: extractCookie(refreshed.headers["set-cookie"]) }
    });
    expect(loggedOut.statusCode).toBe(200);
    expect(store.authenticateMcpAccessToken({ accessToken: token.accessToken }).tokenId).toBe(
      token.token.id
    );
    expect((await mcpPost(app, token.accessToken, initializeRequest())).statusCode).toBe(200);
    await app.close();
  });

  it("revalidates persisted actor, account, membership, shop, expiry, and legacy provenance", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const cookie = await createSession(app, "254700000236");
    await postJson(
      app,
      "/auth/pin/change",
      { currentPin: "1234", pin: "9814", pinConfirmation: "9814" },
      cookie
    );
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "Lifecycle Authorization Shop", language: "en" },
      cookie
    );
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      { name: "Persisted lifecycle token", scopes: ["mcp:read"], shopId: shop.business.id },
      cookie,
      { origin: "http://localhost:5173" }
    );
    const snapshot = store.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain(token.accessToken);
    expect(snapshot.mcpAccessTokens[0]).toMatchObject({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      createdBySessionId: expect.any(String)
    });

    const persisted = createCp2Store();
    persisted.hydrateSnapshot({ ...snapshot, sessions: [] });
    expect(persisted.authenticateMcpAccessToken({ accessToken: token.accessToken })).toMatchObject({
      tokenId: token.token.id,
      accountId: snapshot.accounts[0]?.id,
      userId: snapshot.users[0]?.id
    });

    const legacyToken = {
      ...snapshot.mcpAccessTokens[0]!,
      sessionId: snapshot.mcpAccessTokens[0]!.createdBySessionId
    } as (typeof snapshot.mcpAccessTokens)[number] & { sessionId: string | null };
    delete (legacyToken as Partial<(typeof snapshot.mcpAccessTokens)[number]>).createdBySessionId;
    const legacy = createCp2Store();
    legacy.hydrateSnapshot({ ...snapshot, sessions: [], mcpAccessTokens: [legacyToken] });
    expect(legacy.authenticateMcpAccessToken({ accessToken: token.accessToken }).tokenId).toBe(
      token.token.id
    );

    expect(() =>
      persisted.authenticateMcpAccessToken({
        accessToken: token.accessToken,
        now: new Date(token.token.expiresAt)
      })
    ).toThrowError(expect.objectContaining({ code: "mcp_token_invalid" }));

    const withoutMembership = createCp2Store();
    withoutMembership.hydrateSnapshot({ ...snapshot, memberships: [] });
    expect(() =>
      withoutMembership.authenticateMcpAccessToken({ accessToken: token.accessToken })
    ).toThrowError(expect.objectContaining({ code: "membership_required" }));

    const withoutShop = createCp2Store();
    withoutShop.hydrateSnapshot({ ...snapshot, businesses: [] });
    expect(() =>
      withoutShop.authenticateMcpAccessToken({ accessToken: token.accessToken })
    ).toThrowError(expect.objectContaining({ code: "business_not_found" }));

    const withoutAccount = createCp2Store();
    withoutAccount.hydrateSnapshot({ ...snapshot, accounts: [], users: [] });
    expect(() =>
      withoutAccount.authenticateMcpAccessToken({ accessToken: token.accessToken })
    ).toThrowError(expect.objectContaining({ code: "mcp_token_invalid" }));

    const suspendedAccount = createCp2Store();
    suspendedAccount.hydrateSnapshot({
      ...snapshot,
      accounts: snapshot.accounts.map((account) => ({ ...account, status: "suspended" as const }))
    });
    expect(() =>
      suspendedAccount.authenticateMcpAccessToken({ accessToken: token.accessToken })
    ).toThrowError(expect.objectContaining({ code: "mcp_token_invalid" }));
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
  const values = Array.isArray(header) ? header : [header];
  expect(values.every((value) => typeof value === "string")).toBe(true);
  return values.map((value) => String(value).split(";")[0] ?? "").join("; ");
}
