import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { FulfillmentService } from "../services/api/src/cp2/domains/fulfillment/service";

interface McpTokenResponse {
  accessToken: string;
  token: {
    id: string;
    accountId: string;
    shopId: string | null;
    scopes: string[];
    createdAt: string;
    expiresAt: string;
  };
}

describe("CP23 MCP tool gateway", () => {
  it("exposes tenant-scoped fulfillment load and dispatch evaluation with decimal gram values", async () => {
    const getCorridorPool = vi.fn(async () => ({
      corridorId: "11111111-1111-4111-8111-111111111111",
      eligibleTotalWeightGrams: "4000000",
      allocatableWeightGrams: "4000000",
      readiness: "DISPATCHABLE",
      orders: []
    }));
    const evaluateDispatch = vi.fn(async () => ({
      outcome: "READY",
      readiness: "DISPATCH_READY",
      maxWaitReached: false,
      recommendation: null,
      reason: "TARGET_REACHED"
    }));
    const fulfillmentService = {
      available: true,
      getCorridorPool,
      evaluateDispatch
    } as unknown as FulfillmentService;
    const app = buildApi({ cp2: { fulfillmentService } });
    const cookie = await createSession(app, "254700000298");
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "MCP Dispatch Shop", language: "en" },
      cookie
    );
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      { name: "Dispatch agent", scopes: ["mcp:read", "mcp:act"], shopId: shop.business.id },
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
    expect(listed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(["fulfillment.get_corridor_load", "fulfillment.evaluate_dispatch"])
    );
    const corridorId = "11111111-1111-4111-8111-111111111111";
    const load = await mcpPost(
      app,
      token.accessToken,
      toolCall(3, "fulfillment.get_corridor_load", { shopId: shop.business.id, corridorId }),
      sessionId
    );
    expect(load.json().result).toMatchObject({
      isError: false,
      structuredContent: { eligibleTotalWeightGrams: "4000000" }
    });
    const evaluation = await mcpPost(
      app,
      token.accessToken,
      toolCall(4, "fulfillment.evaluate_dispatch", {
        shopId: shop.business.id,
        corridorId,
        idempotencyKey: "evaluate-corridor-once"
      }),
      sessionId
    );
    expect(evaluation.json().result).toMatchObject({
      isError: false,
      structuredContent: { outcome: "READY" }
    });
    expect(getCorridorPool).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null, businessId: shop.business.id, corridorId })
    );
    expect(evaluateDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "evaluate-corridor-once" })
    );
    await app.close();
  });

  it("links ChatGPT through OAuth 2.1 authorization code with PKCE", async () => {
    const app = buildApi();
    const cookie = await createSession(app, "254700000230");
    const verifier = "soko-chatgpt-oauth-verifier-0123456789abcdef";
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const resourceMetadata = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource"
    });
    expect(resourceMetadata.statusCode).toBe(200);
    expect(resourceMetadata.json()).toMatchObject({
      resource: "https://soko.market/mcp",
      authorization_servers: ["https://soko.market"],
      scopes_supported: ["mcp:read", "mcp:act"]
    });

    const serverMetadata = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server"
    });
    expect(serverMetadata.json()).toMatchObject({
      issuer: "https://soko.market",
      authorization_endpoint: "https://soko.market/oauth/authorize",
      token_endpoint: "https://soko.market/oauth/token",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true
    });

    const authorizeUrl = new URL("https://soko.market/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", "https://chatgpt.com/oauth/client.json");
    authorizeUrl.searchParams.set(
      "redirect_uri",
      "https://chatgpt.com/connector_platform_oauth_redirect"
    );
    authorizeUrl.searchParams.set("resource", "https://soko.market/mcp");
    authorizeUrl.searchParams.set("scope", "mcp:read mcp:act");
    authorizeUrl.searchParams.set("state", "chatgpt-state");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const consent = await app.inject({
      method: "GET",
      url: `${authorizeUrl.pathname}${authorizeUrl.search}`,
      headers: { cookie }
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.headers["cache-control"]).toBe("no-store");
    expect(consent.body).toContain("Connect ChatGPT to Soko Market");
    const requestId = consent.body.match(/request_id=([^&"]+)/u)?.[1];
    expect(requestId).toBeTruthy();

    const decision = await app.inject({
      method: "GET",
      url: `/oauth/authorize/decision?request_id=${requestId}&decision=approve`,
      headers: { cookie }
    });
    expect(decision.statusCode).toBe(302);
    const callback = new URL(String(decision.headers.location));
    expect(callback.origin + callback.pathname).toBe(
      "https://chatgpt.com/connector_platform_oauth_redirect"
    );
    expect(callback.searchParams.get("state")).toBe("chatgpt-state");
    expect(callback.searchParams.get("iss")).toBe("https://soko.market");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: "https://chatgpt.com/oauth/client.json",
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        resource: "https://soko.market/mcp",
        code_verifier: verifier
      }).toString()
    });
    expect(token.statusCode).toBe(200);
    expect(token.json()).toMatchObject({
      access_token: expect.stringMatching(/^soko_mcp_[a-f0-9]{64}$/u),
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:read mcp:act"
    });

    const initialized = await mcpPost(app, token.json().access_token, initializeRequest());
    const listed = await mcpPost(
      app,
      token.json().access_token,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      String(initialized.headers["mcp-session-id"])
    );
    expect(listed.json().result.tools[0]).toMatchObject({
      name: "soko.get_profile",
      outputSchema: { required: ["id"] },
      securitySchemes: [{ type: "oauth2", scopes: ["mcp:read"] }],
      _meta: { "openai/profile": true }
    });

    const replay = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        client_id: "https://chatgpt.com/oauth/client.json",
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        resource: "https://soko.market/mcp",
        code_verifier: verifier
      }).toString()
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({ error: "invalid_grant" });
    await app.close();
  });

  it("lets any external MCP-capable agent use the app with issued credentials", async () => {
    const app = buildApi();
    const cookie = await createSession(app, "254700000240");
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "External Agent Shop", language: "en" },
      cookie
    );
    await postJson(
      app,
      `/businesses/${shop.business.id}/products`,
      { name: "Agent Flour", unit: "bag", quantity: 8, sellingPrice: 210 },
      cookie
    );
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      {
        name: "Muse Instinct Claude external agent",
        scopes: ["mcp:read"],
        shopId: shop.business.id
      },
      cookie,
      { origin: "http://localhost:5173" }
    );

    const initialized = await app.inject({
      method: "POST",
      url: `/mcp?shopId=${encodeURIComponent(shop.business.id)}`,
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "Muse-or-Instinct-or-Claude-compatible-MCP-client"
      },
      payload: JSON.stringify(initializeRequest())
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result.serverInfo).toMatchObject({ name: "soko-market" });

    const sessionId = String(initialized.headers["mcp-session-id"]);
    const profile = await mcpPost(
      app,
      token.accessToken,
      toolCall(2, "soko.get_profile", {}),
      sessionId
    );
    expect(profile.json().result).toMatchObject({
      isError: false,
      structuredContent: { id: token.token.accountId }
    });

    const catalogue = await mcpPost(
      app,
      token.accessToken,
      toolCall(3, "soko.query_catalogue", {
        shopId: shop.business.id,
        query: "agent flour"
      }),
      sessionId
    );
    expect(catalogue.json().result).toMatchObject({
      isError: false,
      structuredContent: {
        products: [expect.objectContaining({ businessId: shop.business.id, sellingPrice: 210 })]
      }
    });
    await app.close();
  });

  it("connects an existing system catalogue to confirmed Soko Chat orders", async () => {
    const app = buildApi();
    const ownerCookie = await createSession(app, "254700000239");
    const shop = await postJson<{ business: { id: string } }>(
      app,
      "/businesses",
      { name: "API Millers", language: "en" },
      ownerCookie
    );
    const token = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      {
        name: "ERP connection",
        scopes: ["mcp:read", "mcp:act"],
        shopId: shop.business.id
      },
      ownerCookie
    );
    const authorization = `Bearer ${token.accessToken}`;
    const sync = await app.inject({
      method: "PUT",
      url: "/v1/shop-system/catalogue",
      headers: { authorization },
      payload: {
        products: [
          {
            sku: "FLOUR-2KG",
            name: "Maize flour 2kg",
            unit: "bag",
            quantity: 20,
            sellingPrice: 240
          }
        ]
      }
    });
    expect(sync.statusCode).toBe(200);
    expectInteractiveBudget(sync);

    const buyerCookie = await createSession(app, "254700000238");
    const search = await app.inject({
      method: "GET",
      url: "/buy/search?query=maize%20flour",
      headers: { cookie: buyerCookie }
    });
    const result = search.json().results[0];
    expect(result).toMatchObject({ title: "Maize flour 2kg", sourceKind: "catalogue" });

    const checkout = await app.inject({
      method: "POST",
      url: "/buy/checkout",
      headers: { cookie: buyerCookie },
      payload: { items: [{ ...result, quantity: 2 }] }
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().handoffs[0]).toMatchObject({ kind: "catalogue", status: "requested" });

    const orders = await app.inject({
      method: "GET",
      url: "/v1/shop-system/orders",
      headers: { authorization }
    });
    expectInteractiveBudget(orders);
    expect(orders.json().orders[0]).toMatchObject({
      businessId: shop.business.id,
      status: "requested",
      items: [{ productName: "Maize flour 2kg", quantity: 2 }]
    });

    const accepted = await app.inject({
      method: "PATCH",
      url: `/v1/shop-system/orders/${orders.json().orders[0].id}`,
      headers: { authorization },
      payload: { status: "accepted" }
    });
    expect(accepted.json()).toMatchObject({ status: "accepted" });
    expectInteractiveBudget(accepted);
    await app.close();
  });

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
      "soko.get_profile",
      "soko.list_shops",
      "soko.get_sync_changes",
      "soko.query_catalogue",
      "soko.runtime_status",
      "soko.runtime_turn",
      "soko.confirm_runtime_action",
      "soko.runtime_checkpoint",
      "soko.runtime_resume",
      "soko.runtime_rollback",
      "soko.runtime_merge",
      "soko.agent_swap",
      "soko.model_swap",
      "soko.execution_host_swap"
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
      "soko.get_profile",
      "soko.list_shops",
      "soko.get_sync_changes",
      "soko.query_catalogue",
      "soko.runtime_status"
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
      "soko.get_profile",
      "soko.list_shops",
      "soko.get_sync_changes",
      "soko.query_catalogue",
      "soko.runtime_status",
      "soko.runtime_turn",
      "soko.confirm_runtime_action",
      "soko.runtime_checkpoint",
      "soko.runtime_resume",
      "soko.runtime_rollback",
      "soko.runtime_merge",
      "soko.agent_swap",
      "soko.model_swap",
      "soko.execution_host_swap"
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

function expectInteractiveBudget(response: {
  headers: Record<string, string | string[] | undefined>;
}): void {
  expect(response.headers["x-soko-response-budget-class"]).toBe("interactive");
  expect(response.headers["x-soko-response-budget-ms"]).toBe("150");
  const timing = String(response.headers["server-timing"]);
  const duration = Number(timing.match(/dur=([\d.]+)/u)?.[1]);
  expect(duration).toBeLessThanOrEqual(150);
}

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
