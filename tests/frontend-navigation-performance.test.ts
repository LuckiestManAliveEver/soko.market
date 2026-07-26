import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearApiRequestCache,
  getCachedJson,
  invalidateApiCacheForMutation
} from "../apps/web/src/api-request-cache";

afterEach(() => {
  clearApiRequestCache();
  vi.unstubAllGlobals();
});

describe("frontend navigation performance contracts", () => {
  it("deduplicates concurrent reads and reuses stable cached data", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: ["small"] }), {
          headers: { "content-type": "application/json" },
          status: 200
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      getCachedJson<{ models: string[] }>("/v1/ai-models"),
      getCachedJson<{ models: string[] }>("/v1/ai-models")
    ]);
    const third = await getCachedJson<{ models: string[] }>("/v1/ai-models");

    expect(first).toEqual({ models: ["small"] });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps navigation, model discovery, and runtime initialization decoupled", () => {
    const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
    const navigationBlock = sourceFunction(application, "navigateToView");
    const settingsEffectStart = application.indexOf("void loadConnectedSocialAccounts();");
    const settingsMountEffect = application.slice(
      settingsEffectStart,
      application.indexOf("}, [accountId, business.id]);", settingsEffectStart)
    );

    expect(navigationBlock).toContain("window.history[method]");
    expect(navigationBlock).not.toContain("window.location.assign");
    expect(navigationBlock).not.toContain("window.location.reload");
    expect(navigationBlock).not.toContain("ensureRuntimeSession");
    expect(settingsMountEffect).not.toContain("loadAiModels(");
    expect(settingsMountEffect).not.toContain("inspectDeviceModelCapability(");
    expect(settingsMountEffect).not.toContain("loadBrowserInferenceState(");
    expect(application).toContain('setProfileMessage("Opening model settings…")');
  });

  it("does not precache model files and enables route/API performance measurements", () => {
    const serviceWorker = readFileSync("apps/web/public/sw.js", "utf8");
    const performanceSource = readFileSync("apps/web/src/performance.ts", "utf8");

    expect(serviceWorker).not.toMatch(/APP_SHELL[\s\S]*\.gguf/i);
    expect(performanceSource).toContain("[SOKO_PERF]");
    expect(performanceSource).toContain("performance.mark");
    expect(performanceSource).toContain("performance.measure");
    expect(performanceSource).toContain('"longtask"');
  });

  it("batches streamed model tokens to animation frames", () => {
    const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
    const start = application.indexOf("const updateStreamingMessage");
    const end = application.indexOf("async function runRoutedRuntimeTurn", start);
    const streamingBlock = application.slice(start, end);

    expect(streamingBlock).toContain("window.requestAnimationFrame");
    expect(streamingBlock).toContain("if (streamingFrame !== null) return");
    expect(streamingBlock).not.toContain(
      "browserTokenListener = (token) => {\n        setStatusMessage"
    );
  });

  it("invalidates related active-model reads after either model selection changes", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            path: typeof input === "string" ? input : input.toString(),
            request: fetchMock.mock.calls.length
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200
          }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await getCachedJson("/businesses/business-1/agent-model?deviceId=device-1");
    await getCachedJson("/businesses/business-1/ai-model");
    await getCachedJson("/businesses/business-1/agent-profile");
    invalidateApiCacheForMutation("/businesses/business-1/agent-model?deviceId=device-1");
    await getCachedJson("/businesses/business-1/agent-model?deviceId=device-1");
    await getCachedJson("/businesses/business-1/ai-model");
    await getCachedJson("/businesses/business-1/agent-profile");

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

function sourceFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end);
}
