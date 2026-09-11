// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://offline-runtime.test.invalid/"}
import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import {
  executeProviderCall,
  LocalProvider,
  openLocalDatabase,
  installOfflineRuntime
} from "../packages/offline-runtime/index";
import { WEBLLM_PINNED_MODEL, webllmManifestPath } from "../apps/web/src/webllm-model-manifest";
import {
  createWebLLMRuntimeAdapter,
  resolveWebLLMRuntimeBinding,
  resetWebLLMRuntimeForTests
} from "../apps/web/src/webllm-runtime";

const approvedModelUrl = `${WEBLLM_PINNED_MODEL.modelOrigin}${WEBLLM_PINNED_MODEL.modelId}`;

let createMLCEngineImpl: (
  modelId: string,
  config?: { initProgressCallback?: (report: { progress: number }) => void }
) => Promise<{ chat: { completions: { create: typeof chatCompletionsCreate } } }>;
let modelList: Array<{
  model: string;
  model_id: string;
  model_lib: string;
  vram_required_MB?: number;
}>;
let chatCompletionsCreate: (request: unknown) => Promise<unknown>;

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: (modelId: string, config?: unknown) =>
    createMLCEngineImpl(modelId, config as never),
  get prebuiltAppConfig() {
    return { model_list: modelList };
  }
}));

function resetMocks(): void {
  chatCompletionsCreate = vi.fn(async () => ({
    choices: [{ message: { content: "Offline reply" } }]
  }));
  modelList = [
    {
      model: approvedModelUrl,
      model_id: WEBLLM_PINNED_MODEL.modelId,
      model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/fake.wasm",
      vram_required_MB: 1
    }
  ];
  createMLCEngineImpl = vi.fn(async (_modelId, config) => {
    config?.initProgressCallback?.({ progress: 0.5 });
    config?.initProgressCallback?.({ progress: 1 });
    return { chat: { completions: { create: chatCompletionsCreate } } };
  });
}
resetMocks();

function stubBrowserGlobals(options: { gpu?: boolean; quotaBytes?: number } = {}): void {
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { estimate: async () => ({ quota: options.quotaBytes ?? 2 ** 30, usage: 0 }) }
  });
  if (options.gpu) Object.defineProperty(navigator, "gpu", { configurable: true, value: {} });
  else Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
  const stored = new Map<string, Response>();
  const fakeCache = {
    match: async (key: string) => stored.get(key)?.clone(),
    put: async (key: string, response: Response) => {
      stored.set(key, response);
    }
  } as unknown as Cache;
  vi.stubGlobal("caches", { open: async () => fakeCache } as unknown as CacheStorage);
}

function manifestBytes(): Uint8Array {
  const publicManifestPath = resolve(process.cwd(), "apps/web/public/webllm-runtime/manifest.json");
  return new Uint8Array(readFileSync(publicManifestPath));
}

function stubManifestFetch(): void {
  const bytes = manifestBytes();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(webllmManifestPath)) return new Response(bytes);
      throw new Error(`Unexpected fetch in test: ${url}`);
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebLLMRuntimeForTests();
  resetMocks();
});

describe("WebLLM offline runtime adapter", () => {
  it("resolves a RuntimeBinding whose artifact hash matches whatever the manifest actually serves", async () => {
    stubBrowserGlobals();
    stubManifestFetch();
    const binding = await resolveWebLLMRuntimeBinding();
    expect(binding.agentId).toBe(WEBLLM_PINNED_MODEL.agentId);
    expect(binding.modelId).toBe(WEBLLM_PINNED_MODEL.modelId);
    expect(binding.artifacts).toHaveLength(1);
    expect(binding.artifacts[0]!.url.endsWith(webllmManifestPath)).toBe(true);
    expect(new URL(binding.artifacts[0]!.url).protocol).toBe("https:");
    const expectedDigest = await webcrypto.subtle.digest("SHA-256", manifestBytes());
    const expectedSha256 = [...new Uint8Array(expectedDigest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(binding.artifacts[0]!.sha256).toBe(expectedSha256);
    expect(binding.artifacts[0]!.bytes).toBe(manifestBytes().byteLength);
  });

  it("is unsupported without WebGPU and for any binding that isn't this build's pinned model", async () => {
    stubBrowserGlobals({ gpu: false });
    stubManifestFetch();
    const binding = await resolveWebLLMRuntimeBinding();
    const adapter = createWebLLMRuntimeAdapter();
    expect(await adapter.supports(binding)).toBe(false);
    stubBrowserGlobals({ gpu: true });
    expect(await adapter.supports(binding)).toBe(true);
    expect(await adapter.supports({ ...binding, modelId: "some-other-model" })).toBe(false);
  });

  it("verifies the manifest, checks real device storage against webllm's own vram figure, and reports install progress to completion", async () => {
    stubBrowserGlobals({ gpu: true, quotaBytes: 2 ** 30 });
    stubManifestFetch();
    const binding = await resolveWebLLMRuntimeBinding();
    const adapter = createWebLLMRuntimeAdapter();
    const progress = vi.fn();
    await adapter.install(binding, progress);
    expect(createMLCEngineImpl).toHaveBeenCalledWith(
      WEBLLM_PINNED_MODEL.modelId,
      expect.objectContaining({ appConfig: { model_list: [modelList[0]] } })
    );
    const [, total] = progress.mock.calls.at(-1)!;
    expect(progress).toHaveBeenLastCalledWith(total, total);
  });

  it("blocks installation when the manifest was tampered with, without ever creating an engine", async () => {
    stubBrowserGlobals({ gpu: true });
    stubManifestFetch();
    const binding = await resolveWebLLMRuntimeBinding();
    const tampered = {
      ...binding,
      artifacts: [{ ...binding.artifacts[0]!, sha256: "0".repeat(64) }]
    };
    const adapter = createWebLLMRuntimeAdapter();
    await expect(adapter.install(tampered, vi.fn())).rejects.toThrow(/integrity/i);
    expect(createMLCEngineImpl).not.toHaveBeenCalled();
  });

  it("blocks installation on a device without enough free storage for the real model footprint", async () => {
    stubBrowserGlobals({ gpu: true, quotaBytes: 10 * 1024 * 1024 });
    stubManifestFetch();
    modelList[0]!.vram_required_MB = 2048;
    const binding = await resolveWebLLMRuntimeBinding();
    const adapter = createWebLLMRuntimeAdapter();
    await expect(adapter.install(binding, vi.fn())).rejects.toThrow(/not enough space/i);
    expect(createMLCEngineImpl).not.toHaveBeenCalled();
  });

  it("infers a labeled offline reply from the prompt and rejects an empty message", async () => {
    stubBrowserGlobals({ gpu: true });
    stubManifestFetch();
    const binding = await resolveWebLLMRuntimeBinding();
    const adapter = createWebLLMRuntimeAdapter();
    await expect(adapter.infer(binding, { prompt: "  " })).rejects.toThrow(/message is required/i);
    const result = (await adapter.infer(binding, { prompt: "What's my stock of rice?" })) as {
      reply: string;
      modelId: string;
      engine: string;
      answeredOffline: boolean;
    };
    expect(result).toEqual({
      reply: "Offline reply",
      modelId: WEBLLM_PINNED_MODEL.modelId,
      modelVersion: WEBLLM_PINNED_MODEL.modelVersion,
      engine: "webllm",
      answeredOffline: true
    });
    const request = (chatCompletionsCreate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "What's my stock of rice?" });
    expect(request.messages[0]!.role).toBe("system");
  });

  it("wires end to end through LocalProvider and the resolver, exactly like every other offline-relevant op", async () => {
    stubBrowserGlobals({ gpu: true });
    stubManifestFetch();
    const scope = { accountId: "account", storeId: "shop", deviceId: "device" };
    const db = await openLocalDatabase(new IDBFactory());
    const binding = await resolveWebLLMRuntimeBinding();
    const adapter = createWebLLMRuntimeAdapter();
    await installOfflineRuntime({
      db,
      scope,
      businessDataOnly: false,
      binding,
      adapter,
      estimate: async () => ({ quota: 2 ** 30, usage: 0 }),
      snapshot: async () => ({
        accountId: scope.accountId,
        storeId: scope.storeId,
        cursor: "0",
        collections: {}
      }),
      progress: () => undefined
    });
    const local = new LocalProvider(db, scope, (pin, args) => adapter.infer(pin, args));
    const reply = (await executeProviderCall("agent.infer", { prompt: "Hello" }, [local], {
      online: false,
      offlineModeActive: true,
      localAuthorized: true
    })) as { answeredOffline: boolean };
    expect(reply.answeredOffline).toBe(true);
    db.close();
  });
});
