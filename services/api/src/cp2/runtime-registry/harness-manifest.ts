/**
 * Sibling manifest type to PortableAgentManifest (packages/shared-types/src/portable-agent.ts),
 * scoped to declaring an AgentRuntimeAdapter-shaped harness rather than an agent.
 * PortableAgentManifest describes *what an agent needs* (instructions/tools/model requirements); a
 * harness instead declares *how Soko would load and run adapter code* -- an entirely different, and
 * far more security-sensitive, shape (it is adapter-shaped, see agent-runtime/agent-runtime-adapter.ts's
 * `AgentRuntimeAdapter` interface). Kept out of packages/shared-types on purpose: this describes the
 * untrusted-harness-import boundary specific to services/api/src/cp2/runtime-registry, not a portable
 * cross-package contract every consumer needs.
 *
 * Soko-compatible harness/agent manifest convention (documented here as the single source of truth,
 * referenced from runtime-registry/github-adapter.ts and import-service.ts):
 *   - `soko.agent.json` at a repository's root -- validated with
 *     `validatePortableAgentManifest` (packages/shared-types/src/portable-agent.ts). Optional: when
 *     absent, `portableAgentManifestFromOssAgent` synthesizes an equivalent manifest from discovery
 *     metadata, since importing an agent never executes repository code (see import-service.ts).
 *   - `soko.harness.json` at a repository's root -- validated with `validateSokoHarnessManifest`
 *     below. Its presence and validity is the ONLY signal that ever earns
 *     `compatibility.status: "compatible"` for a `kind: "harness"` search/import result. A repo
 *     merely named, tagged, or described with the word "agent" or "harness" never qualifies, and a
 *     harness has no synthesized fallback: without this file, static inspection cannot know how the
 *     repository expects to be loaded, so the result stays "inspection_required" or "unknown".
 */
export interface SokoHarnessManifest {
  schemaVersion: "1";
  adapterId: string;
  displayName: string;
  /** Manifest-relative entry point; documents intent only -- never fetched, read, or executed by
   *  Soko as part of discovery or import. Actual server-side loading only ever happens through the
   *  trusted `AgentRuntimeAdapterRegistry.register()` path (agent-runtime/agent-runtime-adapter.ts). */
  entryPoint: string;
  runtimeRequirements?: {
    node?: string;
  };
  permissions?: {
    network: "none" | "restricted" | "allowed";
    filesystem: "none" | "sandboxed";
  };
}

export interface SokoHarnessManifestIssue {
  path: string;
  message: string;
}

export type SokoHarnessManifestValidation =
  | { valid: true; manifest: SokoHarnessManifest; issues: [] }
  | { valid: false; manifest: null; issues: SokoHarnessManifestIssue[] };

// Mirrors packages/shared-types/src/portable-agent.ts's `prohibitedKeys` denylist: a harness
// manifest is untrusted, repository-authored JSON fetched over the network, and must never be
// allowed to smuggle a credential, device path, or an executable command that a naive future
// integration might read and act on.
const prohibitedKeys = new Set([
  "apikey",
  "api_key",
  "authorization",
  "binarypath",
  "command",
  "deviceid",
  "devicepath",
  "endpoint",
  "env",
  "executable",
  "password",
  "secret",
  "shell",
  "token"
]);

const networkModes = new Set(["none", "restricted", "allowed"]);
const filesystemModes = new Set(["none", "sandboxed"]);
const adapterIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

export function validateSokoHarnessManifest(value: unknown): SokoHarnessManifestValidation {
  const issues: SokoHarnessManifestIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid([{ path: "$", message: "must be an object" }]);
  }
  const root = value as Record<string, unknown>;
  rejectProhibitedKeys(root, "$", issues, 0);

  if (root.schemaVersion !== "1") issue(issues, "$.schemaVersion", 'must equal "1"');
  if (
    !isBoundedString(root.adapterId, 1, 80) ||
    !adapterIdPattern.test(root.adapterId as string)
  ) {
    issue(issues, "$.adapterId", "must be a lowercase portable adapter identifier");
  }
  if (!isBoundedString(root.displayName, 1, 160)) {
    issue(issues, "$.displayName", "must be a string between 1 and 160 characters");
  }
  if (
    !isBoundedString(root.entryPoint, 1, 240) ||
    !isManifestRelativePath(root.entryPoint as string)
  ) {
    issue(issues, "$.entryPoint", "must be a manifest-relative file path");
  }
  if (root.runtimeRequirements !== undefined) {
    if (typeof root.runtimeRequirements !== "object" || root.runtimeRequirements === null) {
      issue(issues, "$.runtimeRequirements", "must be an object");
    } else {
      const runtimeRequirements = root.runtimeRequirements as Record<string, unknown>;
      if (
        runtimeRequirements.node !== undefined &&
        !isBoundedString(runtimeRequirements.node, 1, 40)
      ) {
        issue(issues, "$.runtimeRequirements.node", "must be a version string");
      }
    }
  }
  if (root.permissions !== undefined) {
    if (typeof root.permissions !== "object" || root.permissions === null) {
      issue(issues, "$.permissions", "must be an object");
    } else {
      const permissions = root.permissions as Record<string, unknown>;
      if (!networkModes.has(permissions.network as string)) {
        issue(issues, "$.permissions.network", "is invalid");
      }
      if (!filesystemModes.has(permissions.filesystem as string)) {
        issue(issues, "$.permissions.filesystem", "is invalid");
      }
    }
  }

  if (issues.length > 0) return invalid(issues);
  return { valid: true, manifest: structuredClone(value) as SokoHarnessManifest, issues: [] };
}

function invalid(issues: SokoHarnessManifestIssue[]): SokoHarnessManifestValidation {
  return { valid: false, manifest: null, issues };
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function isManifestRelativePath(value: string): boolean {
  return (
    !value.startsWith("/") &&
    !/^[a-zA-Z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]/u).includes("..") &&
    !/^[a-z][a-z0-9+.-]*:/iu.test(value)
  );
}

function rejectProhibitedKeys(
  value: unknown,
  path: string,
  issues: SokoHarnessManifestIssue[],
  depth: number
): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectProhibitedKeys(item, `${path}[${index}]`, issues, depth + 1)
    );
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (prohibitedKeys.has(key.toLowerCase())) {
      issue(issues, `${path}.${key}`, "is not allowed in a Soko harness manifest");
    }
    rejectProhibitedKeys(item, `${path}.${key}`, issues, depth + 1);
  }
}

function issue(issues: SokoHarnessManifestIssue[], path: string, message: string): void {
  issues.push({ path, message });
}
