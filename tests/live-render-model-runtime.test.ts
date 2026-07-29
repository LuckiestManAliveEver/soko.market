import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_LIVE_MODEL_RUNTIME_TEST === "true";

describe.skipIf(!enabled)("live Render and Neon model runtime", () => {
  it("probes, activates, reloads, and chats through the deployed Qwen binding", async () => {
    const apiUrl = required("SOKO_API_URL").replace(/\/+$/u, "");
    const inferenceUrl = required("SOKO_INFERENCE_URL").replace(/\/+$/u, "");
    const inferenceToken = required("INFERENCE_SERVICE_TOKEN");
    const sessionToken = required("SOKO_TEST_TOKEN");
    const agentId = required("SOKO_TEST_AGENT_ID");
    const shopId = required("SOKO_TEST_SHOP_ID");
    const modelId = process.env.SOKO_MODEL_ID?.trim() || "qwen2.5-0.5b-android";
    const cookie = sessionToken.includes("=") ? sessionToken : `soko_session=${sessionToken}`;

    const readiness = await request(`${inferenceUrl}/health/ready`, {
      authorization: `Bearer ${inferenceToken}`
    });
    expect(readiness.response.ok).toBe(true);
    expect(readiness.body).toMatchObject({ ok: true, engine: "ollama" });

    const probe = await request(
      `${inferenceUrl}/v1/models/${encodeURIComponent(modelId)}/probe`,
      { authorization: `Bearer ${inferenceToken}` },
      "POST"
    );
    expect(probe.response.ok).toBe(true);
    expect(probe.body).toMatchObject({
      ok: true,
      modelId,
      providerModelId: "qwen2.5:0.5b"
    });

    const activation = await request(
      `${apiUrl}/api/agents/${encodeURIComponent(agentId)}/models/${encodeURIComponent(
        modelId
      )}/activate`,
      { cookie, "content-type": "application/json" },
      "POST",
      {
        shopId,
        executionTarget: "backend",
        executionMode: "LOCAL_FIRST",
        fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
        permissions: {
          allowInstalledApp: false,
          allowRemoteShopDevice: false,
          allowOpenAIFallback: false
        },
        fallbackModelId: null
      }
    );
    expect(activation.response.ok).toBe(true);
    expect(activation.body).toMatchObject({
      binding: {
        agentId,
        shopId,
        modelId,
        status: "active",
        lastVerificationStatus: "passed"
      }
    });

    const binding = await request(
      `${apiUrl}/api/agents/${encodeURIComponent(
        agentId
      )}/model-binding?shopId=${encodeURIComponent(shopId)}`,
      { cookie }
    );
    expect(binding.body).toMatchObject({
      binding: { modelId, status: "active", lastVerificationStatus: "passed" }
    });

    const chat = await request(
      `${apiUrl}/businesses/${encodeURIComponent(shopId)}/runtime/turns`,
      { cookie, "content-type": "application/json" },
      "POST",
      { message: "Reply briefly with the name of the model serving this agent." }
    );
    expect(chat.response.ok).toBe(true);
    expect(chat.body).toMatchObject({
      turn: {
        model: {
          modelId,
          providerModelId: "qwen2.5:0.5b",
          executionTarget: "backend"
        }
      }
    });
    expect(chat.body?.turn?.model?.inferenceRequestId).toEqual(expect.any(String));
  }, 180_000);
});

async function request(
  url: string,
  headers: Record<string, string>,
  method = "GET",
  body?: unknown
): Promise<{ response: Response; body: LiveResponse | null }> {
  const response = await fetch(url, {
    method,
    headers: { accept: "application/json", "x-request-id": randomUUID(), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    response,
    body: (await response.json().catch(() => null)) as LiveResponse | null
  };
}

interface LiveResponse {
  ok?: boolean;
  engine?: string;
  modelId?: string;
  providerModelId?: string;
  binding?: {
    agentId?: string;
    shopId?: string;
    modelId?: string;
    status?: string;
    lastVerificationStatus?: string;
  };
  turn?: {
    model?: {
      modelId?: string;
      providerModelId?: string;
      executionTarget?: string;
      inferenceRequestId?: string;
    };
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} is required for the live runtime test.`);
  return value;
}
