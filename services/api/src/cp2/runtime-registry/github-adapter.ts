import type { OssAgentSummary, RuntimeAssetKind } from "@soko/shared-types";
import type {
  RuntimeRegistryCompatibilityStatus,
  RuntimeRegistryContext,
  RuntimeRegistryResourceDetails,
  RuntimeRegistryResourceFile,
  RuntimeRegistryResourceRef,
  RuntimeRegistrySearchItem,
  RuntimeRegistrySearchQuery
} from "@soko/shared-types";
import type { GitHubModelCatalog, GitHubAiModelSummary } from "../github-model-catalog.js";
import type { GitHubAgentCatalog } from "../github-agent-catalog.js";
import { RuntimeRegistryResourceNotFoundError, type RuntimeRegistryAdapter } from "./types.js";
import { validateSokoHarnessManifest, type SokoHarnessManifest } from "./harness-manifest.js";

export interface GitHubRegistryAdapterOptions {
  modelCatalog: GitHubModelCatalog;
  agentCatalog: GitHubAgentCatalog;
  fetcher?: typeof fetch;
  token?: string;
  requestTimeoutMs?: number;
  /** Bounds how many candidate repos get a per-repo `soko.harness.json` inspection fetch per
   *  search call - the same cost-control existing catalogs already apply to release/blob lookups. */
  maxHarnessInspections?: number;
}

const defaultRequestTimeoutMs = 8_000;
const defaultMaxHarnessInspections = 6;
const readmeExcerptMaxChars = 2_000;

/**
 * Wraps the existing, already-working github-model-catalog.ts and github-agent-catalog.ts behind
 * the RuntimeRegistryAdapter interface. Neither existing catalog's own GitHub API calls are
 * reimplemented here; this only normalizes their results and adds the two capabilities they don't
 * have: harness-manifest static inspection (search) and resource detail lookup (inspect).
 */
export function createGitHubRegistryAdapter(
  options: GitHubRegistryAdapterOptions
): RuntimeRegistryAdapter {
  const fetcher = options.fetcher ?? fetch;
  const token = options.token;
  const requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? defaultRequestTimeoutMs);
  const maxHarnessInspections = Math.max(
    1,
    Math.min(12, options.maxHarnessInspections ?? defaultMaxHarnessInspections)
  );

  return {
    id: "github",
    displayName: "GitHub",

    async search(
      query: RuntimeRegistrySearchQuery,
      context: RuntimeRegistryContext
    ): Promise<RuntimeRegistrySearchItem[]> {
      void context; // Reserved for a future per-account GitHub token; env-level token only today.
      const kinds = new Set<RuntimeAssetKind>(query.kinds ?? ["model", "agent", "harness"]);
      const items: RuntimeRegistrySearchItem[] = [];

      if (kinds.has("model")) {
        const result = await options.modelCatalog.searchModels(query.query);
        for (const model of result.models) {
          const item = githubModelToItem(model);
          if (item !== null) items.push(item);
        }
      }

      if (kinds.has("agent") || kinds.has("harness")) {
        const result = await options.agentCatalog.searchAgents(query.query);
        if (kinds.has("agent")) {
          items.push(...result.agents.map(githubAgentToItem));
        }
        if (kinds.has("harness")) {
          const candidates = result.agents.slice(0, maxHarnessInspections);
          const harnessItems = await Promise.all(
            candidates.map((agent) =>
              inspectHarnessCandidate(agent, { fetcher, token, requestTimeoutMs })
            )
          );
          items.push(...harnessItems);
        }
      }

      return items;
    },

    async inspect(
      ref: RuntimeRegistryResourceRef,
      context: RuntimeRegistryContext
    ): Promise<RuntimeRegistryResourceDetails> {
      void context;
      if (ref.kind === "model") {
        return inspectGitHubModel(ref, { fetcher, token, requestTimeoutMs });
      }
      return inspectGitHubRepository(ref, { fetcher, token, requestTimeoutMs });
    }
  };
}

// ---------------------------------------------------------------------------
// Normalization: existing catalog result -> RuntimeRegistrySearchItem
// ---------------------------------------------------------------------------

/** GitHub model ids from the underlying catalog carry no owner/repo split, so this normalizer
 *  recovers "{owner}/{repo}#{fileName}" from the release asset's browser_download_url, which is
 *  already validated (github-model-catalog.ts's isInstallableGgufAsset) to be a github.com URL
 *  under `/{fullName}/releases/download/`. Returns null (dropped from results, never thrown) for
 *  the small number of malformed entries this can't recover from. */
function githubModelToItem(model: GitHubAiModelSummary): RuntimeRegistrySearchItem | null {
  const parsed = parseGitHubReleaseDownloadUrl(model.downloadUrl);
  if (parsed === null) return null;
  return {
    provider: "github",
    kind: "model",
    externalId: `${parsed.fullName}#${parsed.fileName}`,
    name: parsed.fileName,
    displayName: model.label,
    description: model.description,
    owner: parsed.fullName.split("/")[0] ?? null,
    repositoryId: parsed.fullName,
    revision: null,
    stars: null,
    downloads: null,
    updatedAt: null,
    license: model.license,
    verified: model.license === "Apache-2.0",
    imported: false,
    // The underlying catalog already filters to installable, commercially licensed GGUF release
    // assets (minimum/maximum size, Apache-2.0, uploaded state) - a listed result already passed
    // every static check that matters for a model.
    compatibility: { status: "compatible" }
  };
}

function githubAgentToItem(agent: OssAgentSummary): RuntimeRegistrySearchItem {
  return {
    provider: "github",
    kind: "agent",
    externalId: agent.sourceId,
    name: agent.sourceId,
    displayName: agent.label,
    description: agent.description,
    owner: agent.sourceId.split("/")[0] ?? null,
    repositoryId: agent.sourceId,
    revision: null,
    stars: agent.popularity,
    downloads: null,
    updatedAt: agent.updatedAt,
    license: agent.license,
    verified: agent.licenseVerified,
    imported: false,
    // Agent import never executes repository code (see import-service.ts) - it registers a
    // Soko-side PortableAgentManifest synthesized from this same discovery metadata, so a
    // verified-license repo is always import-safe. An unverified license still needs a human to
    // confirm before import (see LICENSE_CONFIRMATION_REQUIRED in the import state machine).
    compatibility: agent.licenseVerified
      ? { status: "compatible" }
      : { status: "inspection_required", reason: "License needs confirmation before import." }
  };
}

async function inspectHarnessCandidate(
  agent: OssAgentSummary,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<RuntimeRegistrySearchItem> {
  const inspection = await fetchHarnessManifest(agent.sourceId, deps);
  return {
    provider: "github",
    kind: "harness",
    externalId: agent.sourceId,
    name: agent.sourceId,
    displayName: agent.label,
    description: agent.description,
    owner: agent.sourceId.split("/")[0] ?? null,
    repositoryId: agent.sourceId,
    revision: null,
    stars: agent.popularity,
    downloads: null,
    updatedAt: agent.updatedAt,
    license: agent.license,
    verified: agent.licenseVerified,
    imported: false,
    compatibility: { status: inspection.status, ...(inspection.reason ? { reason: inspection.reason } : {}) }
  };
}

// ---------------------------------------------------------------------------
// Harness manifest static inspection (the security-sensitive boundary)
// ---------------------------------------------------------------------------

interface HarnessInspectionResult {
  status: RuntimeRegistryCompatibilityStatus;
  reason?: string;
  manifest?: SokoHarnessManifest;
}

/**
 * Fetches ONLY the small `soko.harness.json` text file via GitHub's contents (metadata) API - never
 * a tarball, a repository clone, or any `.js`/`.ts` source file - and validates it statically. This
 * is the entire "harness discovery" security boundary: a result only ever earns
 * compatibility.status "compatible" here, never from a name/topic/README keyword match.
 */
async function fetchHarnessManifest(
  fullName: string,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<HarnessInspectionResult> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    return { status: "unknown", reason: "Repository identifier is not a valid owner/repo pair." };
  }
  const url = `https://api.github.com/repos/${fullName}/contents/soko.harness.json`;
  try {
    const response = await deps.fetcher(url, {
      headers: githubHeaders(deps.token),
      signal: AbortSignal.timeout(deps.requestTimeoutMs)
    });
    if (response.status === 404) {
      return {
        status: "unknown",
        reason: "No soko.harness.json manifest was found at the repository root."
      };
    }
    if (!response.ok) {
      return {
        status: "inspection_required",
        reason: `GitHub contents API returned ${response.status}.`
      };
    }
    const body = (await response.json()) as {
      content?: string;
      encoding?: string;
      type?: string;
      size?: number;
    };
    if (
      body.type !== "file" ||
      typeof body.content !== "string" ||
      body.encoding !== "base64" ||
      (typeof body.size === "number" && body.size > 200_000)
    ) {
      return { status: "inspection_required", reason: "soko.harness.json was not a readable file." };
    }
    let decoded: string;
    try {
      decoded = Buffer.from(body.content, "base64").toString("utf8");
    } catch {
      return { status: "incompatible", reason: "soko.harness.json could not be decoded." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      return { status: "incompatible", reason: "soko.harness.json is not valid JSON." };
    }
    const validation = validateSokoHarnessManifest(parsed);
    if (!validation.valid) {
      return {
        status: "incompatible",
        reason: `soko.harness.json failed validation: ${validation.issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ")}`
      };
    }
    return { status: "compatible", manifest: validation.manifest };
  } catch {
    return { status: "inspection_required", reason: "The manifest file could not be reached." };
  }
}

// ---------------------------------------------------------------------------
// Resource inspection (metadata + README excerpt + root file listing only)
// ---------------------------------------------------------------------------

async function inspectGitHubModel(
  ref: RuntimeRegistryResourceRef,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<RuntimeRegistryResourceDetails> {
  const parsed = parseModelExternalId(ref.externalId);
  if (parsed === null) throw new RuntimeRegistryResourceNotFoundError(ref);
  const repository = await fetchRepository(parsed.fullName, deps);
  if (repository === null) throw new RuntimeRegistryResourceNotFoundError(ref);
  const asset = await findReleaseAsset(parsed.fullName, parsed.fileName, deps);
  if (asset === null) throw new RuntimeRegistryResourceNotFoundError(ref);
  const readmeExcerpt = await fetchReadmeExcerpt(parsed.fullName, deps);

  return {
    provider: "github",
    kind: "model",
    externalId: ref.externalId,
    name: parsed.fileName,
    displayName: humanizeFileName(parsed.fileName),
    description: (repository.description as string | null) ?? `${parsed.fullName} GGUF model.`,
    owner: parsed.fullName.split("/")[0] ?? null,
    repositoryId: parsed.fullName,
    revision: (repository.default_branch as string | null) ?? null,
    stars: (repository.stargazers_count as number | undefined) ?? null,
    downloads: null,
    updatedAt: (repository.pushed_at as string | null) ?? null,
    license: ((repository.license as { spdx_id?: string | null } | null)?.spdx_id ?? null),
    verified:
      ((repository.license as { spdx_id?: string | null } | null)?.spdx_id ?? null) ===
      "Apache-2.0",
    imported: false,
    compatibility: { status: "compatible" },
    readmeExcerpt,
    files: [
      {
        path: parsed.fileName,
        sizeBytes: (asset.size as number | undefined) ?? null,
        contentType: "application/octet-stream"
      }
    ],
    providerMetadata: { repository, asset }
  };
}

async function inspectGitHubRepository(
  ref: RuntimeRegistryResourceRef,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<RuntimeRegistryResourceDetails> {
  const fullName = ref.externalId;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new RuntimeRegistryResourceNotFoundError(ref);
  }
  const repository = await fetchRepository(fullName, deps);
  if (repository === null) throw new RuntimeRegistryResourceNotFoundError(ref);
  const [readmeExcerpt, files, harnessInspection, sokoAgentManifest] = await Promise.all([
    fetchReadmeExcerpt(fullName, deps),
    fetchRootFileListing(fullName, deps),
    ref.kind === "harness"
      ? fetchHarnessManifest(fullName, deps)
      : Promise.resolve<HarnessInspectionResult>({ status: "unknown" }),
    ref.kind === "agent" ? fetchRepositoryFile(fullName, "soko.agent.json", deps) : Promise.resolve(null)
  ]);
  const license = (repository.license as { spdx_id?: string | null } | null)?.spdx_id ?? null;
  const compatibility =
    ref.kind === "harness"
      ? { status: harnessInspection.status, ...(harnessInspection.reason ? { reason: harnessInspection.reason } : {}) }
      : license !== null
        ? { status: "compatible" as const }
        : { status: "inspection_required" as const, reason: "License needs confirmation before import." };

  return {
    provider: "github",
    kind: ref.kind,
    externalId: fullName,
    name: fullName,
    displayName: (fullName.split("/")[1] as string | undefined) ?? fullName,
    description: (repository.description as string | null) ?? `${fullName} GitHub repository.`,
    owner: fullName.split("/")[0] ?? null,
    repositoryId: fullName,
    revision: (repository.default_branch as string | null) ?? null,
    stars: (repository.stargazers_count as number | undefined) ?? null,
    downloads: null,
    updatedAt: (repository.pushed_at as string | null) ?? null,
    license,
    verified: license !== null,
    imported: false,
    compatibility,
    readmeExcerpt,
    files,
    providerMetadata: {
      repository,
      ...(sokoAgentManifest === null ? {} : { sokoAgentManifest })
    }
  };
}

async function fetchRepository(
  fullName: string,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<Record<string, unknown> | null> {
  try {
    const response = await deps.fetcher(`https://api.github.com/repos/${fullName}`, {
      headers: githubHeaders(deps.token),
      signal: AbortSignal.timeout(deps.requestTimeoutMs)
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function findReleaseAsset(
  fullName: string,
  fileName: string,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<Record<string, unknown> | null> {
  try {
    const response = await deps.fetcher(
      `https://api.github.com/repos/${fullName}/releases?per_page=10`,
      { headers: githubHeaders(deps.token), signal: AbortSignal.timeout(deps.requestTimeoutMs) }
    );
    if (!response.ok) return null;
    const releases = (await response.json()) as Array<{ assets?: Array<Record<string, unknown>> }>;
    for (const release of releases) {
      const match = (release.assets ?? []).find((asset) => asset.name === fileName);
      if (match !== undefined) return match;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetches ONE small root-level JSON manifest file via GitHub's contents (metadata) API and
 *  returns its parsed body, or null if it doesn't exist / isn't readable / isn't valid JSON. Same
 *  boundary as fetchHarnessManifest: a text/metadata endpoint only, never a clone or source fetch. */
async function fetchRepositoryFile(
  fullName: string,
  path: string,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<unknown | null> {
  try {
    const response = await deps.fetcher(`https://api.github.com/repos/${fullName}/contents/${path}`, {
      headers: githubHeaders(deps.token),
      signal: AbortSignal.timeout(deps.requestTimeoutMs)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      content?: string;
      encoding?: string;
      type?: string;
      size?: number;
    };
    if (
      body.type !== "file" ||
      typeof body.content !== "string" ||
      body.encoding !== "base64" ||
      (typeof body.size === "number" && body.size > 200_000)
    ) {
      return null;
    }
    try {
      return JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** Small text file only (README), truncated - never a full repository dump or an artifact. */
async function fetchReadmeExcerpt(
  fullName: string,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<string | null> {
  try {
    const response = await deps.fetcher(`https://api.github.com/repos/${fullName}/readme`, {
      headers: githubHeaders(deps.token),
      signal: AbortSignal.timeout(deps.requestTimeoutMs)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { content?: string; encoding?: string };
    if (typeof body.content !== "string" || body.encoding !== "base64") return null;
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    return decoded.slice(0, readmeExcerptMaxChars);
  } catch {
    return null;
  }
}

/** Root directory listing only (names/sizes/types) - no file content is ever fetched here. */
async function fetchRootFileListing(
  fullName: string,
  deps: { fetcher: typeof fetch; token: string | undefined; requestTimeoutMs: number }
): Promise<RuntimeRegistryResourceFile[]> {
  try {
    const response = await deps.fetcher(`https://api.github.com/repos/${fullName}/contents/`, {
      headers: githubHeaders(deps.token),
      signal: AbortSignal.timeout(deps.requestTimeoutMs)
    });
    if (!response.ok) return [];
    const entries = (await response.json()) as Array<{
      path?: string;
      size?: number;
      type?: string;
    }>;
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => typeof entry.path === "string")
      .slice(0, 100)
      .map((entry) => ({
        path: entry.path as string,
        sizeBytes: typeof entry.size === "number" ? entry.size : null,
        contentType: entry.type === "dir" ? "inode/directory" : null
      }));
  } catch {
    return [];
  }
}

function parseGitHubReleaseDownloadUrl(
  downloadUrl: string | null
): { fullName: string; fileName: string } | null {
  if (downloadUrl === null) return null;
  try {
    const url = new URL(downloadUrl);
    if (url.hostname !== "github.com") return null;
    const match = /^\/([^/]+\/[^/]+)\/releases\/download\/[^/]+\/([^/]+)$/.exec(url.pathname);
    if (match === null) return null;
    return { fullName: match[1]!, fileName: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

function parseModelExternalId(externalId: string): { fullName: string; fileName: string } | null {
  const separatorIndex = externalId.indexOf("#");
  if (separatorIndex <= 0 || separatorIndex === externalId.length - 1) return null;
  const fullName = externalId.slice(0, separatorIndex);
  const fileName = externalId.slice(separatorIndex + 1);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return null;
  return { fullName, fileName };
}

function humanizeFileName(fileName: string): string {
  return fileName
    .replace(/\.gguf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function githubHeaders(token: string | undefined): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "soko-market-runtime-registry",
    "x-github-api-version": "2022-11-28",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
  };
}
