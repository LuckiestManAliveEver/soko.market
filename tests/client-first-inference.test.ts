import { describe, expect, it, vi } from "vitest";
import type { InferenceProvider, InferenceRequest } from "../packages/shared-types/src/index";
import { executeInferenceRoute } from "../apps/web/src/inference/executor";
import { readClientInferenceFeatureFlags } from "../apps/web/src/inference/feature-flags";
import { mapInferenceError } from "../apps/web/src/inference/error-mapping";
import { createRemoteInferenceProvider } from "../apps/web/src/inference/remote-provider";

// The private on-device inference architecture (browser WebGPU/WASM, the installed-app native
// bridge, and the capability-based router that chose among them) was retired - see
// apps/web/src/inference/router.ts, inference/capabilities.ts, and inference/native-bridge.ts,
// all deleted. owner-node (a shop-owned, authenticated device registered as an execution host) is
// the one surviving client-side inference route, and it no longer needs a router: the chat send
// path (hooks/useChatRuntimeState.ts) builds its InferenceRouteDecision directly whenever
// owner-node is reachable, so this suite covers what remains - the provider-agnostic executor,
// error mapping, feature flags, and the owner-node provider factory itself.
describe("client-first inference", () => {
  it("keeps owner-node disabled by default and requires an explicit flag", () => {
    expect(readClientInferenceFeatureFlags({})).toMatchObject({
      ownerNode: false,
      maximumFallbacks: 3
    });
    expect(
      readClientInferenceFeatureFlags({
        VITE_INFERENCE_OWNER_NODE_ENABLED: "true",
        VITE_INFERENCE_MAX_FALLBACKS: "1"
      })
    ).toMatchObject({ ownerNode: true, maximumFallbacks: 1 });
  });

  it("maps private provider failures to bounded UI states", () => {
    expect(mapInferenceError({ code: "OWNER_NODE_UNREACHABLE" })).toBe("shop-device-offline");
    expect(mapInferenceError(new Error("private prompt contents"))).toBe("inference-unavailable");
    vi.restoreAllMocks();
  });

  it("builds an owner-node provider that reports availability and supported models", async () => {
    const provider = createRemoteInferenceProvider({
      id: "owner-node",
      runtime: "owner-node",
      endpoint: "https://api.example.test/v1/inference/owner-node/jobs",
      enabled: true,
      modelIds: ["smollm2-360m"]
    });
    expect(provider.id).toBe("owner-node");
    expect(provider.runtime).toBe("owner-node");
    expect(await provider.supports("smollm2-360m")).toBe(true);
    expect(await provider.supports("unregistered-model")).toBe(false);
  });

  it("reports an owner-node provider unavailable when disabled, without a network call", async () => {
    const provider = createRemoteInferenceProvider({
      id: "owner-node",
      runtime: "owner-node",
      endpoint: "https://api.example.test/v1/inference/owner-node/jobs",
      enabled: false,
      modelIds: ["smollm2-360m"]
    });
    expect(await provider.isAvailable()).toBe(false);
  });

  it("executes the selected provider and then its bounded fallback", async () => {
    const request: InferenceRequest = {
      requestId: "request-1",
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      agentId: "agent-1",
      modelId: "model",
      messages: [{ role: "user", content: "Hello" }]
    };
    const attempts: string[] = [];
    const failures: Array<{ id: string; state: string }> = [];
    const failing: InferenceProvider = {
      id: "owner-node-primary",
      runtime: "owner-node",
      isAvailable: async () => true,
      supports: async () => true,
      async *generate() {
        yield {
          requestId: request.requestId,
          text: "Partial owner-node response",
          done: false,
          runtime: "owner-node",
          modelId: request.modelId
        };
        throw new Error("owner-node device dropped the connection");
      }
    };
    const fallback: InferenceProvider = {
      id: "owner-node-secondary",
      runtime: "owner-node",
      isAvailable: async () => true,
      supports: async () => true,
      async *generate() {
        yield {
          requestId: request.requestId,
          text: "Fallback response",
          done: true,
          runtime: "owner-node",
          modelId: request.modelId
        };
      }
    };

    await expect(
      executeInferenceRoute({
        decision: {
          providerId: "owner-node-primary",
          runtime: "owner-node",
          modelId: request.modelId,
          reason: "The authenticated shop-owner device is reachable.",
          fallbackProviderIds: ["owner-node-secondary"]
        },
        providers: [fallback, failing],
        request,
        onAttempt: (candidate) => attempts.push(candidate.id),
        onFailure: (candidate, state) => failures.push({ id: candidate.id, state })
      })
    ).resolves.toMatchObject({
      providerId: "owner-node-secondary",
      runtime: "owner-node",
      text: "Fallback response",
      fallbackCount: 1
    });
    expect(attempts).toEqual(["owner-node-primary", "owner-node-secondary"]);
    expect(failures).toEqual([{ id: "owner-node-primary", state: "inference-unavailable" }]);
  });
});
