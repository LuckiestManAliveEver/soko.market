import { afterEach, describe, expect, it } from "vitest";
import type { AgentModelActivationResult, NativeRuntimeBindingSummary } from "../packages/shared-types/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { ModelRuntimeAdapter } from "../services/api/src/inference/model-runtime";

// Covers the write path for "bill this agent's inference to my own connected Hugging Face account
// instead of the platform's" (POST /api/agents/:agentId/model-binding/billing-mode), and its read
// counterpart (native-runtime-routing.ts's resolveOwnAccountCredential, unit-tested separately in
// tests/native-runtime-execution-target-resolution.test.ts). This is the missing piece named as an
// outstanding limitation in docs/implementation/huggingface-model-switching-report.md.

describe("agent model billing mode (BYO Hugging Face inference credential)", () => {
  const previousFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = previousFetch;
  });

  function mockHuggingFaceValid() {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://huggingface.co/api/whoami-v2") {
        return new Response(
          JSON.stringify({ id: "hf-user-1", name: "hf-owner", auth: { accessToken: { role: "write" } } }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }) as typeof fetch;
  }

  function healthyHuggingFaceAdapter(): ModelRuntimeAdapter {
    return {
      provider: "remote-chat-completions",
      executionTarget: "backend",
      async canRun() {
        return { available: true, errorCode: null, message: null };
      },
      async healthCheck() {
        return {
          available: true,
          modelId: "qwen3-4b",
          provider: "remote-chat-completions",
          executionTarget: "backend",
          latencyMs: 3,
          responsePreview: "ok",
          errorCode: null,
          message: null,
          retryable: false
        };
      },
      async generate() {
        return {
          text: JSON.stringify({ type: "response", message: "hi" }),
          modelId: "qwen3-4b",
          provider: "remote-chat-completions",
          executionTarget: "backend",
          latencyMs: 5
        };
      }
    };
  }

  function jsonHeaders(cookie?: string) {
    return {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie })
    };
  }

  async function createOwnerBusiness(
    app: ReturnType<typeof buildApi>,
    contact: string
  ): Promise<{ businessId: string; cookie: string }> {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/pin/signup",
      headers: jsonHeaders(),
      payload: JSON.stringify({ method: "phone", contact, pin: "1234" })
    });
    expect(signup.statusCode).toBe(200);
    const setCookie = signup.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0] as string;
    const business = await app.inject({
      method: "POST",
      url: "/businesses",
      headers: jsonHeaders(cookie),
      payload: JSON.stringify({ name: "BYO Shop", language: "en" })
    });
    expect(business.statusCode).toBe(200);
    return { businessId: business.json<{ business: { id: string } }>().business.id, cookie };
  }

  async function activateQwen3(
    app: ReturnType<typeof buildApi>,
    owner: { businessId: string; cookie: string }
  ): Promise<AgentModelActivationResult> {
    const response = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/models/qwen3-4b/activate`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({
        shopId: owner.businessId,
        executionTarget: "backend",
        executionMode: "LOCAL_FIRST",
        costResponsibility: "merchant",
        permissions: { allowRemoteShopDevice: false }
      })
    });
    expect(response.statusCode).toBe(200);
    return response.json<AgentModelActivationResult>();
  }

  function storeWithHuggingFaceAdapter() {
    return createCp2Store({
      modelRuntimeAdapterResolver: ({ modelId, executionTarget }) =>
        modelId === "qwen3-4b" && executionTarget === "backend"
          ? healthyHuggingFaceAdapter()
          : undefined
    });
  }

  it("rejects own-account billing when the account has no inference-authorized connection", async () => {
    const app = buildApi({ cp2: { store: storeWithHuggingFaceAdapter() } });
    const owner = await createOwnerBusiness(app, "+254700003001");
    await activateQwen3(app, owner);

    const response = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/model-binding/billing-mode`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ shopId: owner.businessId, billingMode: "own-account" })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "INFERENCE_CREDENTIAL_NOT_AUTHORIZED" });

    await app.close();
  });

  it("accepts own-account billing once the account connects and authorizes a Hugging Face account, and it survives a model re-activation", async () => {
    mockHuggingFaceValid();
    const store = storeWithHuggingFaceAdapter();
    const app = buildApi({ cp2: { store } });
    const owner = await createOwnerBusiness(app, "+254700003002");
    await activateQwen3(app, owner);

    const connected = await app.inject({
      method: "POST",
      url: "/v1/external-connections/huggingface",
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ token: "hf_owner_token" })
    });
    expect(connected.statusCode).toBe(200);
    const connectionId = connected.json<{ id: string }>().id;

    const authorized = await app.inject({
      method: "POST",
      url: `/v1/external-connections/${connectionId}/inference-authorization`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ authorized: true })
    });
    expect(authorized.statusCode).toBe(200);

    const billingModeSet = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/model-binding/billing-mode`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ shopId: owner.businessId, billingMode: "own-account" })
    });
    expect(billingModeSet.statusCode).toBe(200);
    expect(billingModeSet.json<NativeRuntimeBindingSummary>().configuration).toMatchObject({
      billingMode: "own-account"
    });

    // Re-activating the same model (a routine health re-verification) must not silently reset the
    // billing-mode preference back to the platform default - regression test for the fix in
    // NativeRuntimeBindingStore.activateVerifiedModel. GET /api/agents/:agentId/model-binding
    // returns a projected AgentModelBindingSummary DTO with no `configuration` field, so this reads
    // the raw native runtime binding from the store snapshot instead, the same way
    // tests/model-activation-runtime.test.ts's activeNativeBindingsForAgent helper does.
    await activateQwen3(app, owner);
    const activeBinding = store
      .snapshot()
      .nativeRuntimeBindings.find(
        (binding) => binding.agentId === owner.businessId && binding.status === "active"
      );
    expect(activeBinding?.configuration).toMatchObject({ billingMode: "own-account" });

    // Switching back to platform billing always succeeds - an account can always opt back out.
    const revertedToPlatform = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/model-binding/billing-mode`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ shopId: owner.businessId, billingMode: "platform" })
    });
    expect(revertedToPlatform.statusCode).toBe(200);
    expect(revertedToPlatform.json<NativeRuntimeBindingSummary>().configuration).toMatchObject({
      billingMode: "platform"
    });

    await app.close();
  });

  it("rejects own-account billing when no model has ever been activated for this agent", async () => {
    const app = buildApi({ cp2: { store: storeWithHuggingFaceAdapter() } });
    const owner = await createOwnerBusiness(app, "+254700003003");

    const response = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/model-binding/billing-mode`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ shopId: owner.businessId, billingMode: "own-account" })
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "NATIVE_RUNTIME_BINDING_NOT_FOUND" });

    await app.close();
  });

  it("rejects an invalid billingMode value", async () => {
    const app = buildApi({ cp2: { store: storeWithHuggingFaceAdapter() } });
    const owner = await createOwnerBusiness(app, "+254700003004");

    const response = await app.inject({
      method: "POST",
      url: `/api/agents/${owner.businessId}/model-binding/billing-mode`,
      headers: jsonHeaders(owner.cookie),
      payload: JSON.stringify({ shopId: owner.businessId, billingMode: "bogus" })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid_billing_mode" });

    await app.close();
  });

  it("rejects an unauthenticated request", async () => {
    const app = buildApi({ cp2: { store: storeWithHuggingFaceAdapter() } });

    const response = await app.inject({
      method: "POST",
      url: "/api/agents/some-agent/model-binding/billing-mode",
      headers: jsonHeaders(),
      payload: JSON.stringify({ shopId: "some-shop", billingMode: "platform" })
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
