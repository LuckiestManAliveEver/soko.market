import { describe, expect, it, vi } from "vitest";
import type {
  AgentModelBindingSummary,
  ModelExecutionTarget,
  NativeExecutionHostSummary,
  NativeRuntimeAgentSummary,
  NativeRuntimeBindingModelSummary,
  NativeRuntimeBindingSummary,
  NativeRuntimeModelSummary,
  ResolvedNativeRuntimeBinding,
  ResolvedNativeRuntimeModel,
  RuntimeModelProvider,
  ShopAgentRuntime
} from "../packages/shared-types/src";
import { isModelExecutionTarget, modelExecutionTargets } from "../packages/shared-types/src";
import { Cp2Error } from "../services/api/src/cp2/cp2-error";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import {
  resolveExecutionTarget,
  resolveNativeRuntimeModelProvider
} from "../services/api/src/cp2/domains/agent-runtime/native-runtime-routing";
import type { ModelRuntimeAdapter } from "../services/api/src/inference/model-runtime";

const modelId = "qwen2.5-0.5b-android";
const agentId = "agent-1";
const shopId = "shop-1";

describe("resolveExecutionTarget - the single authoritative execution-target resolver", () => {
  it("prefers the selected native execution host over model-level compatibility metadata", () => {
    const resolution = resolveExecutionTarget({
      nativeResolution: nativeResolution({
        configuredTarget: "browser-local",
        hostType: "backend"
      }),
      legacyBinding: legacyBinding({ executionTarget: "backend" }),
      modelId,
      agentId
    });
    expect(resolution).toEqual({
      target: "backend",
      source: "explicit-native-host"
    });
  });

  it("never lets a legacy binding override an explicit native model target when no host exists", () => {
    const resolution = resolveExecutionTarget({
      nativeResolution: nativeResolution({ configuredTarget: "installed-app" }),
      legacyBinding: legacyBinding({ executionTarget: "backend" }),
      modelId,
      agentId
    });
    expect(resolution.target).toBe("installed-app");
  });

  it("falls back to the resolved host's type when configuration.executionTarget is missing", () => {
    // Simulates a native model row written before configuration.executionTarget existed, or
    // restored from a partial snapshot - the durable host record is still a genuine signal.
    const resolution = resolveExecutionTarget({
      nativeResolution: nativeResolution({
        configuredTarget: undefined,
        hostType: "browser-local"
      }),
      legacyBinding: null,
      modelId,
      agentId
    });
    expect(resolution).toEqual({ target: "browser-local", source: "explicit-native-host" });
  });

  it("uses the legacy binding when there is no native resolution at all", () => {
    const resolution = resolveExecutionTarget({
      nativeResolution: null,
      legacyBinding: legacyBinding({ executionTarget: "browser-local" }),
      modelId,
      agentId
    });
    expect(resolution).toEqual({ target: "browser-local", source: "legacy-binding" });
  });

  it("exposes exactly the four provider-neutral targets and rejects provider names", () => {
    expect(modelExecutionTargets).toEqual([
      "backend",
      "browser-local",
      "installed-app",
      "remote-shop-device"
    ]);
    expect(isModelExecutionTarget("openai")).toBe(false);
    expect(isModelExecutionTarget("anthropic")).toBe(false);

    // @ts-expect-error Provider identifiers must never satisfy ModelExecutionTarget.
    const providerAsTarget: ModelExecutionTarget = "openai";
    expect(isModelExecutionTarget(providerAsTarget)).toBe(false);
  });

  it("rejects the legacy provider name at the HTTP execution-target boundary", async () => {
    const app = buildApi();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/agent-1/models/model-1/activate",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          shopId,
          executionTarget: "openai",
          executionMode: "CLOUD_ONLY",
          permissions: { allowInstalledApp: false, allowRemoteShopDevice: false }
        })
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "execution_target_invalid" });
    } finally {
      await app.close();
    }
  });

  it(
    "does not default native model resolution to backend when executionTarget is absent " +
      "(regression: never guess backend)",
    () => {
      for (const nr of [
        null,
        nativeResolution({ configuredTarget: undefined, hostType: undefined })
      ]) {
        expect(() =>
          resolveExecutionTarget({ nativeResolution: nr, legacyBinding: null, modelId, agentId })
        ).toThrow(Cp2Error);
        try {
          resolveExecutionTarget({ nativeResolution: nr, legacyBinding: null, modelId, agentId });
          expect.unreachable();
        } catch (error) {
          expect(error).toBeInstanceOf(Cp2Error);
          const cp2Error = error as Cp2Error;
          expect(cp2Error.code).toBe("NO_COMPATIBLE_EXECUTION_TARGET");
          expect(cp2Error.code).not.toBe("backend");
          expect(cp2Error.details).toMatchObject({ modelId, agentId });
        }
      }
    }
  );
});

describe("resolveNativeRuntimeModelProvider - adapter wiring around the resolved target", () => {
  const shopRuntime = { agentId, shopId } as unknown as ShopAgentRuntime;

  it("routes an explicit backend target to a backend adapter when a host is eligible", () => {
    const adapter = fakeAdapter("backend");
    const requireAdapter = vi.fn(() => adapter);
    const result = resolveNativeRuntimeModelProvider({
      shopRuntime,
      requestedModelId: modelId,
      legacyBinding: legacyBinding({ executionTarget: "backend" }),
      nativeResolution: null,
      requireAdapter,
      adapterResolverConfigured: true
    });
    expect(result.executionTarget).toBe("backend");
    expect(result.resolutionSource).toBe("legacy-binding");
    expect(requireAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ modelId, executionTarget: "backend", agentId })
    );
    expect(result.provider).toBeDefined();
  });

  it(
    "never fails routing over an unresolved target when no adapter system is even wired up " +
      "(regression: broke every test harness that drives runtimeModelProvider directly)",
    () => {
      const runtimeModelProvider = {
        name: "test",
        complete: vi.fn()
      } as unknown as RuntimeModelProvider;
      const requireAdapter = vi.fn(() => fakeAdapter("backend"));
      const result = resolveNativeRuntimeModelProvider({
        shopRuntime,
        requestedModelId: modelId,
        legacyBinding: null,
        nativeResolution: null,
        requireAdapter,
        adapterResolverConfigured: false,
        runtimeModelProvider
      });
      // adapterResolverConfigured: false means executionTarget is never used to route anything -
      // requireAdapter must never even be consulted, and the provider passed straight through comes
      // from runtimeModelProvider/runtimeModelProviderResolver regardless of whether a target could
      // be resolved at all.
      expect(requireAdapter).not.toHaveBeenCalled();
      expect(result.provider).toBe(runtimeModelProvider);
      expect(result.executionTarget).toBeUndefined();
      expect(result.resolutionSource).toBeNull();
    }
  );

  it("surfaces the RUNTIME_NOT_CONFIGURED code (no eligible host) when backend has no adapter", () => {
    const requireAdapter = vi.fn(() => {
      throw new Cp2Error(
        503,
        "RUNTIME_NOT_CONFIGURED",
        "The selected model runtime is not configured."
      );
    });
    expectCp2ErrorCode(
      () =>
        resolveNativeRuntimeModelProvider({
          shopRuntime,
          requestedModelId: modelId,
          legacyBinding: legacyBinding({ executionTarget: "backend" }),
          nativeResolution: null,
          requireAdapter,
          adapterResolverConfigured: true
        }),
      "RUNTIME_NOT_CONFIGURED"
    );
  });

  it("throws NO_COMPATIBLE_EXECUTION_TARGET before ever calling requireAdapter (no network attempt)", () => {
    const requireAdapter = vi.fn(() => fakeAdapter("backend"));
    expectCp2ErrorCode(
      () =>
        resolveNativeRuntimeModelProvider({
          shopRuntime,
          requestedModelId: modelId,
          legacyBinding: null,
          nativeResolution: null,
          requireAdapter,
          adapterResolverConfigured: true
        }),
      "NO_COMPATIBLE_EXECUTION_TARGET"
    );
    expect(requireAdapter).not.toHaveBeenCalled();
  });

  it("rejects installed-app/browser-local server-side without ever touching a backend adapter", () => {
    for (const target of ["installed-app", "browser-local"] as ModelExecutionTarget[]) {
      const requireAdapter = vi.fn((adapterInput: { executionTarget: ModelExecutionTarget }) => {
        // Mirrors requireModelRuntimeAdapter: the server can never execute these targets itself.
        throw new Cp2Error(
          adapterInput.executionTarget === "browser-local" ? 409 : 503,
          adapterInput.executionTarget === "browser-local"
            ? "BROWSER_RUNTIME_DISABLED"
            : "BRIDGE_UNAVAILABLE",
          "Client-local execution cannot be performed on the server."
        );
      });
      expectCp2ErrorCode(
        () =>
          resolveNativeRuntimeModelProvider({
            shopRuntime,
            requestedModelId: modelId,
            legacyBinding: legacyBinding({ executionTarget: target }),
            nativeResolution: null,
            requireAdapter,
            adapterResolverConfigured: true
          }),
        target === "browser-local" ? "BROWSER_RUNTIME_DISABLED" : "BRIDGE_UNAVAILABLE"
      );
      expect(requireAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ executionTarget: target })
      );
    }
  });

  it("uses a hosted fallback when a local-first primary cannot execute in the API process", () => {
    const localFirst = nativeResolution({
      configuredTarget: "browser-local",
      hostType: "browser-local"
    });
    const hosted = nativeResolution({ configuredTarget: "backend", hostType: "backend" }).primary;
    hosted.bindingModel = {
      ...hosted.bindingModel,
      id: "role-hosted-fallback",
      role: "fallback",
      executionHostId: "host-backend"
    };
    hosted.host = hosted.host === null ? null : { ...hosted.host, id: "host-backend" };
    localFirst.fallbacks = [hosted];

    const requireAdapter = vi.fn(() => fakeAdapter("backend"));
    const result = resolveNativeRuntimeModelProvider({
      shopRuntime,
      requestedModelId: modelId,
      legacyBinding: legacyBinding({ executionTarget: "browser-local" }),
      nativeResolution: localFirst,
      requireAdapter,
      adapterResolverConfigured: true,
      eligibleExecutionTargets: new Set(["backend"])
    });

    expect(result.executionTarget).toBe("backend");
    expect(result.fallbackIndex).toBe(1);
    expect(requireAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ modelId, executionTarget: "backend", agentId })
    );
  });

  it("falls back to a working legacy binding when every native role is ineligible from this request", () => {
    // The native binding's only role targets browser-local, which a server request can never
    // execute - eligibleExecutionTargets filters it out entirely, leaving no native candidate. A
    // still-usable legacy binding must get the request instead of a hard RUNTIME_MODELS_UNAVAILABLE.
    const localOnly = nativeResolution({ configuredTarget: "browser-local", hostType: "browser-local" });

    const requireAdapter = vi.fn(() => fakeAdapter("backend"));
    const result = resolveNativeRuntimeModelProvider({
      shopRuntime,
      requestedModelId: modelId,
      legacyBinding: legacyBinding({ executionTarget: "backend" }),
      nativeResolution: localOnly,
      requireAdapter,
      adapterResolverConfigured: true,
      eligibleExecutionTargets: new Set(["backend"])
    });

    expect(result.executionTarget).toBe("backend");
    expect(result.resolutionSource).toBe("legacy-binding");
    expect(result.provider).toBeDefined();
  });

  it("still terminates once both the native graph and the legacy binding are exhausted", () => {
    const localOnly = nativeResolution({ configuredTarget: "browser-local", hostType: "browser-local" });
    const requireAdapter = vi.fn(() => fakeAdapter("backend"));
    const binding = legacyBinding({ executionTarget: "backend" });
    const firstAttempt = resolveNativeRuntimeModelProvider({
      shopRuntime,
      requestedModelId: modelId,
      legacyBinding: binding,
      nativeResolution: localOnly,
      requireAdapter,
      adapterResolverConfigured: true,
      eligibleExecutionTargets: new Set(["backend"])
    });
    expect(firstAttempt.runtimeKey).not.toBeNull();

    expectCp2ErrorCode(
      () =>
        resolveNativeRuntimeModelProvider({
          shopRuntime,
          requestedModelId: modelId,
          legacyBinding: binding,
          nativeResolution: localOnly,
          requireAdapter,
          adapterResolverConfigured: true,
          eligibleExecutionTargets: new Set(["backend"]),
          attemptedRuntimeKeys: new Set([firstAttempt.runtimeKey as string])
        }),
      "RUNTIME_MODELS_UNAVAILABLE"
    );
  });
});

describe("zero-setup hosted-first runtime provisioning", () => {
  it("provisions a verified generic backend binding for first chat without manual activation", async () => {
    const backendGenerate = vi.fn(async () => ({
      text: JSON.stringify({ type: "response", message: "Soko AI is ready." }),
      modelId,
      provider: "test-hosted-adapter",
      executionTarget: "backend" as const,
      latencyMs: 2
    }));
    const store = createCp2Store({
      modelRuntimeAdapterResolver: ({ executionTarget }) =>
        executionTarget === "backend"
          ? {
              provider: "test",
              executionTarget: "backend",
              canRun: async () => ({ available: true, errorCode: null, message: null }),
              healthCheck: async () => {
                throw new Error("not used in this test");
              },
              generate: backendGenerate
            }
          : undefined
    });
    const app = buildApi({ cp2: { store } });

    const signup = await app.inject({
      method: "POST",
      url: "/auth/pin/signup",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ method: "phone", contact: "+254700009001", pin: "1234" })
    });
    expect(signup.statusCode).toBe(200);
    const setCookieHeader = signup.headers["set-cookie"];
    const rawCookie = (
      Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader
    ) as string;
    const cookie = rawCookie.split(";")[0] as string;

    const businessResponse = await app.inject({
      method: "POST",
      url: "/businesses",
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ name: "Fresh Shop", language: "en" })
    });
    expect(businessResponse.statusCode).toBe(200);
    const businessId = businessResponse.json<{ business: { id: string } }>().business.id;

    const conversation = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ kind: "personal", activeShopId: businessId })
    });
    expect(conversation.statusCode).toBe(200);
    const conversationId = conversation.json<{ conversation: { id: string } }>().conversation.id;

    const turn = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/runtime/turns`,
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ conversationId, message: "hello" })
    });

    expect(turn.statusCode).toBe(200);
    expect(backendGenerate).toHaveBeenCalledOnce();
    expect(turn.json()).toMatchObject({
      turn: {
        response: "Soko AI is ready.",
        model: {
          status: "available",
          modelId,
          executionTarget: "backend",
          fallbackIndex: 0
        }
      }
    });
    const provisioned = store
      .snapshot()
      .nativeRuntimeBindings.filter(
        (binding) =>
          binding.businessId === businessId &&
          binding.configuration.source === "zero-setup-provisioning"
      );
    expect(provisioned).toHaveLength(1);
    expect(provisioned[0]).toMatchObject({ status: "active", isDefault: true });
  });
});

function expectCp2ErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`expected a Cp2Error with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Cp2Error);
    expect((error as Cp2Error).code).toBe(code);
  }
}

function fakeAdapter(executionTarget: ModelExecutionTarget): ModelRuntimeAdapter {
  return {
    provider: "test",
    executionTarget,
    canRun: async () => ({ available: true, errorCode: null, message: null }),
    healthCheck: async () => ({
      available: true,
      modelId,
      provider: "test",
      executionTarget,
      latencyMs: 1,
      responsePreview: "ok",
      errorCode: null,
      message: null,
      retryable: false
    }),
    generate: async () => ({
      text: "{}",
      modelId,
      provider: "test",
      executionTarget,
      latencyMs: 1
    })
  };
}

function legacyBinding(
  overrides: Partial<AgentModelBindingSummary> = {}
): AgentModelBindingSummary {
  return {
    id: "binding-1",
    agentId,
    shopId,
    accountId: "account-1",
    modelId,
    status: "active",
    executionMode: "LOCAL_FIRST",
    executionTarget: "backend",
    permissions: {
      allowInstalledApp: false,
      allowRemoteShopDevice: false
    },
    activatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    lastVerificationStatus: "passed",
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides
  };
}

function nativeResolution(input: {
  configuredTarget?: ModelExecutionTarget;
  hostType?: ModelExecutionTarget;
}): ResolvedNativeRuntimeBinding {
  const agent: NativeRuntimeAgentSummary = {
    id: agentId,
    businessId: shopId,
    accountId: "account-1",
    name: "Test agent",
    provider: "soko",
    packageRef: null,
    version: "1",
    runtimeContractVersion: "1",
    capabilities: ["tools", "mcp"],
    configuration: {},
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const model: NativeRuntimeModelSummary = {
    id: modelId,
    name: "Test model",
    provider: "ollama",
    providerModelId: modelId,
    runtimeContractVersion: "1",
    capabilities: ["chat", "tool-routing"],
    configuration:
      input.configuredTarget === undefined ? {} : { executionTarget: input.configuredTarget },
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const host: NativeExecutionHostSummary | null =
    input.hostType === undefined
      ? null
      : {
          id: "host-1",
          businessId: shopId,
          accountId: "account-1",
          type: input.hostType,
          name: "Test host",
          endpoint: null,
          status: "available",
          capabilities: [input.hostType],
          configuration: {},
          credentialReference: null,
          lastKnownHealthyAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
  const bindingModel: NativeRuntimeBindingModelSummary = {
    id: "role-1",
    runtimeBindingId: "runtime-binding-1",
    modelId,
    role: "primary",
    priority: 0,
    executionHostId: host?.id ?? null,
    configuration: {},
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const selected: ResolvedNativeRuntimeModel = {
    bindingModel,
    model,
    installation:
      host === null
        ? null
        : {
            id: "installation-1",
            modelId,
            executionHostId: host.id,
            status: "available",
            configuration: {},
            lastKnownHealthyAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
    host,
    available: true,
    unavailabilityReason: null
  };
  const binding: NativeRuntimeBindingSummary = {
    id: "runtime-binding-1",
    businessId: shopId,
    accountId: "account-1",
    agentId,
    name: "Test runtime",
    status: "active",
    isDefault: false,
    configuration: {},
    runtimeContractVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1"
  };
  return {
    conversationId: "conversation-1",
    usedGlobalDefault: false,
    binding,
    agent,
    primary: selected,
    fallbacks: [],
    auxiliaries: {},
    selected,
    fallbackUsed: false,
    fallbackReason: null,
    configuration: {}
  };
}
