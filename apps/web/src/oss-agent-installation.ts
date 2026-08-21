import {
  isAgentDefinitionId,
  type AgentDefinitionId,
  type OssAgentSummary
} from "@soko/shared-types";

const installationStorageKey = "soko.oss-agent-installations.v1";
const bindingStorageKey = "soko.oss-agent-bindings.v1";

export interface InstalledOssAgentManifest {
  manifestVersion: 1;
  agent: OssAgentSummary;
  installedAt: string;
}

export interface DeviceOssAgentBinding {
  businessId: string;
  deviceId: string;
  agentDefinitionId: AgentDefinitionId;
  linkedAt: string;
}

type AgentManifestStorage = Pick<Storage, "getItem" | "setItem">;

export function listInstalledOssAgentManifests(
  storage: AgentManifestStorage = localStorage
): InstalledOssAgentManifest[] {
  return readArray(storage, installationStorageKey).filter(isInstalledManifest);
}

export function installOssAgentManifest(
  agent: OssAgentSummary,
  storage: AgentManifestStorage = localStorage,
  installedAt = new Date().toISOString()
): InstalledOssAgentManifest {
  if (!isSafeInstallableManifest(agent)) {
    throw new Error(
      "Only license-verified GitHub or Hugging Face agent manifests can be installed."
    );
  }
  const installed: InstalledOssAgentManifest = { manifestVersion: 1, agent, installedAt };
  const manifests = listInstalledOssAgentManifests(storage).filter(
    (candidate) => candidate.agent.id !== agent.id
  );
  storage.setItem(installationStorageKey, JSON.stringify([...manifests, installed]));
  return installed;
}

export function linkInstalledOssAgent(
  input: {
    businessId: string;
    deviceId: string;
    agentDefinitionId: AgentDefinitionId;
  },
  storage: AgentManifestStorage = localStorage,
  linkedAt = new Date().toISOString()
): DeviceOssAgentBinding {
  const installed = listInstalledOssAgentManifests(storage).some(
    (manifest) => manifest.agent.id === input.agentDefinitionId
  );
  if (!installed) throw new Error("Install the agent manifest before linking it to chat.");

  const binding: DeviceOssAgentBinding = { ...input, linkedAt };
  const bindings = listDeviceOssAgentBindings(storage).filter(
    (candidate) =>
      candidate.businessId !== input.businessId || candidate.deviceId !== input.deviceId
  );
  storage.setItem(bindingStorageKey, JSON.stringify([...bindings, binding]));
  return binding;
}

export function readDeviceOssAgentBinding(
  businessId: string,
  deviceId: string,
  storage: AgentManifestStorage = localStorage
): DeviceOssAgentBinding | null {
  return (
    listDeviceOssAgentBindings(storage).find(
      (binding) => binding.businessId === businessId && binding.deviceId === deviceId
    ) ?? null
  );
}

function listDeviceOssAgentBindings(storage: AgentManifestStorage): DeviceOssAgentBinding[] {
  return readArray(storage, bindingStorageKey).filter(isDeviceBinding);
}

function readArray(storage: AgentManifestStorage, key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isSafeInstallableManifest(agent: OssAgentSummary): boolean {
  const expectedPrefix = `${agent.source}:`;
  const expectedHost = agent.source === "github" ? "github.com" : "huggingface.co";
  const expectedPath =
    agent.source === "github" ? `/${agent.sourceId}` : `/spaces/${agent.sourceId}`;
  try {
    const sourceUrl = new URL(agent.sourceUrl);
    return (
      agent.licenseVerified &&
      isAgentDefinitionId(agent.id) &&
      agent.id.startsWith(expectedPrefix) &&
      agent.id === `${agent.source}:${agent.sourceId}` &&
      sourceUrl.protocol === "https:" &&
      sourceUrl.hostname === expectedHost &&
      sourceUrl.pathname.replace(/\/$/, "") === expectedPath
    );
  } catch {
    return false;
  }
}

function isInstalledManifest(value: unknown): value is InstalledOssAgentManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<InstalledOssAgentManifest>;
  return (
    manifest.manifestVersion === 1 &&
    typeof manifest.installedAt === "string" &&
    typeof manifest.agent === "object" &&
    manifest.agent !== null &&
    isSafeInstallableManifest(manifest.agent as OssAgentSummary)
  );
}

function isDeviceBinding(value: unknown): value is DeviceOssAgentBinding {
  if (typeof value !== "object" || value === null) return false;
  const binding = value as Partial<DeviceOssAgentBinding>;
  return (
    typeof binding.businessId === "string" &&
    typeof binding.deviceId === "string" &&
    isAgentDefinitionId(binding.agentDefinitionId) &&
    binding.agentDefinitionId !== "builtin:shopkeeper" &&
    typeof binding.linkedAt === "string"
  );
}
