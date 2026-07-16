import { describe, expect, it } from "vitest";
import {
  assessDeviceModelCapability,
  canRunCatalogModel,
  rankCatalogModelsForDevice
} from "../apps/web/src/ai-model-manager";

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

  it("ranks compatible Hugging Face and GitHub models by device fit", () => {
    const capability = assessDeviceModelCapability({
      deviceMemoryGb: 4,
      hardwareConcurrency: 6,
      quotaBytes: 4 * 1024 ** 3,
      usageBytes: 1 * 1024 ** 3
    });
    const ranked = rankCatalogModelsForDevice(
      [
        {
          id: "smol",
          label: "Smol",
          source: "huggingface" as const,
          downloadUrl: "https://huggingface.co/example/model.gguf",
          fileName: "model.gguf",
          fileSizeBytes: 380_000_000,
          license: "Apache-2.0",
          capabilities: ["chat", "offline"],
          minimumMemoryGb: 2,
          recommended: false
        },
        {
          id: "github:qwen",
          label: "GitHub Qwen",
          source: "github" as const,
          downloadUrl: "https://github.com/example/model/releases/download/v1/model.gguf",
          fileName: "model.gguf",
          fileSizeBytes: 490_000_000,
          license: "Apache-2.0",
          capabilities: ["chat", "offline", "multilingual", "instruction-following"],
          minimumMemoryGb: 3,
          recommended: true
        },
        {
          id: "large",
          label: "Large",
          source: "github" as const,
          downloadUrl: "https://github.com/example/model/releases/download/v1/large.gguf",
          fileName: "large.gguf",
          fileSizeBytes: 1_200_000_000,
          license: "Apache-2.0",
          capabilities: ["chat", "reasoning"],
          minimumMemoryGb: 6,
          recommended: false
        }
      ],
      capability
    );

    expect(ranked.map((entry) => entry.model.id)).toEqual(["github:qwen", "smol"]);
    expect(ranked[0]?.reasons).toEqual(
      expect.arrayContaining([
        "catalog recommended",
        "3 GB minimum fits reported RAM",
        "verified GitHub release asset"
      ])
    );
  });
});
