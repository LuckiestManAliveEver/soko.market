import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { RuntimeRegistryContext, RuntimeRegistryResourceDetails } from "@soko/shared-types";
import { registerRuntimeRegistryRoutes } from "./routes.js";
import { createRuntimeRegistrySearchService } from "./search.js";
import { createRuntimeRegistryImportService } from "./import-service.js";
import { createMemoryRuntimeRegistryImportStore } from "./import-store.js";
import type { RuntimeRegistryAdapter } from "./types.js";

const publicContext: RuntimeRegistryContext = { accountId: "public", connected: false };

function fakeAdapter(id: "github" | "soko", externalId: string): RuntimeRegistryAdapter {
  return {
    id,
    displayName: id,
    async search() {
      return [
        {
          provider: id,
          kind: "model",
          externalId,
          name: externalId,
          displayName: externalId,
          description: "a fake item",
          owner: null,
          repositoryId: null,
          revision: null,
          verified: true,
          imported: false,
          compatibility: { status: "compatible" }
        }
      ];
    },
    async inspect(): Promise<RuntimeRegistryResourceDetails> {
      return {
        provider: id,
        kind: "agent",
        externalId,
        name: externalId,
        displayName: externalId,
        description: "a fake item",
        owner: null,
        repositoryId: null,
        revision: null,
        license: "MIT",
        verified: true,
        imported: false,
        compatibility: { status: "compatible" },
        readmeExcerpt: null,
        files: [],
        providerMetadata: {}
      };
    }
  };
}

describe("registerRuntimeRegistryRoutes", () => {
  it("exposes GET /v1/runtime-registry/search, applying the minimum-query-length short circuit", async () => {
    const github = fakeAdapter("github", "gh-widget");
    const soko = fakeAdapter("soko", "soko-widget");
    const app = Fastify();
    registerRuntimeRegistryRoutes(app, {
      searchService: createRuntimeRegistrySearchService({ adapters: { github, soko } }),
      adapters: { github, soko },
      importService: createRuntimeRegistryImportService({
        store: createMemoryRuntimeRegistryImportStore(),
        adapters: { github, soko }
      }),
      resolveContext: () => publicContext,
      requireAccount: () => ({ accountId: "acct-1", userId: "user-1" })
    });

    const searchResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime-registry/search?q=widget"
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(
      searchResponse
        .json()
        .items.map((item: { externalId: string }) => item.externalId)
        .sort()
    ).toEqual(["gh-widget", "soko-widget"]);

    const tooShortResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime-registry/search?q=a"
    });
    expect(tooShortResponse.statusCode).toBe(200);
    expect(tooShortResponse.json()).toEqual({ items: [], providers: {} });

    await app.close();
  });

  it("exposes GET /v1/runtime-registry/resources/:provider/:id", async () => {
    const github = fakeAdapter("github", "example/agent-repo");
    const app = Fastify();
    registerRuntimeRegistryRoutes(app, {
      searchService: createRuntimeRegistrySearchService({ adapters: { github } }),
      adapters: { github },
      importService: createRuntimeRegistryImportService({
        store: createMemoryRuntimeRegistryImportStore(),
        adapters: { github }
      }),
      resolveContext: () => publicContext,
      requireAccount: () => ({ accountId: "acct-1", userId: "user-1" })
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/runtime-registry/resources/github/example%2Fagent-repo?kind=agent"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: "github", externalId: "example/agent-repo" });

    const missingKind = await app.inject({
      method: "GET",
      url: "/v1/runtime-registry/resources/github/example%2Fagent-repo"
    });
    expect(missingKind.statusCode).toBe(400);

    await app.close();
  });

  it("starts and polls an import through POST/GET /v1/runtime-registry/imports", async () => {
    const github = fakeAdapter("github", "example/agent-repo");
    const app = Fastify();
    const importStore = createMemoryRuntimeRegistryImportStore();
    registerRuntimeRegistryRoutes(app, {
      searchService: createRuntimeRegistrySearchService({ adapters: { github } }),
      adapters: { github },
      importService: createRuntimeRegistryImportService({ store: importStore, adapters: { github } }),
      resolveContext: () => publicContext,
      requireAccount: () => ({ accountId: "acct-1", userId: "user-1" })
    });

    const startResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime-registry/imports",
      payload: { provider: "github", kind: "agent", externalId: "example/agent-repo" }
    });
    expect(startResponse.statusCode).toBe(200);
    const started = startResponse.json();
    expect(started.state).toBe("REGISTERED");

    const pollResponse = await app.inject({
      method: "GET",
      url: `/v1/runtime-registry/imports/${started.id}`
    });
    expect(pollResponse.statusCode).toBe(200);
    expect(pollResponse.json().state).toBe("REGISTERED");

    const listResponse = await app.inject({ method: "GET", url: "/v1/runtime-registry/imports" });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().imports).toHaveLength(1);

    const missingResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime-registry/imports/does-not-exist"
    });
    expect(missingResponse.statusCode).toBe(404);

    await app.close();
  });
});
