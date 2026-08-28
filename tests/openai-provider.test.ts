import { describe, expect, it, vi } from "vitest";
import type { RuntimeModelPrompt } from "../packages/shared-types/src";
import { createOpenAiProvider } from "../services/api/src/inference/openai-provider";

describe("OpenAI provider", () => {
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
    expect(createOpenAiProvider({ ...base, enabled: false })).toBeUndefined();
    expect(createOpenAiProvider({ ...base, apiKey: "" })).toBeUndefined();
    expect(createOpenAiProvider({ ...base, modelAllowlist: [] })).toBeUndefined();
    expect(createOpenAiProvider(base)).toBeDefined();
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
                  text: '{"type":"response","message":"OpenAI completion succeeded."}'
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = createOpenAiProvider({
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
        outputText: '{"type":"response","message":"OpenAI completion succeeded."}',
        errorCode: null
      });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
