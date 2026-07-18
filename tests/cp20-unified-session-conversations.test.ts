import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  ConversationMessageSummary,
  ConversationView,
  MessageDeliveryAttemptSummary,
  MessageHandoffSummary,
  SokoSessionContext
} from "@soko/shared-types";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface BusinessResponse {
  business: {
    id: string;
    name: string;
    sokoId: string;
  };
}

describe("CP20 unified account, conversation, and session foundation", () => {
  it("persists marketplace completion and validates backend AI model activation", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const sessionCookie = await createAccountSession(app, "254700000019");

    const initial = await getJson<{ completedAt: string | null }>(
      app,
      "/v1/marketplace-intro",
      sessionCookie
    );
    expect(initial.completedAt).toBeNull();
    const completed = await postJson<{ completedAt: string | null }>(
      app,
      "/v1/marketplace-intro/complete",
      { businessId: null },
      sessionCookie
    );
    expect(completed.completedAt).toEqual(expect.any(String));

    const shop = await createBusiness(app, sessionCookie, "Model Shop");
    const registry = await getJson<{
      models: Array<{
        id: string;
        available: boolean;
        source: string;
        format: string;
        license: string | null;
        downloadUrl: string | null;
      }>;
    }>(app, "/v1/ai-models", sessionCookie);
    expect(registry.models.map((model) => model.id)).toContain("qwen2.5-0.5b-android");
    expect(registry.models.filter((model) => model.source === "huggingface")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "smollm2-360m-android",
          format: "GGUF",
          license: "Apache-2.0",
          downloadUrl: expect.stringContaining("huggingface.co")
        }),
        expect.objectContaining({ id: "qwen2.5-1.5b-android", license: "Apache-2.0" })
      ])
    );

    const searchResults = await getJson<{ models: Array<{ id: string }> }>(
      app,
      "/v1/ai-models?search=qwen",
      sessionCookie
    );
    expect(searchResults.models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["qwen2.5-0.5b-android", "qwen2.5-1.5b-android"])
    );

    const activated = await app.inject({
      method: "PUT",
      url: `/businesses/${shop.business.id}/ai-model`,
      headers: { "content-type": "application/json", cookie: sessionCookie },
      payload: JSON.stringify({ modelId: "sokoclaw-local" })
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({ modelId: "sokoclaw-local" });

    const invalid = await app.inject({
      method: "PUT",
      url: `/businesses/${shop.business.id}/ai-model`,
      headers: { "content-type": "application/json", cookie: sessionCookie },
      payload: JSON.stringify({ modelId: "invented-client-model" })
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("ai_model_unavailable");

    const custom = await app.inject({
      method: "PUT",
      url: `/businesses/${shop.business.id}/ai-model`,
      headers: { "content-type": "application/json", cookie: sessionCookie },
      payload: JSON.stringify({ modelId: "custom:merchant-model-abc123" })
    });
    expect(custom.statusCode).toBe(200);
    expect(custom.json()).toMatchObject({ modelId: "custom:merchant-model-abc123" });

    const github = await app.inject({
      method: "PUT",
      url: `/businesses/${shop.business.id}/ai-model`,
      headers: { "content-type": "application/json", cookie: sessionCookie },
      payload: JSON.stringify({ modelId: "github:example.android-gguf.qwen-mini-q4-k-m" })
    });
    expect(github.statusCode).toBe(200);
    expect(github.json()).toMatchObject({
      modelId: "github:example.android-gguf.qwen-mini-q4-k-m"
    });

    const huggingFace = await app.inject({
      method: "PUT",
      url: `/businesses/${shop.business.id}/ai-model`,
      headers: { "content-type": "application/json", cookie: sessionCookie },
      payload: JSON.stringify({
        modelId: "huggingface:example.mobile-gguf.qwen-mini-q4-k-m"
      })
    });
    expect(huggingFace.statusCode).toBe(200);
    expect(huggingFace.json()).toMatchObject({
      modelId: "huggingface:example.mobile-gguf.qwen-mini-q4-k-m"
    });

    const snapshot = store.snapshot();
    expect(snapshot.marketplaceIntroStates).toHaveLength(1);
    expect(snapshot.activeAiModels).toContainEqual(
      expect.objectContaining({
        businessId: shop.business.id,
        modelId: "huggingface:example.mobile-gguf.qwen-mini-q4-k-m"
      })
    );
    await app.close();
  });

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
      idempotencyKey: "offline-message-attempt-0001",
      content: { type: "text", text: "Do you have 10 kg of maize flour?" },
      clientTimestamp: "2026-07-11T21:04:27+03:00",
      queuedAt: "2026-07-11T18:04:20.000Z",
      selectedChannel: "soko"
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
      { ...payload, clientMessageId: "android-message-retry-0002" },
      ownerCookie
    );
    expect(repeatedMessage.id).toBe(firstMessage.id);
    expect(firstMessage).toMatchObject({
      idempotencyKey: payload.idempotencyKey,
      status: "delivered",
      queuedAt: payload.queuedAt,
      sentAt: expect.any(String),
      deliveredAt: expect.any(String),
      retryCount: 0,
      selectedChannel: "soko",
      actualChannel: "soko",
      failureCode: null
    });
    const attempts = await getJson<{ attempts: MessageDeliveryAttemptSummary[] }>(
      app,
      `/v1/conversations/${conversation.conversation.id}/messages/${firstMessage.id}/delivery-attempts`,
      ownerCookie
    );
    expect(attempts.attempts).toEqual([
      expect.objectContaining({
        accountId: context.accountId,
        conversationId: conversation.conversation.id,
        messageId: firstMessage.id,
        channel: "soko",
        provider: "soko",
        attemptNumber: 1,
        result: "succeeded"
      })
    ]);

    const forbiddenConversation = await getResponse(
      app,
      `/v1/conversations/${conversation.conversation.id}`,
      strangerCookie
    );
    expect(forbiddenConversation.statusCode).toBe(404);
    const forbiddenAttempts = await getResponse(
      app,
      `/v1/conversations/${conversation.conversation.id}/messages/${firstMessage.id}/delivery-attempts`,
      strangerCookie
    );
    expect(forbiddenAttempts.statusCode).toBe(404);

    const unavailableChannel = await postResponse(
      app,
      "/v1/messages",
      {
        ...payload,
        clientMessageId: "android-message-sms-0003",
        idempotencyKey: "offline-message-attempt-0003",
        selectedChannel: "sms"
      },
      ownerCookie
    );
    expect(unavailableChannel.statusCode).toBe(400);
    expect(unavailableChannel.json().code).toBe("message_channel_unavailable");

    const handoff = await postJson<MessageHandoffSummary>(
      app,
      "/v1/message-handoffs",
      {
        businessId: shop.business.id,
        conversationId: conversation.conversation.id,
        channel: "sms_external_app",
        status: "composer_opened",
        normalizedErrorCode: null
      },
      ownerCookie
    );
    expect(handoff).toMatchObject({
      accountId: context.accountId,
      businessId: shop.business.id,
      conversationId: conversation.conversation.id,
      channel: "sms_external_app",
      status: "composer_opened",
      normalizedErrorCode: null
    });

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
    expect(restored.messages[0]).toMatchObject({
      idempotencyKey: payload.idempotencyKey,
      selectedChannel: "soko",
      actualChannel: "soko"
    });
    expect(hydratedStore.snapshot().messageDeliveryAttempts).toHaveLength(1);
    const hydratedAuditEvents = hydratedStore.snapshot().auditEvents;
    expect(hydratedAuditEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["conversation.created", "message.created", "message.handoff"])
    );
    const handoffAudit = hydratedAuditEvents.find((event) => event.type === "message.handoff");
    expect(JSON.stringify(handoffAudit)).not.toContain("Hello");
    expect(JSON.stringify(handoffAudit)).not.toContain("+254");

    await hydratedApp.close();
  });

  it("supports full direct-message lifecycle across two accounts", async () => {
    const deliveries: Array<{ endpoint: string; body: string }> = [];
    const store = createCp2Store({
      pushNotificationSender: async (subscription, payload) => {
        deliveries.push({ endpoint: subscription.endpoint, body: JSON.stringify(payload) });
        return "sent";
      }
    });
    const app = buildApi({ cp2: { store, vapidPublicKey: "test-vapid-public-key" } });
    const senderCookie = await createAccountSession(app, "254700000031");
    const recipientCookie = await createAccountSession(app, "254700000032");
    const senderDeviceId = "device-sender-00000001";
    const recipientDeviceId = "device-recipient-0001";
    await registerEncryptionDevice(app, senderCookie, senderDeviceId);
    await registerEncryptionDevice(app, recipientCookie, recipientDeviceId);
    const pushConfig = await getJson<{ enabled: boolean; publicKey: string }>(
      app,
      "/v1/push/config",
      recipientCookie
    );
    expect(pushConfig).toEqual({ enabled: true, publicKey: "test-vapid-public-key" });
    await postJson(
      app,
      "/v1/push/subscriptions",
      {
        endpoint: "https://push.example.test/recipient",
        expirationTime: null,
        keys: {
          auth: "AAAAAAAAAAAAAAAAAAAAAA",
          p256dh: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        }
      },
      recipientCookie
    );

    const conversation = await postJson<ConversationView>(
      app,
      "/v1/conversations",
      {
        kind: "personal",
        activeShopId: null,
        recipient: "+254700000032",
        title: "Delivery coordination"
      },
      senderCookie
    );
    expect(
      conversation.participants.filter((participant) => participant.role === "account")
    ).toHaveLength(2);

    const plaintextRejected = await postResponse(
      app,
      "/v1/messages",
      {
        conversationId: conversation.conversation.id,
        clientMessageId: "direct-plaintext-0001",
        content: { type: "text", text: "This must never reach storage." }
      },
      senderCookie
    );
    expect(plaintextRejected.statusCode).toBe(400);
    expect(plaintextRejected.json()).toMatchObject({ code: "e2ee_required" });

    const sent = await postJson<ConversationMessageSummary>(
      app,
      "/v1/messages",
      {
        conversationId: conversation.conversation.id,
        clientMessageId: "direct-message-0001",
        content: encryptedFixture([senderDeviceId, recipientDeviceId], "ciphertext-one"),
        clientTimestamp: "2026-07-15T12:00:00.000Z"
      },
      senderCookie
    );
    expect(sent).toMatchObject({ status: "delivered", deliveredAt: expect.any(String) });
    expect(sent.content).toMatchObject({ type: "encrypted", attachmentCount: 1 });
    await Promise.resolve();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ endpoint: "https://push.example.test/recipient" });
    expect(deliveries[0]?.body).not.toContain("The order is ready");
    expect(JSON.stringify(store.snapshot().conversationMessages)).not.toContain(
      "The order is ready"
    );

    const recipientInbox = await getJson<{
      conversations: Array<{ id: string; unreadCount: number }>;
    }>(app, "/v1/conversations", recipientCookie);
    expect(recipientInbox.conversations).toContainEqual(
      expect.objectContaining({ id: conversation.conversation.id, unreadCount: 1 })
    );

    const typing = await postJson<{ typing: Array<{ displayName: string }> }>(
      app,
      `/v1/conversations/${conversation.conversation.id}/typing`,
      { typing: true },
      recipientCookie
    );
    expect(typing.typing).toEqual(expect.any(Array));

    const markedRead = await patchJson(
      app,
      `/v1/conversations/${conversation.conversation.id}`,
      { read: true, pinned: true },
      recipientCookie
    );
    expect(markedRead.statusCode).toBe(200);
    expect(markedRead.json<ConversationView>().messages[0]).toMatchObject({
      status: "read",
      readAt: expect.any(String)
    });

    const edited = await patchJson(
      app,
      `/v1/conversations/${conversation.conversation.id}/messages/${sent.id}`,
      { content: encryptedFixture([senderDeviceId, recipientDeviceId], "ciphertext-two") },
      senderCookie
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json<ConversationMessageSummary>()).toMatchObject({
      editedAt: expect.any(String),
      content: { type: "encrypted" }
    });

    const reacted = await patchJson(
      app,
      `/v1/conversations/${conversation.conversation.id}/messages/${sent.id}`,
      { reaction: "👍" },
      recipientCookie
    );
    expect(reacted.json<ConversationMessageSummary>().reactions).toHaveLength(1);

    const deleted = await patchJson(
      app,
      `/v1/conversations/${conversation.conversation.id}/messages/${sent.id}`,
      { deleted: true },
      senderCookie
    );
    expect(deleted.json<ConversationMessageSummary>()).toMatchObject({
      deletedAt: expect.any(String),
      content: { type: "encrypted" }
    });

    await app.close();
  });
});

const fixturePublicKey = {
  kty: "EC" as const,
  crv: "P-256" as const,
  x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  y: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  ext: true
};

async function registerEncryptionDevice(
  app: FastifyInstance,
  cookie: string,
  deviceId: string
): Promise<void> {
  await postJson(
    app,
    "/v1/e2ee/devices",
    {
      deviceId,
      label: "Test browser",
      publicKey: fixturePublicKey
    },
    cookie
  );
}

function encryptedFixture(deviceIds: string[], ciphertextSeed: string) {
  return {
    type: "encrypted",
    attachmentCount: 1,
    iv: "AAAAAAAAAAAAAAAA",
    ciphertext: btoa(ciphertextSeed).replaceAll("=", ""),
    envelopes: deviceIds.map((recipientDeviceId) => ({
      version: 1,
      algorithm: "ECDH-P256-HKDF-SHA256-AES-256-GCM",
      recipientDeviceId,
      ephemeralPublicKey: fixturePublicKey,
      salt: "AAAAAAAAAAAAAAAAAAAAAA",
      iv: "AAAAAAAAAAAAAAAA",
      ciphertext: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
    }))
  };
}

async function createAccountSession(app: FastifyInstance, destination: string): Promise<string> {
  const response = await postResponse(app, "/auth/pin/signup", {
    method: "phone",
    contact: destination,
    pin: "1234"
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
