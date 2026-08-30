import { describe, expect, it, vi } from "vitest";
import type {
  RuntimeRegistryContext,
  RuntimeRegistryResourceDetails,
  RuntimeRegistryResourceRef,
  RuntimeRegistrySearchItem,
  RuntimeRegistrySearchQuery
} from "@soko/shared-types";
import { createGitHubModelCatalog } from "../services/api/src/cp2/github-model-catalog";
import { createGitHubAgentCatalog } from "../services/api/src/cp2/github-agent-catalog";
import type { GitHubModelCatalog } from "../services/api/src/cp2/github-model-catalog";
import type { GitHubAgentCatalog } from "../services/api/src/cp2/github-agent-catalog";
import { createSokoCatalogRegistryAdapter } from "../services/api/src/cp2/runtime-registry/soko-adapter";
import { createGitHubRegistryAdapter } from "../services/api/src/cp2/runtime-registry/github-adapter";
import { createHuggingFaceRegistryAdapter } from "../services/api/src/cp2/runtime-registry/huggingface-adapter";
import { createRuntimeRegistrySearchService } from "../services/api/src/cp2/runtime-registry/search";
import {
  RuntimeRegistryAccessRequiredError,
  type RuntimeRegistryAdapter
} from "../services/api/src/cp2/runtime-registry/types.js";
import {
  createRuntimeRegistryImportService,
  harnessProvisioningBoundaryReason
} from "../services/api/src/cp2/runtime-registry/import-service";
import { createMemoryRuntimeRegistryImportStore } from "../services/api/src/cp2/runtime-registry/import-store";
import { validateSokoHarnessManifest } from "../services/api/src/cp2/runtime-registry/harness-manifest";

const publicContext: RuntimeRegistryContext = { accountId: "public", connected: false };

function fakeAdapter(
  id: "github" | "huggingface" | "soko",
  behavior: {
    search?: (query: RuntimeRegistrySearchQuery) => Promise<RuntimeRegistrySearchItem[]>;
  }
): RuntimeRegistryAdapter {
  return {
    id,
    displayName: id,
    async search(query) {
      return behavior.search ? behavior.search(query) : [];
    },
    async inspect(ref: RuntimeRegistryResourceRef): Promise<RuntimeRegistryResourceDetails> {
      throw new Error(`inspect not implemented for fake adapter ${ref.provider}`);
    }
  };
}

function fakeItem(
  provider: "github" | "huggingface" | "soko",
  name: string
): RuntimeRegistrySearchItem {
  return {
    provider,
    kind: "model",
    externalId: name,
    name,
    displayName: name,
    description: "a fake item",
    owner: null,
    repositoryId: null,
    revision: null,
    verified: true,
    imported: false,
    compatibility: { status: "compatible" }
  };
}

describe("runtime registry unified search fan-out", () => {
  it("normalizes results across providers and isolates one provider's failure", async () => {
    const github = fakeAdapter("github", {
      search: async () => [fakeItem("github", "gh-model")]
    });
    const huggingface = fakeAdapter("huggingface", {
      search: async () => {
        throw new Error("Hugging Face is down");
      }
    });
    const soko = fakeAdapter("soko", { search: async () => [fakeItem("soko", "soko-model")] });

    const service = createRuntimeRegistrySearchService({
      adapters: { github, huggingface, soko }
    });

    const result = await service.search({ query: "model" }, publicContext);

    expect(result.items.map((item) => item.externalId).sort()).toEqual(["gh-model", "soko-model"]);
    expect(result.providers.github).toEqual({ status: "ok" });
    expect(result.providers.soko).toEqual({ status: "ok" });
    expect(result.providers.huggingface).toEqual({
      status: "error",
      errorMessage: "Hugging Face is down"
    });
  });

  it("rejects/short-circuits below the minimum query length without calling any provider", async () => {
    const search = vi.fn(async () => [fakeItem("github", "gh-model")]);
    const github = fakeAdapter("github", { search });

    const service = createRuntimeRegistrySearchService({ adapters: { github } });
    const result = await service.search({ query: "a" }, publicContext);

    expect(result).toEqual({ items: [], providers: {} });
    expect(search).not.toHaveBeenCalled();
  });

  it("caps the result count at the requested (bounded) limit", async () => {
    const github = fakeAdapter("github", {
      search: async () => Array.from({ length: 40 }, (_, index) => fakeItem("github", `m-${index}`))
    });
    const service = createRuntimeRegistrySearchService({ adapters: { github } });

    const uncapped = await service.search({ query: "model", limit: 5 }, publicContext);
    const overLimit = await service.search({ query: "modelx", limit: 999 }, publicContext);

    expect(uncapped.items).toHaveLength(5);
    expect(overLimit.items.length).toBeLessThanOrEqual(50);
  });

  it("never shares cached results between a public search and a connected-account search, or between two different accounts", async () => {
    let callCount = 0;
    const github = fakeAdapter("github", {
      search: async () => {
        callCount += 1;
        return [fakeItem("github", `call-${callCount}`)];
      }
    });
    const service = createRuntimeRegistrySearchService({ adapters: { github }, now: () => 1_000 });

    const query = { query: "widget" };
    const publicResult = await service.search(query, { accountId: "acct-a", connected: false });
    const accountAResult = await service.search(query, { accountId: "acct-a", connected: true });
    const accountBResult = await service.search(query, { accountId: "acct-b", connected: true });
    const publicResultAgain = await service.search(query, {
      accountId: "acct-a",
      connected: false
    });
    const accountAResultAgain = await service.search(query, {
      accountId: "acct-a",
      connected: true
    });

    expect(callCount).toBe(3);
    expect(publicResult.items[0]?.externalId).toBe("call-1");
    expect(accountAResult.items[0]?.externalId).toBe("call-2");
    expect(accountBResult.items[0]?.externalId).toBe("call-3");
    // Cache hits: repeating the exact same (query, context) pair must not re-invoke the provider.
    expect(publicResultAgain.items[0]?.externalId).toBe("call-1");
    expect(accountAResultAgain.items[0]?.externalId).toBe("call-2");
  });
});

describe("Soko catalog registry adapter", () => {
  it("normalizes Soko's own model/agent/harness catalog and marks every result already-imported", async () => {
    const adapter = createSokoCatalogRegistryAdapter({
      listModels: () => [
        {
          id: "sokoclaw-local",
          label: "Soko deterministic compatibility fallback",
          provider: "local",
          description: "Built-in deterministic agent behavior",
          capabilities: ["tool-routing"],
          available: true,
          source: "builtin",
          format: "remote",
          license: null,
          licenseUrl: null,
          modelCardUrl: null,
          downloadUrl: null,
          fileName: null,
          fileSizeBytes: null,
          minimumMemoryGb: null,
          recommended: false,
          contextWindow: null
        }
      ],
      listAgents: () => [
        {
          id: "builtin:shopkeeper",
          displayName: "Shopkeeper",
          role: "General shopkeeper",
          description: "Safe offline fallback",
          operatingPattern: "Focused operator",
          workloadClass: "focused",
          minimumDeviceTier: "low",
          minimumMemoryGb: 2,
          recommendedContextTokens: 1024,
          personality: "Warm",
          instructions: "Handle one task at a time.",
          knowledge: "Use saved records.",
          tools: [],
          skillIds: []
        }
      ],
      listHarnesses: () => [{ id: "pi", displayName: "Pi", description: "Hosted-first default." }]
    });

    const result = await adapter.search({ query: "shopkeeper" }, publicContext);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "soko",
      kind: "agent",
      externalId: "builtin:shopkeeper",
      imported: true,
      verified: true,
      compatibility: { status: "compatible" }
    });

    const details = await adapter.inspect(
      { provider: "soko", kind: "harness", externalId: "pi" },
      publicContext
    );
    expect(details.displayName).toBe("Pi");
    expect(details.imported).toBe(true);
  });
});

describe("GitHub/Hugging Face adapters never download an artifact merely to produce search results", () => {
  it("normalizes GitHub model and agent search results using only GitHub's metadata APIs", async () => {
    const calledUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      calledUrls.push(url);
      if (url.startsWith("https://api.github.com/search/repositories")) {
        if (url.includes("topic%3Aai-agents") || url.includes("topic:ai-agents")) {
          return Response.json({
            items: [
              {
                full_name: "example/agent-repo",
                html_url: "https://github.com/example/agent-repo",
                default_branch: "main",
                description: "An example agent",
                license: { spdx_id: "MIT" },
                language: "TypeScript",
                stargazers_count: 500,
                topics: ["ai-agents"],
                pushed_at: "2026-01-01T00:00:00.000Z",
                archived: false,
                fork: false
              }
            ]
          });
        }
        return Response.json({
          items: [
            {
              full_name: "example/model-repo",
              html_url: "https://github.com/example/model-repo",
              default_branch: "main",
              description: "An example model repo",
              license: { spdx_id: "Apache-2.0" }
            }
          ]
        });
      }
      if (url === "https://api.github.com/repos/example/model-repo/releases?per_page=5") {
        return Response.json([
          {
            name: "v1",
            tag_name: "v1",
            html_url: "https://github.com/example/model-repo/releases/tag/v1",
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "example-q4_k_m.gguf",
                size: 420 * 1024 ** 2,
                state: "uploaded",
                browser_download_url:
                  "https://github.com/example/model-repo/releases/download/v1/example-q4_k_m.gguf"
              }
            ]
          }
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const modelCatalog = createGitHubModelCatalog({
      fetcher: fetcher as typeof fetch,
      now: () => 1
    });
    const agentCatalog = createGitHubAgentCatalog({
      fetcher: fetcher as typeof fetch,
      now: () => 1
    });
    const adapter = createGitHubRegistryAdapter({
      modelCatalog,
      agentCatalog,
      fetcher: fetcher as typeof fetch
    });

    const items = await adapter.search(
      { query: "example", kinds: ["model", "agent"] },
      publicContext
    );

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "github",
          kind: "model",
          externalId: "example/model-repo#example-q4_k_m.gguf",
          compatibility: { status: "compatible" }
        }),
        expect.objectContaining({
          provider: "github",
          kind: "agent",
          externalId: "example/agent-repo",
          compatibility: { status: "compatible" }
        })
      ])
    );

    // Hard requirement: search must stay metadata-only. Every URL hit is a search/releases-listing
    // (JSON metadata) endpoint - never the release asset's own browser_download_url, never a
    // tarball/zipball, never a raw source file.
    for (const url of calledUrls) {
      expect(url).not.toContain("/releases/download/");
      expect(url).not.toContain("codeload.github.com");
      expect(url).not.toMatch(/\/(tarball|zipball)\//);
      expect(url).not.toMatch(/\.(gguf|js|ts|py)(\?|$)/);
    }
  });
});

describe("model import never touches Postgres bytea artifact storage", () => {
  it("stops at PROVISIONING with captured provenance, never writing a chunk or downloading the weight file", async () => {
    const calledUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      calledUrls.push(url);
      if (url === "https://api.github.com/repos/example/model-repo") {
        return Response.json({
          full_name: "example/model-repo",
          default_branch: "main",
          description: "An example model repo",
          license: { spdx_id: "Apache-2.0" },
          pushed_at: "2026-01-01T00:00:00.000Z"
        });
      }
      if (url === "https://api.github.com/repos/example/model-repo/releases?per_page=10") {
        return Response.json([
          {
            name: "v1",
            tag_name: "v1",
            html_url: "https://github.com/example/model-repo/releases/tag/v1",
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "example-q4_k_m.gguf",
                size: 420 * 1024 ** 2,
                state: "uploaded",
                browser_download_url:
                  "https://github.com/example/model-repo/releases/download/v1/example-q4_k_m.gguf",
                digest: "sha256:deadbeef"
              }
            ]
          }
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const modelCatalog = createGitHubModelCatalog({
      fetcher: fetcher as typeof fetch,
      now: () => 1
    });
    const agentCatalog = createGitHubAgentCatalog({
      fetcher: fetcher as typeof fetch,
      now: () => 1
    });
    const github = createGitHubRegistryAdapter({
      modelCatalog,
      agentCatalog,
      fetcher: fetcher as typeof fetch
    });
    const importService = createRuntimeRegistryImportService({
      store: createMemoryRuntimeRegistryImportStore(),
      adapters: { github }
    });

    const record = await importService.startImport({
      accountId: "acct-1",
      userId: "user-1",
      ref: {
        provider: "github",
        kind: "model",
        externalId: "example/model-repo#example-q4_k_m.gguf"
      }
    });

    expect(record.state).toBe("PROVISIONING");
    expect(record.stateReason).toMatch(/not wired/i);
    expect(record.provenance).toMatchObject({
      provider: "github",
      filename: "example-q4_k_m.gguf",
      checksum: "sha256:deadbeef"
    });

    // The whole point of this test: no URL fetched during import is a weight-file download, and no
    // account-ai-asset-store (Postgres bytea chunk) module is even imported by import-service.ts,
    // so a REGISTERED/PROVISIONING model import structurally cannot have written GGUF bytes to
    // Postgres - there is no code path for it to have done so.
    for (const url of calledUrls) {
      expect(url).not.toContain("/releases/download/");
      expect(url).not.toMatch(/\.gguf(\?|$)/);
    }
  });
});

describe("harness import safety boundary", () => {
  const stubModelCatalog: GitHubModelCatalog = {
    async searchModels() {
      throw new Error("not used in this test");
    }
  };
  const stubAgentCatalog: GitHubAgentCatalog = {
    async searchAgents() {
      throw new Error("not used in this test");
    }
  };

  function buildHarnessFetcher(manifestResponse: () => Response) {
    const calledUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      calledUrls.push(url);
      if (url === "https://api.github.com/repos/example/harness-repo") {
        return Response.json({
          description: "An example harness",
          default_branch: "main",
          stargazers_count: 42,
          pushed_at: "2026-01-01T00:00:00.000Z",
          license: { spdx_id: "MIT" }
        });
      }
      if (url === "https://api.github.com/repos/example/harness-repo/readme") {
        return Response.json({
          content: Buffer.from("# Example harness").toString("base64"),
          encoding: "base64"
        });
      }
      if (url === "https://api.github.com/repos/example/harness-repo/contents/") {
        return Response.json([{ path: "index.js", size: 200, type: "file" }]);
      }
      if (url === "https://api.github.com/repos/example/harness-repo/contents/soko.harness.json") {
        return manifestResponse();
      }
      return new Response(null, { status: 404 });
    });
    return { fetcher, calledUrls };
  }

  it("rejects a harness import when no valid soko.harness.json manifest exists, and never fetches source", async () => {
    const { fetcher, calledUrls } = buildHarnessFetcher(() => new Response(null, { status: 404 }));
    const adapter = createGitHubRegistryAdapter({
      modelCatalog: stubModelCatalog,
      agentCatalog: stubAgentCatalog,
      fetcher: fetcher as typeof fetch
    });
    const importService = createRuntimeRegistryImportService({
      store: createMemoryRuntimeRegistryImportStore(),
      adapters: { github: adapter },
      now: () => "2026-08-30T00:00:00.000Z"
    });

    const record = await importService.startImport({
      accountId: "acct-1",
      userId: "user-1",
      ref: { provider: "github", kind: "harness", externalId: "example/harness-repo" }
    });

    expect(["INCOMPATIBLE", "VALIDATION_FAILED"]).toContain(record.state);
    expect(record.registeredAssetId).toBeNull();
    assertNoExecutableFetch(calledUrls);
  });

  it("registers a harness import with a valid manifest through REGISTERED, stops at PROVISIONING, and never reaches ACTIVE or fetches source", async () => {
    const manifest = {
      schemaVersion: "1",
      adapterId: "example-harness",
      displayName: "Example Harness",
      entryPoint: "index.js",
      permissions: { network: "none", filesystem: "none" }
    };
    expect(validateSokoHarnessManifest(manifest).valid).toBe(true);

    const { fetcher, calledUrls } = buildHarnessFetcher(() =>
      Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(manifest)).toString("base64")
      })
    );
    const adapter = createGitHubRegistryAdapter({
      modelCatalog: stubModelCatalog,
      agentCatalog: stubAgentCatalog,
      fetcher: fetcher as typeof fetch
    });
    const importService = createRuntimeRegistryImportService({
      store: createMemoryRuntimeRegistryImportStore(),
      adapters: { github: adapter },
      now: () => "2026-08-30T00:00:00.000Z"
    });

    const record = await importService.startImport({
      accountId: "acct-1",
      userId: "user-1",
      ref: { provider: "github", kind: "harness", externalId: "example/harness-repo" }
    });

    expect(record.state).toBe("PROVISIONING");
    expect(record.stateReason).toBe(harnessProvisioningBoundaryReason);
    expect(record.registeredAssetId).toBe("github:example/harness-repo");
    expect(record.state).not.toBe("ACTIVE");
    expect(record.state).not.toBe("READY");
    assertNoExecutableFetch(calledUrls);
  });

  function assertNoExecutableFetch(calledUrls: string[]): void {
    for (const url of calledUrls) {
      expect(url).not.toContain("codeload.github.com");
      expect(url).not.toMatch(/\/(tarball|zipball)\//);
      expect(url).not.toMatch(/\.(js|ts|py|sh)(\?|$)/);
      // Every fetch must be a metadata/manifest-file endpoint: the repo itself, its README, its
      // root directory listing, or the soko.harness.json manifest file - nothing else.
      expect(
        url === "https://api.github.com/repos/example/harness-repo" ||
          url === "https://api.github.com/repos/example/harness-repo/readme" ||
          url === "https://api.github.com/repos/example/harness-repo/contents/" ||
          url === "https://api.github.com/repos/example/harness-repo/contents/soko.harness.json"
      ).toBe(true);
    }
  }
});

describe("agent import", () => {
  it("imports a GitHub agent repo through to REGISTERED using a synthesized PortableAgentManifest", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url === "https://api.github.com/repos/example/agent-repo") {
        return Response.json({
          description: "An example open-source agent",
          default_branch: "main",
          stargazers_count: 1200,
          pushed_at: "2026-01-01T00:00:00.000Z",
          license: { spdx_id: "MIT" }
        });
      }
      if (url === "https://api.github.com/repos/example/agent-repo/readme") {
        return Response.json({
          content: Buffer.from("# Example agent").toString("base64"),
          encoding: "base64"
        });
      }
      if (url === "https://api.github.com/repos/example/agent-repo/contents/") {
        return Response.json([{ path: "package.json", size: 300, type: "file" }]);
      }
      if (url === "https://api.github.com/repos/example/agent-repo/contents/soko.agent.json") {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    });

    const modelCatalog: GitHubModelCatalog = {
      async searchModels() {
        throw new Error("not used in this test");
      }
    };
    const agentCatalog: GitHubAgentCatalog = {
      async searchAgents() {
        throw new Error("not used in this test");
      }
    };
    const adapter = createGitHubRegistryAdapter({
      modelCatalog,
      agentCatalog,
      fetcher: fetcher as typeof fetch
    });
    const importService = createRuntimeRegistryImportService({
      store: createMemoryRuntimeRegistryImportStore(),
      adapters: { github: adapter },
      now: () => "2026-08-30T00:00:00.000Z"
    });

    const record = await importService.startImport({
      accountId: "acct-1",
      userId: "user-1",
      ref: { provider: "github", kind: "agent", externalId: "example/agent-repo" }
    });

    expect(record.state).toBe("REGISTERED");
    expect(record.registeredAssetId).toBe("github:example/agent-repo");
    expect(record.provenance).toMatchObject({
      provider: "github",
      externalId: "example/agent-repo",
      repositoryUrl: "https://github.com/example/agent-repo",
      importedBy: "user-1"
    });
  });
});

describe("gated/private Hugging Face model access is refused, never circumvented", () => {
  it("inspect() throws RuntimeRegistryAccessRequiredError on a 403, never falling back to a public read", async () => {
    const fetcher = vi.fn(async (): Promise<Response> => new Response(null, { status: 403 }));
    const adapter = createHuggingFaceRegistryAdapter({
      modelCatalog: { searchModels: async () => ({ models: [] }) },
      agentCatalog: { searchAgents: async () => ({ agents: [] }) },
      fetcher
    });

    await expect(
      adapter.inspect(
        {
          provider: "huggingface",
          kind: "model",
          externalId: "gated-org/gated-model#weights.gguf"
        },
        publicContext
      )
    ).rejects.toBeInstanceOf(RuntimeRegistryAccessRequiredError);
    // Only ever the metadata endpoint - never retried against a weight-file/download URL.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toContain(
      "https://huggingface.co/api/models/gated-org/gated-model"
    );
  });

  it("the import pipeline maps a gated/private resource to ACCESS_REQUIRED, not a generic failure or a fabricated READY state", async () => {
    const fetcher = vi.fn(async (): Promise<Response> => new Response(null, { status: 403 }));
    const huggingface = createHuggingFaceRegistryAdapter({
      modelCatalog: { searchModels: async () => ({ models: [] }) },
      agentCatalog: { searchAgents: async () => ({ agents: [] }) },
      fetcher
    });
    const importService = createRuntimeRegistryImportService({
      store: createMemoryRuntimeRegistryImportStore(),
      adapters: { huggingface }
    });

    const record = await importService.startImport({
      accountId: "acct-1",
      userId: "user-1",
      ref: {
        provider: "huggingface",
        kind: "model",
        externalId: "gated-org/gated-model#weights.gguf"
      }
    });

    expect(record.state).toBe("ACCESS_REQUIRED");
    expect(record.stateReason).toMatch(/access/i);
  });
});
