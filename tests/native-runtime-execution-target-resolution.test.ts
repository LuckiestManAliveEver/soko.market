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
import { Cp2Error } from "../services/api/src/cp2/cp2-error";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import {
  resolveExecutionTarget,
  resolveNativeRuntimeModelProvider
} from "../services/api/src/cp2/domains/agent-runtime/native-runtime-routing";
import { ModelRuntimeError, type ModelRuntimeAdapter } from "../services/api/src/inference/model-runtime";

const modelId = "qwen2.5-0.5b-android";
const agentId = "agent-1";
const shopId = "shop-1";

describe("resolveExecutionTarget - the single authoritative execution-target resolver", () => {
  it("prefers the native resolution's declared configuration.executionTarget", () => {
    const resolution = resolveExecutionTarget({
      nativeResolution: nativeResolution({ configuredTarget: "browser-local", hostType: "backend" }),
      legacyBinding: legacyBinding({ executionTarget: "backend" }),
      modelId,
      agentId
    });
    expect(resolution).toEqual({ target: "browser-local", source: "explicit-native-configuration" });
  });

  it("never lets a legacy binding override an explicit native target", () => {
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
      nativeResolution: nativeResolution({ configuredTarget: undefined, hostType: "browser-local" }),
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

  it("uses the legacy binding when the native resolution has no usable target either", () => {
    const resolution = resolveExecutionTarget({
      nativeResolution: nativeResolution({ configuredTarget: undefined, hostType: undefined }),
      legacyBinding: legacyBinding({ executionTarget: "openai" }),
      modelId,
      agentId
    });
    expect(resolution).toEqual({ target: "openai", source: "legacy-binding" });
  });

  it(
    "does not default native model resolution to backend when executionTarget is absent " +
      "(regression: never guess backend)",
    () => {
      for (const nr of [null, nativeResolution({ configuredTarget: undefined, hostType: undefined })]) {
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
      const runtimeModelProvider = { name: "test", complete: vi.fn() } as unknown as RuntimeModelProvider;
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
      throw new Cp2Error(503, "RUNTIME_NOT_CONFIGURED", "The selected model runtime is not configured.");
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
});

describe("regression: fresh deployment never manufactures a backend dependency", () => {
  it(
    "a conversation with no native model configured and no legacy binding fails routing " +
      "instead of silently attempting backend inference",
    async () => {
      const backendGenerate = vi.fn(() => {
        throw new ModelRuntimeError("INFERENCE_SERVICE_UNREACHABLE", "unreachable", true);
      });
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

      // The old bug: this would resolve executionTarget to "backend" purely because nothing else
      // was configured, invoke the backend adapter, and surface a confusing "unreachable" error
      // even though no model was ever actually chosen. The fix must fail routing cleanly instead,
      // and must never have called the backend adapter to find that out.
      expect(backendGenerate).not.toHaveBeenCalled();
      expect(turn.statusCode).toBe(409);
      expect(turn.json()).toMatchObject({ code: "NO_COMPATIBLE_EXECUTION_TARGET" });
    }
  );
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

function legacyBinding(overrides: Partial<AgentModelBindingSummary> = {}): AgentModelBindingSummary {
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
