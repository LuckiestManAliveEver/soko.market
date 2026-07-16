import { describe, expect, it } from "vitest";
import type {
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "../packages/shared-types/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store, type BusinessAgentProfileSummary } from "../services/api/src/cp2/store";

describe("business agent settings", () => {
  it("persists the complete settings profile and uses it for server-side runtime turns", async () => {
    let capturedPrompt: RuntimeModelPrompt | null = null;
    const provider: RuntimeModelProvider = {
      name: "test",
      async complete(prompt): Promise<RuntimeModelCompletionResult> {
        capturedPrompt = prompt;
        return {
          provider: "test",
          status: "available",
          outputText: JSON.stringify({
            type: "response",
            message: "Focus on the highest-priority shop task."
          }),
          durationMs: 1,
          errorCode: null,
          metadata: {}
        };
      }
    };
    const store = createCp2Store({ runtimeModelProvider: provider });
    const app = buildApi({ cp2: { store } });
    const { businessId, cookie } = await createOwnerBusiness(app);

    const defaultProfileResponse = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}/agent-profile`,
      headers: { cookie }
    });
    expect(defaultProfileResponse.statusCode).toBe(200);
    expect(defaultProfileResponse.json<BusinessAgentProfileSummary>()).toMatchObject({
      businessId,
      modelId: "qwen2.5-0.5b-android",
      status: "active"
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/businesses/${businessId}/agent-profile`,
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({
        name: "Kiboko Shop Agent",
        description: "A database-backed shop attendant.",
        modelId: "smollm2-360m-android",
        role: "Stock and customer operations lead",
        language: "sw",
        personality: "Direct, calm, and careful with stock commitments",
        instructions: "Prioritize stock accuracy and ask before making risky changes.",
        knowledge: "The shop serves walk-in and delivery customers.",
        tools: ["Products", "Customers"],
        integrations: ["Soko.market storefront"],
        contextScripts: ["# Store policy\n- rule: confirm delivery promises with the owner"],
        status: "active"
      })
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json<BusinessAgentProfileSummary>()).toMatchObject({
      businessId,
      name: "Kiboko Shop Agent",
      modelId: "smollm2-360m-android",
      language: "sw",
      personality: "Direct, calm, and careful with stock commitments"
    });
    expect(store.snapshot().agentProfiles).toHaveLength(1);
    expect(store.snapshot().activeAiModels?.[0]?.modelId).toBe("smollm2-360m-android");

    const reloadResponse = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}/agent-profile`,
      headers: { cookie }
    });
    expect(reloadResponse.json<BusinessAgentProfileSummary>()).toEqual(
      updateResponse.json<BusinessAgentProfileSummary>()
    );

    const runtimeResponse = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({
        message: "What should I focus on today?"
      })
    });
    expect(runtimeResponse.statusCode).toBe(200);
    expect(capturedPrompt?.message).toContain(
      "Agent behavior: Direct, calm, and careful with stock commitments."
    );
    expect(capturedPrompt?.message).toContain(
      "Agent responsibilities: Prioritize stock accuracy and ask before making risky changes."
    );

    await app.close();
  });

  it("rejects unavailable models without replacing the saved profile", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, cookie } = await createOwnerBusiness(app);

    const response = await app.inject({
      method: "PUT",
      url: `/businesses/${businessId}/agent-profile`,
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({
        name: "Shop Agent",
        description: "Business attendant",
        modelId: "missing-model",
        role: "Business assistant",
        language: "en",
        personality: "Helpful",
        instructions: "Help the owner.",
        knowledge: "Use saved shop records.",
        tools: [],
        integrations: [],
        contextScripts: [],
        status: "active"
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "ai_model_unavailable" });
    expect(store.snapshot().agentProfiles).toEqual([]);

    await app.close();
  });
});

async function createOwnerBusiness(app: ReturnType<typeof buildApi>): Promise<{
  businessId: string;
  cookie: string;
}> {
  const otpResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      channel: "phone",
      destination: "+254700000991"
    })
  });
  const otp = otpResponse.json<{ challengeId: string; devOtp: string }>();
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      challengeId: otp.challengeId,
      code: otp.devOtp
    })
  });
  const setCookie = verifyResponse.headers["set-cookie"];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (cookieValue === undefined) {
    throw new Error("Expected an authenticated session cookie.");
  }
  const cookie = cookieValue.split(";")[0] ?? cookieValue;
  const businessResponse = await app.inject({
    method: "POST",
    url: "/businesses",
    headers: { "content-type": "application/json", cookie },
    payload: JSON.stringify({
      name: "Kiboko Traders",
      language: "en"
    })
  });

  return {
    businessId: businessResponse.json<{ business: { id: string } }>().business.id,
    cookie
  };
}
