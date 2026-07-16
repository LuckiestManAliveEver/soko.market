import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../services/api/src/app";
import {
  createGitHubModelCatalog,
  type GitHubModelCatalog
} from "../services/api/src/cp2/github-model-catalog";

describe("GitHub on-device model catalog", () => {
  it("discovers only Apache-2.0 Android-sized GGUF release assets and caches searches", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/search/repositories")) {
        return Response.json({
          items: [
            {
              full_name: "example/android-gguf",
              html_url: "https://github.com/example/android-gguf",
              default_branch: "main",
              description: "Compact multilingual model",
              license: { spdx_id: "Apache-2.0" }
            },
            {
              full_name: "example/wrong-license",
              html_url: "https://github.com/example/wrong-license",
              default_branch: "main",
              description: "Not commercially allowlisted",
              license: { spdx_id: "GPL-3.0" }
            }
          ]
        });
      }
      if (url === "https://api.github.com/repos/example/android-gguf/releases?per_page=5") {
        return Response.json([
          {
            name: "v1",
            tag_name: "v1",
            html_url: "https://github.com/example/android-gguf/releases/tag/v1",
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "qwen-mini-instruct-q4_k_m.gguf",
                size: 420 * 1024 ** 2,
                state: "uploaded",
                browser_download_url:
                  "https://github.com/example/android-gguf/releases/download/v1/qwen-mini-instruct-q4_k_m.gguf"
              },
              {
                name: "readme.txt",
                size: 1000,
                state: "uploaded",
                browser_download_url:
                  "https://github.com/example/android-gguf/releases/download/v1/readme.txt"
              },
              {
                name: "oversized.gguf",
                size: 3 * 1024 ** 3,
                state: "uploaded",
                browser_download_url:
                  "https://github.com/example/android-gguf/releases/download/v1/oversized.gguf"
              }
            ]
          }
        ]);
      }
      return new Response(null, { status: 404 });
    });
    const catalog = createGitHubModelCatalog({
      fetcher: fetcher as typeof fetch,
      now: () => 1_000
    });

    const first = await catalog.searchModels("qwen android");
    const second = await catalog.searchModels("qwen android");

    expect(first).toMatchObject({
      status: "available",
      models: [
        {
          id: expect.stringMatching(/^github:example\.android-gguf\./),
          source: "github",
          format: "GGUF",
          license: "Apache-2.0",
          minimumMemoryGb: 2,
          recommended: true
        }
      ]
    });
    expect(first.models[0]?.downloadUrl).toContain("/releases/download/v1/");
    expect(first.models[0]?.capabilities).toEqual(
      expect.arrayContaining(["offline", "multilingual", "instruction-following"])
    );
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("exposes GitHub discovery through the API route", async () => {
    const githubModelCatalog: GitHubModelCatalog = {
      async searchModels(search) {
        return {
          models: [],
          status: "available",
          message: `GitHub connected for ${search ?? "default"}.`
        };
      }
    };
    const app = buildApi({ cp2: { githubModelCatalog } });
    const response = await app.inject({
      method: "GET",
      url: "/v1/ai-models/github?search=smol"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [],
      status: "available",
      message: "GitHub connected for smol."
    });

    await app.close();
  });
});
