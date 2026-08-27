import { describe, expect, it, vi } from "vitest";
import type { AgentModelBindingSummary, RuntimeModelPrompt } from "../packages/shared-types/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { ModelRuntimeAdapter } from "../services/api/src/inference/model-runtime";

const primaryModelId = "qwen2.5-0.5b-android";
const secondaryModelId = "qwen2.5-1.5b-android";

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md). These are the flag-ON,
 * backend-hosted end-to-end tests required by the phase brief's §7: the same live HTTP harness
 * `tests/model-activation-runtime.test.ts` already uses for the flag-off legacy path, run instead
 * with `executionFabricEnabled: true`, proving the Execution Planner actually selects a candidate
 * and a real adapter executes it through the exact same `/v1/messages` chat entry point - not a
 * unit test of the planner in isolation.
 */
describe("execution fabric - flagged planner-driven chat routing (backend-hosted, end to end)", () => {
  it("logs compact execution-plan summaries when a plan resolves and when one is rejected", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resolvedStore = createCp2Store({
      executionFabricEnabled: true,
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === primaryModelId && executionTarget === "backend"
          ? healthyAdapter(primaryModelId)
          : undefined
    });
    const resolvedApp = buildApi({ cp2: { store: resolvedStore } });
    const rejectedStore = createCp2Store({ executionFabricEnabled: true });
    const rejectedApp = buildApi({ cp2: { store: rejectedStore } });

    try {
      const resolvedOwner = await createOwnerBusiness(
        resolvedApp,
        "+254700003006",
        "Resolved Log Shop"
      );
      await putJson(
        resolvedApp,
        `/businesses/${resolvedOwner.businessId}/model-preference`,
        modelPreferencePayload([primaryModelId]),
        resolvedOwner.cookie
      );
      await sendMessage(
        resolvedApp,
        resolvedOwner,
        await firstConversationId(resolvedApp, resolvedOwner),
        "resolved-log-0001"
      );

      const rejectedOwner = await createOwnerBusiness(
        rejectedApp,
        "+254700003007",
        "Rejected Log Shop"
      );
      await putJson(
        rejectedApp,
        `/businesses/${rejectedOwner.businessId}/model-preference`,
        {
          ...modelPreferencePayload([primaryModelId]),
          minimumContextWindow: 10_000_000
        },
        rejectedOwner.cookie
      );
      await sendMessage(
        rejectedApp,
        rejectedOwner,
        await firstConversationId(rejectedApp, rejectedOwner),
        "rejected-log-0001"
      );

      const prefix = "[execution-fabric] ";
      const logPayloads = consoleLog.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === "string" && line.startsWith(prefix))
        .map((line) => JSON.parse(line.slice(prefix.length)) as Record<string, unknown>);
      const resolvedPayload = logPayloads.find((payload) => payload.outcome === "resolved");
      const rejectedPayload = logPayloads.find(
        (payload) => payload.outcome === "rejected" && "errorCode" in payload
      );

      expect(resolvedPayload).toEqual({
        executionId: expect.any(String),
        resolvedPrecedenceLevel: "agent",
        candidateCount: expect.any(Number),
        rejectedCount: expect.any(Number),
        outcome: "resolved"
      });
      expect(rejectedPayload).toEqual({
        executionId: expect.any(String),
        resolvedPrecedenceLevel: "agent",
        candidateCount: 0,
        rejectedCount: expect.any(Number),
        outcome: "rejected",
        errorCode: expect.any(String)
      });
    } finally {
      consoleLog.mockRestore();
      await Promise.all([resolvedApp.close(), rejectedApp.close()]);
    }
  });

  it("writes a ModelPreference via 'Use with Agent', and the planner selects and executes it without creating a device-specific binding", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    const adapter = healthyAdapter(primaryModelId, { prompts });
    const store = createCp2Store({
      executionFabricEnabled: true,
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === primaryModelId && executionTarget === "backend" ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700003001", "Planner Shop");

    await putJson(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      modelPreferencePayload([primaryModelId]),
      owner.cookie
    );

    const conversationId = await firstConversationId(app, owner);
    const response = await sendMessage(app, owner, conversationId, "reply-msg-0001");

    expect(response.statusCode).toBe(200);
    expect(response.json<{ agentMessage: { content: { text: string } } }>()).toMatchObject({
      agentMessage: { content: { type: "text", text: "market" } }
    });
    expect(prompts).toHaveLength(1);

    // "Use with Agent" wrote a ModelPreference, not a legacy device-specific permanent binding -
    // no AgentModelBindingSummary exists for this agent at all.
    expect(await getBinding(app, owner)).toBeNull();

    await app.close();
  });

  it("falls back to the next preferred model when the top-ranked candidate has no adapter, without mutating the stored ModelPreference", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    const adapter = healthyAdapter(secondaryModelId, { prompts });
    const store = createCp2Store({
      executionFabricEnabled: true,
      // Only the secondary (lower-ranked) model actually resolves to a real adapter - the planner
      // will still select the top-ranked primary model first; execution must fall through to the
      // next-highest-scoring candidate rather than failing outright.
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === secondaryModelId && executionTarget === "backend" ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700003002", "Fallback Shop");

    const preferencePayload = modelPreferencePayload([primaryModelId, secondaryModelId]);
    await putJson(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      preferencePayload,
      owner.cookie
    );
    const before = await getJson<Record<string, unknown>>(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      owner.cookie
    );

    const conversationId = await firstConversationId(app, owner);
    const response = await sendMessage(app, owner, conversationId, "reply-msg-0002");

    expect(response.statusCode).toBe(200);
    expect(prompts).toHaveLength(1);

    const after = await getJson<Record<string, unknown>>(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      owner.cookie
    );
    expect(after).toEqual(before);

    await app.close();
  });

  it("executes successfully for a second device with no re-selection of the agent and no new model install", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    const adapter = healthyAdapter(primaryModelId, { prompts });
    const store = createCp2Store({
      executionFabricEnabled: true,
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === primaryModelId && executionTarget === "backend" ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700003003", "Multi-Device Shop");
    await putJson(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      modelPreferencePayload([primaryModelId]),
      owner.cookie
    );
    const conversationId = await firstConversationId(app, owner);

    const firstDeviceResponse = await sendMessage(app, owner, conversationId, "device-a-0001", {
      "x-soko-device-id": "device-a"
    });
    const secondDeviceResponse = await sendMessage(app, owner, conversationId, "device-b-0001", {
      "x-soko-device-id": "device-b"
    });

    expect(firstDeviceResponse.statusCode).toBe(200);
    expect(secondDeviceResponse.statusCode).toBe(200);
    expect(prompts).toHaveLength(2);
    // Neither device ever created a legacy binding or a device-scoped model assignment - the
    // planner path never touches either table.
    expect(await getBinding(app, owner)).toBeNull();

    await app.close();
  });

  it("honors the existing per-message idempotency key through the planner path - a retried clientMessageId never re-executes the model", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    const adapter = healthyAdapter(primaryModelId, { prompts });
    const store = createCp2Store({
      executionFabricEnabled: true,
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === primaryModelId && executionTarget === "backend" ? adapter : undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700003004", "Idempotent Shop");
    await putJson(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      modelPreferencePayload([primaryModelId]),
      owner.cookie
    );
    const conversationId = await firstConversationId(app, owner);

    const first = await sendMessage(app, owner, conversationId, "retry-msg-0001");
    const retried = await sendMessage(app, owner, conversationId, "retry-msg-0001");

    expect(first.statusCode).toBe(200);
    expect(retried.statusCode).toBe(200);
    expect(retried.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(prompts).toHaveLength(1);

    await app.close();
  });

  it("returns AGENT_MODEL_UNAVAILABLE when the planner accepts a candidate but no adapter can ever execute it", async () => {
    const store = createCp2Store({
      executionFabricEnabled: true,
      modelRuntimeAdapterResolver: () => undefined
    });
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700003005", "No Adapter Shop");
    await putJson(
      app,
      `/businesses/${owner.businessId}/model-preference`,
      modelPreferencePayload([primaryModelId]),
      owner.cookie
    );
    const conversationId = await firstConversationId(app, owner);

    const response = await sendMessage(app, owner, conversationId, "no-adapter-0001");
    // Matches the existing legacy convention (tests/model-activation-runtime.test.ts, "persists
    // retry and approved-fallback guidance..."): a retryable AGENT_MODEL_UNAVAILABLE is caught and
    // turned into a graceful, persisted chat reply rather than a raw 5xx - the flagged path must
    // trigger the same degradation UX, not a divergent one.
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ processing: { errorCode: string; retryable: boolean } }>().processing
    ).toMatchObject({ errorCode: "AGENT_MODEL_UNAVAILABLE", retryable: true });

    await app.close();
  });
});

function modelPreferencePayload(preferredModelIds: string[]) {
  return {
    preferredModelIds,
    fallbackModelIds: [],
    requiredCapabilities: [],
    executionPreference: "balanced",
    qualityPreference: "balanced",
    allowCloudFallback: false,
    maxCostPerRequest: null,
    maxLatencyMs: null,
    minimumContextWindow: null
  };
}

function healthyAdapter(
  modelId: string,
  options: { prompts?: RuntimeModelPrompt[] } = {}
): ModelRuntimeAdapter {
  return {
    provider: "test",
    executionTarget: "backend",
    async canRun() {
      return { available: true, errorCode: null, message: null };
    },
    async healthCheck() {
      return {
        available: true,
        modelId,
        provider: "test",
        executionTarget: "backend",
        latencyMs: 4,
        responsePreview: "SOKO_MODEL_OK",
        errorCode: null,
        message: null,
        retryable: false
      };
    },
    async generate({ prompt }) {
      options.prompts?.push(prompt);
      return {
        text: JSON.stringify({ type: "response", message: "market" }),
        modelId,
        provider: "test",
        executionTarget: "backend",
        latencyMs: 8
      };
    }
  };
}

async function firstConversationId(
  app: ReturnType<typeof buildApi>,
  owner: { businessId: string; cookie: string }
): Promise<string> {
  const conversations = await getJson<{ conversations: Array<{ id: string }> }>(
    app,
    "/v1/conversations",
    owner.cookie
  );
  const conversationId = conversations.conversations[0]?.id;
  if (conversationId === undefined) throw new Error("Expected a default conversation.");
  return conversationId;
}

async function sendMessage(
  app: ReturnType<typeof buildApi>,
  owner: { businessId: string; cookie: string },
  conversationId: string,
  clientMessageId: string,
  extraHeaders: Record<string, string> = {}
) {
  return app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { ...jsonHeaders(owner.cookie), ...extraHeaders },
    payload: JSON.stringify({
      conversationId,
      clientMessageId,
      content: { type: "text", text: "Reply with the word market" },
      clientTimestamp: new Date().toISOString(),
      agent: {
        businessId: owner.businessId,
        message: "Reply with the word market"
      }
    })
  });
}

async function getBinding(
  app: ReturnType<typeof buildApi>,
  owner: { businessId: string; cookie: string }
): Promise<AgentModelBindingSummary | null> {
  const response = await app.inject({
    method: "GET",
    url: `/api/agents/${owner.businessId}/model-binding?shopId=${owner.businessId}`,
    headers: { cookie: owner.cookie }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ binding: AgentModelBindingSummary | null }>().binding;
}

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  contact: string,
  name: string
): Promise<{ businessId: string; cookie: string }> {
  const signup = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: jsonHeaders(),
    payload: JSON.stringify({ method: "phone", contact, pin: "1234" })
  });
  expect(signup.statusCode).toBe(200);
  const cookie = sessionCookie(signup.headers["set-cookie"]);
  const business = await app.inject({
    method: "POST",
    url: "/businesses",
    headers: jsonHeaders(cookie),
    payload: JSON.stringify({ name, language: "en" })
  });
  expect(business.statusCode).toBe(200);
  return {
    businessId: business.json<{ business: { id: string } }>().business.id,
    cookie
  };
}

async function getJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<T> {
  const response = await app.inject({ method: "GET", url, headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

async function putJson(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie: string
): Promise<void> {
  const response = await app.inject({
    method: "PUT",
    url,
    headers: jsonHeaders(cookie),
    payload: JSON.stringify(payload)
  });
  expect(response.statusCode).toBe(200);
}

function jsonHeaders(cookie?: string) {
  return {
    "content-type": "application/json",
    ...(cookie === undefined ? {} : { cookie })
  };
}

function sessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) throw new Error("Expected a session cookie.");
  return value.split(";")[0] ?? value;
}
