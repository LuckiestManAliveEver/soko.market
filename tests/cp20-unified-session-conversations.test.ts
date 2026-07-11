import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  ConversationMessageSummary,
  ConversationView,
  SokoSessionContext
} from "@soko/shared-types";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp?: string;
}

interface BusinessResponse {
  business: {
    id: string;
    name: string;
    sokoId: string;
  };
}

describe("CP20 unified account, conversation, and session foundation", () => {
  it("supports an account without a shop and resolves seller permissions from memberships", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const sessionCookie = await createAccountSession(app, "254700000020");

    const initialContext = await getJson<SokoSessionContext>(
      app,
      "/v1/session/context",
      sessionCookie
    );
    expect(initialContext).toMatchObject({
      activeShopId: null,
      mode: "marketplace",
      activeSurface: "conversation",
      sessionVersion: 1,
      shops: []
    });
    expect(initialContext.agentId).toBe(`account-${initialContext.accountId}-agent`);
    expect(initialContext.permissions).toContain("marketplace:search");

    const missingShop = await patchJson(
      app,
      "/v1/session/context",
      {
        mode: "seller",
        activeShopId: null,
        activeSurface: "owner-controls",
        expectedSessionVersion: 1
      },
      sessionCookie
    );
    expect(missingShop.statusCode).toBe(409);
    expect(missingShop.json().code).toBe("active_shop_required");

    const firstShop = await createBusiness(app, sessionCookie, "Jane Cereals");
    const secondShop = await createBusiness(app, sessionCookie, "Jane Shoes");
    const shops = await getJson<{ shops: Array<{ business: { id: string } }> }>(
      app,
      "/v1/shops",
      sessionCookie
    );
    expect(shops.shops.map((shop) => shop.business.id)).toEqual([
      firstShop.business.id,
      secondShop.business.id
    ]);

    const sellerContextResponse = await patchJson(
      app,
      "/v1/session/context",
      {
        mode: "seller",
        activeShopId: firstShop.business.id,
        activeSurface: "owner-controls",
        expectedSessionVersion: 1
      },
      sessionCookie
    );
    expect(sellerContextResponse.statusCode).toBe(200);
    const sellerContext = sellerContextResponse.json<SokoSessionContext>();
    expect(sellerContext).toMatchObject({
      activeShopId: firstShop.business.id,
      mode: "seller",
      activeSurface: "owner-controls",
      sessionVersion: 2
    });
    expect(sellerContext.permissions).toEqual(
      expect.arrayContaining(["product:write", "payment:write", "membership:manage"])
    );

    const staleUpdate = await patchJson(
      app,
      "/v1/session/context",
      {
        mode: "marketplace",
        activeShopId: null,
        activeSurface: "conversation",
        expectedSessionVersion: 1
      },
      sessionCookie
    );
    expect(staleUpdate.statusCode).toBe(409);
    expect(staleUpdate.json().code).toBe("session_context_conflict");
    expect(store.snapshot().auditEvents.map((event) => event.type)).toContain(
      "session.context_updated"
    );

    await app.close();
  });

  it("keeps conversations account-scoped and messages idempotent across persistence", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const ownerCookie = await createAccountSession(app, "254700000021");
    const strangerCookie = await createAccountSession(app, "254700000022");
    const shop = await createBusiness(app, ownerCookie, "Conversation Shop");
    const context = await getJson<SokoSessionContext>(app, "/v1/session/context", ownerCookie);

    const conversation = await postJson<ConversationView>(
      app,
      "/v1/conversations",
      { kind: "storefront", activeShopId: shop.business.id },
      ownerCookie
    );
    expect(conversation.participants.map((participant) => participant.role)).toEqual(
      expect.arrayContaining(["account", "agent", "shop"])
    );

    const payload = {
      conversationId: conversation.conversation.id,
      clientMessageId: "android-message-0001",
      content: { type: "text", text: "Do you have 10 kg of maize flour?" },
      clientTimestamp: "2026-07-11T21:04:27+03:00"
    };
    const firstMessage = await postJson<ConversationMessageSummary>(
      app,
      "/v1/messages",
      payload,
      ownerCookie
    );
    const repeatedMessage = await postJson<ConversationMessageSummary>(
      app,
      "/v1/messages",
      payload,
      ownerCookie
    );
    expect(repeatedMessage.id).toBe(firstMessage.id);

    const forbiddenConversation = await getResponse(
      app,
      `/v1/conversations/${conversation.conversation.id}`,
      strangerCookie
    );
    expect(forbiddenConversation.statusCode).toBe(404);

    const ownerControlsOutsideSellerMode = await postResponse(
      app,
      "/v1/messages",
      {
        conversationId: context.conversationId,
        clientMessageId: "owner-controls-0001",
        content: { type: "owner-controls", shopId: shop.business.id }
      },
      ownerCookie
    );
    expect(ownerControlsOutsideSellerMode.statusCode).toBe(403);
    expect(ownerControlsOutsideSellerMode.json().code).toBe("seller_context_required");

    const snapshot = store.snapshot();
    await app.close();

    const hydratedStore = createCp2Store();
    hydratedStore.hydrateSnapshot(snapshot);
    const hydratedApp = buildApi({ cp2: { store: hydratedStore } });
    const restored = await getJson<ConversationView>(
      hydratedApp,
      `/v1/conversations/${conversation.conversation.id}`,
      ownerCookie
    );
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]?.id).toBe(firstMessage.id);
    expect(hydratedStore.snapshot().auditEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["conversation.created", "message.created"])
    );

    await hydratedApp.close();
  });
});

async function createAccountSession(app: FastifyInstance, destination: string): Promise<string> {
  const otp = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination
  });
  const response = await postResponse(app, "/auth/otp/verify", {
    challengeId: otp.challengeId,
    code: otp.devOtp
  });
  return extractSessionCookie(response.headers["set-cookie"]);
}

function createBusiness(
  app: FastifyInstance,
  cookie: string,
  name: string
): Promise<BusinessResponse> {
  return postJson<BusinessResponse>(app, "/businesses", { name, language: "en" }, cookie);
}

async function getJson<T>(app: FastifyInstance, url: string, cookie: string): Promise<T> {
  const response = await getResponse(app, url, cookie);
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function getResponse(app: FastifyInstance, url: string, cookie: string) {
  return app.inject({ method: "GET", url, headers: { cookie } });
}

async function postJson<T>(
  app: FastifyInstance,
  url: string,
  payload: unknown,
  cookie?: string
): Promise<T> {
  const response = await postResponse(app, url, payload, cookie);
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function postResponse(app: FastifyInstance, url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie })
    },
    payload: JSON.stringify(payload)
  });
}

function patchJson(app: FastifyInstance, url: string, payload: unknown, cookie: string) {
  return app.inject({
    method: "PATCH",
    url,
    headers: { "content-type": "application/json", cookie },
    payload: JSON.stringify(payload)
  });
}

function extractSessionCookie(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;

  if (cookie === undefined) {
    throw new Error("Session cookie missing");
  }

  return cookie.split(";", 1)[0] ?? cookie;
}
