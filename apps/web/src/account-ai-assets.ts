import type {
  CloudModelArtifactSummary,
  InstalledOssAgentManifestSummary,
  OssAgentSummary
} from "@soko/shared-types";

import { getJson, postJson } from "./api-helpers";
import { apiFetch } from "./lib/api";
import {
  readLocalAiModelFile,
  restoreCloudModelArtifact,
  type LocalAiModel,
  type ModelTransferProgress
} from "./ai-model-manager";
import { installedModelRequest } from "./agent-model-panel-utils";
import { installOssAgentManifest } from "./oss-agent-installation";

export async function installOssAgentForAccount(
  agent: OssAgentSummary
): Promise<InstalledOssAgentManifestSummary> {
  const manifest = await postJson<InstalledOssAgentManifestSummary>("/v1/oss-agents/installed", {
    agent
  });
  installOssAgentManifest(manifest.agent, localStorage, manifest.installedAt);
  return manifest;
}

export async function hydrateAccountOssAgentManifests(): Promise<
  InstalledOssAgentManifestSummary[]
> {
  const response = await getJson<{ manifests: InstalledOssAgentManifestSummary[] }>(
    "/v1/oss-agents/installed"
  );
  for (const manifest of response.manifests) {
    installOssAgentManifest(manifest.agent, localStorage, manifest.installedAt);
  }
  return response.manifests;
}

export async function listAccountModelArtifacts(): Promise<CloudModelArtifactSummary[]> {
  return (await getJson<{ artifacts: CloudModelArtifactSummary[] }>("/v1/model-artifacts"))
    .artifacts;
}

export async function uploadLocalModelToAccount(
  model: LocalAiModel,
  onProgress: (progress: ModelTransferProgress) => void
): Promise<CloudModelArtifactSummary> {
  const artifact = await postJson<CloudModelArtifactSummary>(
    "/v1/model-artifacts",
    installedModelRequest(model)
  );
  const file = await readLocalAiModelFile(model);
  let sentBytes = 0;
  for (let index = 0; index < artifact.chunkCount; index += 1) {
    const start = index * artifact.chunkSizeBytes;
    const end = Math.min(file.size, start + artifact.chunkSizeBytes);
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    await apiFetch(`/v1/model-artifacts/${encodeURIComponent(artifact.id)}/chunks/${index}`, {
      method: "PUT",
      body: { contentBase64: bytesToBase64(bytes) },
      timeoutMs: 120_000
    });
    sentBytes += bytes.byteLength;
    onProgress({
      receivedBytes: sentBytes,
      totalBytes: file.size,
      percent: Math.min(100, Math.round((sentBytes / file.size) * 100))
    });
  }
  return postJson<CloudModelArtifactSummary>(
    `/v1/model-artifacts/${encodeURIComponent(artifact.id)}/complete`,
    {},
    { timeoutMs: 120_000 }
  );
}

export async function restoreAccountModelToDevice(
  artifact: CloudModelArtifactSummary,
  onProgress: (progress: ModelTransferProgress) => void
): Promise<LocalAiModel> {
  return restoreCloudModelArtifact(
    artifact,
    async (index) => {
      const response = await apiFetch<{ contentBase64: string }>(
        `/v1/model-artifacts/${encodeURIComponent(artifact.id)}/chunks/${index}`,
        { timeoutMs: 120_000 }
      );
      return base64ToBytes(response.contentBase64);
    },
    onProgress
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
