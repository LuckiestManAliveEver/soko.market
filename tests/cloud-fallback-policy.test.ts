import { describe, expect, it, vi } from "vitest";
import type { RuntimeModelPrompt } from "../packages/shared-types/src";
import { createCloudFallbackProvider } from "../services/api/src/inference/cloud-fallback";

describe("cloud fallback policy", () => {
  it("is absent unless enabled, keyed, and allow-listed", () => {
    const base = {
      enabled: true,
      apiKey: "server-secret",
      model: "gpt-test",
      modelId: "cloud-test",
      modelAllowlist: ["cloud-test"],
      maxOutputTokens: 16,
      monthlyTokenBudget: 1_000,
      timeoutMs: 1_000
    };
    expect(createCloudFallbackProvider({ ...base, enabled: false })).toBeUndefined();
    expect(createCloudFallbackProvider({ ...base, apiKey: "" })).toBeUndefined();
    expect(createCloudFallbackProvider({ ...base, modelAllowlist: [] })).toBeUndefined();
    expect(createCloudFallbackProvider(base)).toBeDefined();
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });

  it("reads text from the raw Responses API output array", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"type":"response","message":"Cloud fallback completed."}'
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = createCloudFallbackProvider({
      enabled: true,
      apiKey: "server-secret",
      model: "gpt-test",
      modelId: "openai-fast",
      modelAllowlist: ["openai-fast"],
      maxOutputTokens: 16,
      monthlyTokenBudget: 1_000,
      timeoutMs: 1_000
    });

    try {
      const result = await provider?.complete({
        allowedTools: [],
        context: {} as RuntimeModelPrompt["context"],
        message: "Handle this request.",
        schemaVersion: "cp11-runtime-model-v1"
      });
      expect(result).toMatchObject({
        status: "available",
        outputText: '{"type":"response","message":"Cloud fallback completed."}',
        errorCode: null
      });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
