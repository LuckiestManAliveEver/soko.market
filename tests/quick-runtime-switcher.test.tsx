// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickRuntimeSwitcher } from "../apps/web/src/QuickRuntimeSwitcher";
import type { ActiveBusiness, AgentSettings } from "../apps/web/src/soko-application-shared";

describe("quick runtime switcher", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  function business(id: string): ActiveBusiness {
    return { id, role: "owner" } as unknown as ActiveBusiness;
  }

  function agent(): AgentSettings {
    return { name: "Shopkeeper", model: "smollm2-360m" } as unknown as AgentSettings;
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }

  function stubFetch(
    handlers: Record<string, (init: RequestInit | undefined) => Response>
  ): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url, "http://localhost").pathname;
      const handler = handlers[path];
      if (handler === undefined) {
        throw new Error(`Unexpected fetch to ${path}`);
      }
      return handler(init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("loads the registered harnesses and hosted models, and shows the shop's current selection", async () => {
    stubFetch({
      "/v1/platform/agent-runtime-adapters": () =>
        jsonResponse({
          adapters: [
            { id: "pi", displayName: "Pi", description: "The default harness." },
            { id: "soko", displayName: "Soko (built-in)", description: "The legacy harness." }
          ]
        }),
      "/api/agents/harness-shop/harness": () => jsonResponse({ agentRuntimeAdapterId: "pi" }),
      "/v1/ai-models": () =>
        jsonResponse({
          models: [
            {
              id: "smollm2-360m",
              label: "SmolLM2 360M Instruct Q4_0",
              provider: "local",
              description: "",
              capabilities: [],
              available: true,
              source: "hosted",
              format: "remote",
              license: null,
              licenseUrl: null,
              modelCardUrl: null,
              downloadUrl: null,
              fileName: null,
              fileSizeBytes: null,
              minimumMemoryGb: null,
              recommended: true,
              runtimeAvailability: { backend: "configured" }
            },
            {
              id: "qwen2.5-0.5b-android",
              label: "Qwen2.5 0.5B",
              provider: "local",
              description: "",
              capabilities: [],
              available: true,
              source: "huggingface",
              format: "GGUF",
              license: null,
              licenseUrl: null,
              modelCardUrl: null,
              downloadUrl: null,
              fileName: null,
              fileSizeBytes: null,
              minimumMemoryGb: null,
              recommended: false
              // No runtimeAvailability.backend - a device-download model, must not appear here.
            }
          ]
        }),
      "/api/agents/harness-shop/model-binding": () =>
        jsonResponse({ binding: { modelId: "smollm2-360m" } })
    });

    await act(async () => {
      root = createRoot(host);
      root.render(
        <QuickRuntimeSwitcher
          business={business("harness-shop")}
          agent={agent()}
          updateAgent={vi.fn()}
          onAgentChange={vi.fn()}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const harnessSelect = host.querySelector<HTMLSelectElement>("select");
    expect(harnessSelect?.value).toBe("pi");
    const selects = host.querySelectorAll<HTMLSelectElement>("select");
    const modelSelect = selects[1] as HTMLSelectElement;
    expect(modelSelect.value).toBe("smollm2-360m");
    const modelOptionValues = [...modelSelect.options].map((option) => option.value);
    expect(modelOptionValues).toEqual(["smollm2-360m"]);
  });

  it("activates a harness change immediately and reports the new selection", async () => {
    const activateBodies: unknown[] = [];
    stubFetch({
      "/v1/platform/agent-runtime-adapters": () =>
        jsonResponse({
          adapters: [
            { id: "pi", displayName: "Pi", description: "" },
            { id: "soko", displayName: "Soko (built-in)", description: "" }
          ]
        }),
      "/api/agents/harness-shop-2/harness": () => jsonResponse({ agentRuntimeAdapterId: "pi" }),
      "/v1/ai-models": () =>
        jsonResponse({
          models: [
            {
              id: "smollm2-360m",
              label: "SmolLM2 360M Instruct Q4_0",
              provider: "local",
              description: "",
              capabilities: [],
              available: true,
              source: "hosted",
              format: "remote",
              license: null,
              licenseUrl: null,
              modelCardUrl: null,
              downloadUrl: null,
              fileName: null,
              fileSizeBytes: null,
              minimumMemoryGb: null,
              recommended: true,
              runtimeAvailability: { backend: "configured" }
            }
          ]
        }),
      "/api/agents/harness-shop-2/model-binding": () =>
        jsonResponse({ binding: { modelId: "smollm2-360m" } })
    });

    const updateAgent = vi.fn();
    const onAgentChange = vi.fn();
    await act(async () => {
      root = createRoot(host);
      root.render(
        <QuickRuntimeSwitcher
          business={business("harness-shop-2")}
          agent={agent()}
          updateAgent={updateAgent}
          onAgentChange={onAgentChange}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const fetchMock = stubFetch({
      "/api/agents/harness-shop-2/models/smollm2-360m/activate": (init) => {
        activateBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({
          binding: { modelId: "smollm2-360m", executionTarget: "backend" },
          healthCheck: { latencyMs: 5 }
        });
      }
    });

    const harnessSelect = host.querySelector<HTMLSelectElement>("select") as HTMLSelectElement;
    await act(async () => {
      harnessSelect.value = "soko";
      harnessSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(activateBodies[0]).toMatchObject({
      shopId: "harness-shop-2",
      agentRuntimeAdapterId: "soko"
    });
    expect(updateAgent).toHaveBeenCalledWith({ model: "smollm2-360m" });
    expect(host.textContent).toContain("Soko (built-in)");
  });
});
