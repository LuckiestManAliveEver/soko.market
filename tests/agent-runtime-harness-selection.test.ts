import { describe, expect, it } from "vitest";

import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import type { ModelRuntimeAdapter } from "../services/api/src/inference/model-runtime";

const modelId = "smollm2-360m";

describe("agent runtime harness selection", () => {
  it("requires authentication and lists every registered adapter", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    try {
      const unauthenticated = await app.inject({
        method: "GET",
        url: "/v1/platform/agent-runtime-adapters"
      });
      expect(unauthenticated.statusCode).toBe(401);

      const actor = await createActorAndShop(app, "+254700009201", "Harness Shop");
      const listed = await app.inject({
        method: "GET",
        url: "/v1/platform/agent-runtime-adapters",
        headers: { cookie: actor.cookie }
      });
      expect(listed.statusCode).toBe(200);
      const adapters = listed
        .json<{ adapters: Array<{ id: string; displayName: string }> }>()
        .adapters.map((adapter) => adapter.id)
        .sort();
      expect(adapters).toEqual(["pi", "soko"]);
    } finally {
      await app.close();
    }
  });

  it("reports the platform default harness before any explicit activation", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    try {
      const actor = await createActorAndShop(app, "+254700009202", "Default Harness Shop");
      const harness = await app.inject({
        method: "GET",
        url: `/api/agents/${actor.businessId}/harness?shopId=${actor.businessId}`,
        headers: { cookie: actor.cookie }
      });
      expect(harness.statusCode).toBe(200);
      expect(harness.json()).toEqual({ agentRuntimeAdapterId: "pi" });
    } finally {
      await app.close();
    }
  });

  it("switches harness on explicit activation and preserves it on a later model-only activation", async () => {
    const generate = okGenerate();
    const store = createCp2Store({
      modelRuntimeAdapterResolver: () => adapter(generate)
    });
    const app = buildApi({ cp2: { store } });
    try {
      const actor = await createActorAndShop(app, "+254700009203", "Switch Harness Shop");

      const activated = await app.inject({
        method: "POST",
        url: `/api/agents/${actor.businessId}/models/${modelId}/activate`,
        headers: { "content-type": "application/json", cookie: actor.cookie },
        payload: JSON.stringify({
          shopId: actor.businessId,
          executionTarget: "backend",
          executionMode: "LOCAL_FIRST",
          agentRuntimeAdapterId: "soko",
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false }
        })
      });
      expect(activated.statusCode).toBe(200);

      const afterFirstActivation = await app.inject({
        method: "GET",
        url: `/api/agents/${actor.businessId}/harness?shopId=${actor.businessId}`,
        headers: { cookie: actor.cookie }
      });
      expect(afterFirstActivation.json()).toEqual({ agentRuntimeAdapterId: "soko" });

      // A later activation that only changes the model (no agentRuntimeAdapterId in the body) must
      // not silently reset the shop back to some other harness.
      const reactivatedSameModel = await app.inject({
        method: "POST",
        url: `/api/agents/${actor.businessId}/models/${modelId}/activate`,
        headers: { "content-type": "application/json", cookie: actor.cookie },
        payload: JSON.stringify({
          shopId: actor.businessId,
          executionTarget: "backend",
          executionMode: "CLOUD_ONLY",
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false }
        })
      });
      expect(reactivatedSameModel.statusCode).toBe(200);

      const afterSecondActivation = await app.inject({
        method: "GET",
        url: `/api/agents/${actor.businessId}/harness?shopId=${actor.businessId}`,
        headers: { cookie: actor.cookie }
      });
      expect(afterSecondActivation.json()).toEqual({ agentRuntimeAdapterId: "soko" });
    } finally {
      await app.close();
    }
  });

  it("rejects an unregistered harness with a clear error instead of silently accepting it", async () => {
    const store = createCp2Store({
      modelRuntimeAdapterResolver: () => adapter(okGenerate())
    });
    const app = buildApi({ cp2: { store } });
    try {
      const actor = await createActorAndShop(app, "+254700009204", "Bad Harness Shop");
      const response = await app.inject({
        method: "POST",
        url: `/api/agents/${actor.businessId}/models/${modelId}/activate`,
        headers: { "content-type": "application/json", cookie: actor.cookie },
        payload: JSON.stringify({
          shopId: actor.businessId,
          executionTarget: "backend",
          executionMode: "LOCAL_FIRST",
          agentRuntimeAdapterId: "not-a-real-adapter",
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false }
        })
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "AGENT_RUNTIME_ADAPTER_NOT_FOUND" });
    } finally {
      await app.close();
    }
  });

  it("rejects a malformed harness id at the request boundary", async () => {
    const app = buildApi({ cp2: { store: createCp2Store() } });
    try {
      const actor = await createActorAndShop(app, "+254700009205", "Malformed Harness Shop");
      const response = await app.inject({
        method: "POST",
        url: `/api/agents/${actor.businessId}/models/${modelId}/activate`,
        headers: { "content-type": "application/json", cookie: actor.cookie },
        payload: JSON.stringify({
          shopId: actor.businessId,
          executionTarget: "backend",
          executionMode: "LOCAL_FIRST",
          agentRuntimeAdapterId: "Not Valid!",
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false }
        })
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "agent_runtime_adapter_id_invalid" });
    } finally {
      await app.close();
    }
  });
});

function adapter(generate: ModelRuntimeAdapter["generate"]): ModelRuntimeAdapter {
  return {
    provider: "test-hosted-adapter",
    executionTarget: "backend",
    canRun: async () => ({ available: true, errorCode: null, message: null }),
    healthCheck: async () => ({
      available: true,
      modelId,
      provider: "test-hosted-adapter",
      executionTarget: "backend",
      latencyMs: 1,
      responsePreview: "SOKO_MODEL_OK",
      errorCode: null,
      message: null,
      retryable: false
    }),
    generate
  };
}

function okGenerate(): ModelRuntimeAdapter["generate"] {
  return async () => ({
    text: JSON.stringify({ type: "response", message: "ok" }),
    modelId,
    provider: "test-hosted-adapter",
    executionTarget: "backend" as const,
    latencyMs: 1
  });
}

async function createActorAndShop(app: ReturnType<typeof buildApi>, contact: string, name: string) {
  const signup = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ method: "phone", contact, pin: "1234" })
  });
  expect(signup.statusCode).toBe(200);
  const setCookie = signup.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0] as string;
  const businessResponse = await app.inject({
    method: "POST",
    url: "/businesses",
    headers: { "content-type": "application/json", cookie },
    payload: JSON.stringify({ name, language: "en" })
  });
  expect(businessResponse.statusCode).toBe(200);
  const businessId = businessResponse.json<{ business: { id: string } }>().business.id;
  return { cookie, businessId };
}
