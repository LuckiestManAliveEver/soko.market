import { describe, expect, it, vi } from "vitest";
import type {
  RuntimeModelCompletionResult,
  RuntimeModelProvider,
  RuntimeModelProviderName
} from "../packages/shared-types/src";
import { createProviderModelAdapter } from "../services/api/src/inference/model-runtime";

describe("provider-neutral backend model routing", () => {
  it("serves different model providers through the same backend target", async () => {
    const providerA = fakeProvider("anthropic-compatible", "provider-a");
    const providerB = fakeProvider("custom-shop-provider", "provider-b");
    const adapters = new Map([
      [
        "backend:model-a",
        createProviderModelAdapter({
          modelId: "model-a",
          provider: providerA,
          executionTarget: "backend"
        })
      ],
      [
        "backend:model-b",
        createProviderModelAdapter({
          modelId: "model-b",
          provider: providerB,
          executionTarget: "backend"
        })
      ]
    ]);

    const adapterA = adapters.get("backend:model-a");
    const adapterB = adapters.get("backend:model-b");
    expect(adapterA?.executionTarget).toBe("backend");
    expect(adapterB?.executionTarget).toBe("backend");

    const prompt = {
      message: "hello",
      allowedTools: [],
      schemaVersion: "cp11-runtime-model-v1" as const
    };
    const resultA = await adapterA?.generate({
      context: { agentId: "agent", shopId: "shop", modelId: "model-a" },
      prompt
    });
    const resultB = await adapterB?.generate({
      context: { agentId: "agent", shopId: "shop", modelId: "model-b" },
      prompt
    });
    expect(resultA).toMatchObject({
      provider: "anthropic-compatible",
      executionTarget: "backend"
    });
    expect(resultB).toMatchObject({
      provider: "custom-shop-provider",
      executionTarget: "backend"
    });
    expect(providerA.complete).toHaveBeenCalledOnce();
    expect(providerB.complete).toHaveBeenCalledOnce();
  });
});

function fakeProvider(name: RuntimeModelProviderName, output: string): RuntimeModelProvider {
  return {
    name,
    complete: vi.fn(async (): Promise<RuntimeModelCompletionResult> => ({
      provider: name,
      status: "available",
      outputText: output,
      durationMs: 1,
      errorCode: null,
      metadata: {}
    }))
  };
}
