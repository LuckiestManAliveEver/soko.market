import { describe, expect, it } from "vitest";
import { assessDeviceModelCapability, canRunCatalogModel } from "../apps/web/src/ai-model-manager";

describe("Android AI model capability checks", () => {
  it("allows custom GGUF models only on high-capability devices with free storage", () => {
    const capable = assessDeviceModelCapability({
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      quotaBytes: 8 * 1024 ** 3,
      usageBytes: 2 * 1024 ** 3
    });
    expect(capable).toMatchObject({ level: "high", customModelsAllowed: true });

    const lowStorage = assessDeviceModelCapability({
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      quotaBytes: 3 * 1024 ** 3,
      usageBytes: 2 * 1024 ** 3
    });
    expect(lowStorage.customModelsAllowed).toBe(false);

    const unsupportedBrowser = assessDeviceModelCapability({
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
      quotaBytes: 8 * 1024 ** 3,
      usageBytes: 2 * 1024 ** 3,
      privateStorageSupported: false
    });
    expect(unsupportedBrowser.customModelsAllowed).toBe(false);
    expect(canRunCatalogModel(unsupportedBrowser, 2, 386_000_000)).toBe(false);
  });

  it("uses conservative catalog compatibility checks without rejecting unknown RAM", () => {
    const standard = assessDeviceModelCapability({
      deviceMemoryGb: 4,
      hardwareConcurrency: 6,
      quotaBytes: 4 * 1024 ** 3,
      usageBytes: 1 * 1024 ** 3
    });
    expect(canRunCatalogModel(standard, 3, 491_000_000)).toBe(true);
    expect(canRunCatalogModel(standard, 6, 1_120_000_000)).toBe(false);

    const unknownMemory = assessDeviceModelCapability({
      hardwareConcurrency: 4,
      quotaBytes: 4 * 1024 ** 3,
      usageBytes: 1 * 1024 ** 3
    });
    expect(canRunCatalogModel(unknownMemory, 3, 491_000_000)).toBe(true);
  });
});
