import type { DeviceInferenceCapabilities, InferenceMemoryClass } from "@soko/shared-types";
import type { BrowserInferenceCapability } from "../browser-inference-types";
import type { NativeLlamaBridge } from "./native-bridge";

export function normalizeDeviceInferenceCapabilities(input: {
  browser: BrowserInferenceCapability;
  cachedModelIds: string[];
  nativeBridgeAvailable: boolean;
  browserGgufAvailable?: boolean;
  browserGgufWebGpu?: boolean;
  ownerNodeReachable: boolean;
  online: boolean;
}): DeviceInferenceCapabilities {
  return {
    webgpu:
      (input.browser.supported && input.browser.backend === "webgpu") ||
      input.browserGgufWebGpu === true,
    wasm:
      (input.browser.supported && input.browser.backend !== "none") ||
      input.browserGgufAvailable === true,
    nativeBridge: input.nativeBridgeAvailable,
    ownerNodeReachable: input.ownerNodeReachable,
    online: input.online,
    estimatedMemoryClass: memoryClass(input.browser),
    hardwareConcurrency: input.browser.logicalProcessors,
    cachedModelIds: [...new Set(input.cachedModelIds)].sort()
  };
}

export async function detectDeviceInferenceCapabilities(input: {
  inspectBrowser: () => Promise<BrowserInferenceCapability>;
  listCachedModelIds: () => Promise<string[]>;
  nativeBridge: NativeLlamaBridge;
  ownerNodeReachable: () => Promise<boolean>;
  online?: boolean;
}): Promise<DeviceInferenceCapabilities> {
  const [browser, cachedModelIds, nativeStatus, ownerNodeReachable] = await Promise.all([
    input.inspectBrowser(),
    input.listCachedModelIds().catch(() => []),
    input.nativeBridge.getStatus().catch(() => ({ available: false })),
    input.ownerNodeReachable().catch(() => false)
  ]);
  return normalizeDeviceInferenceCapabilities({
    browser,
    cachedModelIds,
    nativeBridgeAvailable: nativeStatus.available,
    ownerNodeReachable,
    online: input.online ?? navigator.onLine
  });
}

function memoryClass(browser: BrowserInferenceCapability): InferenceMemoryClass {
  if (browser.estimatedMemoryGb !== undefined) {
    if (browser.estimatedMemoryGb >= 8) return "high";
    if (browser.estimatedMemoryGb >= 4) return "medium";
    return "low";
  }
  return browser.deviceTier;
}
