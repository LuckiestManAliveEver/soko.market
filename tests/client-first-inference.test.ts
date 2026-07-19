import { describe, expect, it, vi } from "vitest";
import type {
  DeviceInferenceCapabilities,
  InferenceProvider,
  InferenceRoutingPolicy
} from "../packages/shared-types/src/index";
import { readClientInferenceFeatureFlags } from "../apps/web/src/inference/feature-flags";
import { mapInferenceError } from "../apps/web/src/inference/error-mapping";
import {
  decideClientInferenceRoute,
  InferenceUnavailableError
} from "../apps/web/src/inference/router";
import {
  createNativeLlamaProvider,
  detectNativeLlamaBridge
} from "../apps/web/src/inference/native-bridge";

const capabilities: DeviceInferenceCapabilities = {
  webgpu: true,
  wasm: true,
  nativeBridge: false,
  ownerNodeReachable: false,
  online: true,
  estimatedMemoryClass: "medium",
  hardwareConcurrency: 8,
  cachedModelIds: ["model"]
};

const policy: InferenceRoutingPolicy = {
  priority: ["native-llama-cpp", "browser-webgpu", "browser-wasm", "owner-node", "cloud-fallback"],
  maximumFallbacks: 2,
  allowNativeBridge: true,
  allowOwnerNode: true,
  allowCloudFallback: false,
  requireCachedBrowserModelWhenOffline: true,
  privacyMode: "tenant-devices"
};

function provider(
  id: string,
  runtime: InferenceProvider["runtime"],
  available = true
): InferenceProvider {
  return {
    id,
    runtime,
    async isAvailable() {
      return available;
    },
    async supports() {
      return true;
    },
    async *generate() {}
  };
}

describe("client-first inference", () => {
  it("routes deterministically and bounds fallbacks", async () => {
    const route = await decideClientInferenceRoute({
      modelId: "model",
      capabilities,
      providers: [
        provider("wasm", "browser-wasm"),
        provider("webgpu", "browser-webgpu"),
        provider("owner", "owner-node")
      ],
      policy,
      nativePermission: false,
      cloudConsent: false
    });

    expect(route).toMatchObject({
      providerId: "webgpu",
      runtime: "browser-webgpu",
      fallbackProviderIds: ["wasm"]
    });
  });

  it("lets low-end tenant policy move an owner node ahead of WASM", async () => {
    const route = await decideClientInferenceRoute({
      modelId: "model",
      capabilities: {
        ...capabilities,
        webgpu: false,
        ownerNodeReachable: true,
        estimatedMemoryClass: "low"
      },
      providers: [provider("wasm", "browser-wasm"), provider("owner", "owner-node")],
      policy: {
        ...policy,
        priority: ["owner-node", "browser-wasm"],
        maximumFallbacks: 1
      },
      nativePermission: false,
      cloudConsent: false
    });

    expect(route.providerId).toBe("owner");
    expect(route.fallbackProviderIds).toEqual(["wasm"]);
  });

  it("uses a cached WASM model offline and rejects an uncached one", async () => {
    const wasm = provider("wasm", "browser-wasm");
    const route = await decideClientInferenceRoute({
      modelId: "model",
      capabilities: { ...capabilities, webgpu: false, online: false },
      providers: [wasm],
      policy,
      nativePermission: false,
      cloudConsent: false
    });
    expect(route.runtime).toBe("browser-wasm");

    await expect(
      decideClientInferenceRoute({
        modelId: "uncached",
        capabilities: { ...capabilities, webgpu: false, online: false },
        providers: [wasm],
        policy,
        nativePermission: false,
        cloudConsent: false
      })
    ).rejects.toBeInstanceOf(InferenceUnavailableError);
  });

  it("never selects cloud without both tenant policy and user consent", async () => {
    const cloud = provider("cloud", "cloud-fallback");
    await expect(
      decideClientInferenceRoute({
        modelId: "model",
        capabilities,
        providers: [cloud],
        policy: { ...policy, allowCloudFallback: true, privacyMode: "cloud-with-consent" },
        nativePermission: false,
        cloudConsent: false
      })
    ).rejects.toBeInstanceOf(InferenceUnavailableError);
  });

  it("keeps all new providers disabled unless their flags are explicit", () => {
    expect(readClientInferenceFeatureFlags({})).toMatchObject({
      clientFirst: false,
      browserWebGpu: false,
      browserWasm: false,
      nativeBridge: false,
      ownerNode: false,
      cloudFallback: false
    });
    expect(
      readClientInferenceFeatureFlags({
        VITE_INFERENCE_CLIENT_FIRST: "true",
        VITE_INFERENCE_BROWSER_WEBGPU_ENABLED: "true",
        VITE_INFERENCE_BROWSER_WASM_ENABLED: "true"
      })
    ).toMatchObject({ browserWebGpu: true, browserWasm: true, cloudFallback: false });
  });

  it("returns a safe unavailable native provider when no installed bridge exists", async () => {
    const native = createNativeLlamaProvider(detectNativeLlamaBridge(), true);
    expect(await native.isAvailable()).toBe(false);
    expect(await native.supports("model")).toBe(false);
  });

  it("maps private provider failures to bounded UI states", () => {
    expect(mapInferenceError({ code: "STORAGE_QUOTA_EXCEEDED" })).toBe("not-enough-storage");
    expect(mapInferenceError(new Error("private prompt contents"))).toBe("inference-unavailable");
    vi.restoreAllMocks();
  });
});
