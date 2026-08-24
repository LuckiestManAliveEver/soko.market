import { parseRuntimeModelOutput } from "@soko/tool-core";
import type { ClientWorkspaceFileTransfer, InferenceRuntime } from "@soko/shared-types";

import type { NativeAgentModelRuntimeBridge } from "./agent-model-runtime";

const browserWorkspaceDirectory = "soko-workspaces";

export async function collectClientWorkspaceFileTransfers(input: {
  outputText: string;
  runtime: Extract<InferenceRuntime, "browser-webgpu" | "browser-wasm" | "native-llama-cpp">;
  businessId: string;
  nativeBridge?: NativeAgentModelRuntimeBridge;
  maximumFileBytes?: number;
}): Promise<ClientWorkspaceFileTransfer[]> {
  const parsed = parseRuntimeModelOutput(input.outputText);
  if (!parsed.ok || parsed.output?.kind !== "tool") return [];
  const proposal = parsed.output.proposal;
  if (proposal.toolName !== "workspace.deliver" || !proposal.validation.ok) return [];
  const paths = [
    proposal.input.path,
    ...(Array.isArray(proposal.input.additionalPaths) ? proposal.input.additionalPaths : [])
  ].filter((path): path is string => typeof path === "string" && path.trim().length > 0);
  const transfers: ClientWorkspaceFileTransfer[] = [];
  for (const requestedPath of paths) {
    const path = normalizeLocalWorkspacePath(requestedPath);
    const bytes = await readLocalWorkspaceBytes({ ...input, path }).catch((error: unknown) => {
      if (isMissingLocalWorkspaceFile(error)) return null;
      throw error;
    });
    if (bytes === null) continue;
    if (input.maximumFileBytes !== undefined && bytes.byteLength > input.maximumFileBytes) {
      throw new Error("The local workspace file is too large to deliver.");
    }
    transfers.push({
      path: requestedPath,
      contentBase64: bytesToBase64(bytes),
      checksum: await sha256(bytes)
    });
  }
  return transfers;
}

/** Canonical app-owned browser workspace used by browser-local agents and application services. */
export async function writeBrowserWorkspaceFile(input: {
  businessId: string;
  path: string;
  bytes: Blob | ArrayBuffer | Uint8Array;
}): Promise<void> {
  const path = normalizeLocalWorkspacePath(input.path);
  const segments = path.split("/");
  const filename = segments.pop()!;
  let directory = await browserBusinessWorkspace(input.businessId, true);
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(
      input.bytes instanceof Uint8Array ? Uint8Array.from(input.bytes).buffer : input.bytes
    );
  } finally {
    await writable.close();
  }
}

async function readLocalWorkspaceBytes(input: {
  runtime: Extract<InferenceRuntime, "browser-webgpu" | "browser-wasm" | "native-llama-cpp">;
  businessId: string;
  path: string;
  nativeBridge?: NativeAgentModelRuntimeBridge;
}): Promise<Uint8Array> {
  if (input.runtime === "native-llama-cpp" && input.nativeBridge?.readWorkspaceFile !== undefined) {
    const result = await input.nativeBridge.readWorkspaceFile({
      businessId: input.businessId,
      path: input.path
    });
    return base64ToBytes(result.contentBase64);
  }
  const segments = input.path.split("/");
  const filename = segments.pop()!;
  let directory = await browserBusinessWorkspace(input.businessId, false);
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: false });
  }
  const handle = await directory.getFileHandle(filename, { create: false });
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

async function browserBusinessWorkspace(
  businessId: string,
  create: boolean
): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const workspaces = await root.getDirectoryHandle(browserWorkspaceDirectory, { create });
  return workspaces.getDirectoryHandle(businessId, { create });
}

function normalizeLocalWorkspacePath(value: string): string {
  let normalized = value.trim();
  for (let index = 0; index < 2 && /%[0-9a-f]{2}/iu.test(normalized); index += 1) {
    normalized = decodeURIComponent(normalized);
  }
  normalized = normalized.replace(/^\.\//u, "").replace(/^workspace\//u, "");
  if (
    normalized.length === 0 ||
    normalized.includes("\u0000") ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new Error("The local workspace path is invalid.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("The local workspace path is invalid.");
  }
  return segments.join("/");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isMissingLocalWorkspaceFile(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}
