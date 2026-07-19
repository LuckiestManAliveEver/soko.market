import { describe, expect, it, vi } from "vitest";
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
});
