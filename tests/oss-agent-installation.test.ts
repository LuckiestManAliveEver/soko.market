import { describe, expect, it } from "vitest";
import type { OssAgentSummary } from "../packages/shared-types/src";

import {
  installOssAgentManifest,
  linkInstalledOssAgent,
  listInstalledOssAgentManifests,
  readDeviceOssAgentBinding
} from "../apps/web/src/oss-agent-installation";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const agent: OssAgentSummary = {
  id: "huggingface:example/retail-agent",
  label: "Retail Agent",
  description: "A bounded retail assistant.",
  source: "huggingface",
  sourceId: "example/retail-agent",
  sourceUrl: "https://huggingface.co/spaces/example/retail-agent",
  license: "apache-2.0",
  licenseUrl: "https://huggingface.co/spaces/example/retail-agent/blob/main/LICENSE",
  licenseVerified: true,
  runtime: "gradio",
  executionMode: "hosted-api",
  minimumDeviceTier: "low",
  minimumMemoryGb: 2,
  requiresGpu: false,
  popularity: 120,
  capabilities: ["agent", "retail"],
  updatedAt: "2026-08-01T00:00:00.000Z"
};

describe("OSS agent installation", () => {
  it("caches a verified manifest before linking it to a shop and device", () => {
    const storage = new MemoryStorage();
    installOssAgentManifest(agent, storage, "2026-08-21T10:00:00.000Z");
    linkInstalledOssAgent(
      {
        businessId: "business-1",
        deviceId: "device-1",
        agentDefinitionId: agent.id
      },
      storage,
      "2026-08-21T10:01:00.000Z"
    );

    expect(listInstalledOssAgentManifests(storage)).toEqual([
      { manifestVersion: 1, agent, installedAt: "2026-08-21T10:00:00.000Z" }
    ]);
    expect(readDeviceOssAgentBinding("business-1", "device-1", storage)).toMatchObject({
      agentDefinitionId: agent.id,
      linkedAt: "2026-08-21T10:01:00.000Z"
    });
  });

  it("rejects unlicensed or source-mismatched manifests", () => {
    const storage = new MemoryStorage();

    expect(() => installOssAgentManifest({ ...agent, licenseVerified: false }, storage)).toThrow(
      "license-verified"
    );
    expect(() =>
      installOssAgentManifest({ ...agent, sourceUrl: "https://example.com/agent" }, storage)
    ).toThrow("license-verified");
    expect(listInstalledOssAgentManifests(storage)).toEqual([]);
  });

  it("refuses to link a manifest that has not been downloaded", () => {
    const storage = new MemoryStorage();
    expect(() =>
      linkInstalledOssAgent(
        { businessId: "business-1", deviceId: "device-1", agentDefinitionId: agent.id },
        storage
      )
    ).toThrow("Install the agent manifest");
  });
});
