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
    return { id, role: "owner", sokoId: `soko.${id}` } as unknown as ActiveBusiness;
  }

  function agent(): AgentSettings {
    return {
      name: "Shopkeeper",
      model: "smollm2-360m",
      agentDefinitionId: "builtin:shopkeeper",
      contextScripts: []
    } as unknown as AgentSettings;
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

  it("loads the registered agent definitions and hosted models, and shows the shop's current selection", async () => {
    stubFetch({
      "/v1/platform/agent-catalog": () =>
        jsonResponse({
          agents: [
            {
              id: "builtin:shopkeeper",
              displayName: "Shopkeeper",
              description: "The default agent."
            },
            {
              id: "builtin:pi-assistant",
              displayName: "Shopkeeper (Pi engine)",
              description: "Same behavior, running on Pi."
            }
          ]
        }),
      "/businesses/agent-shop/runtime/effective": () =>
        jsonResponse({
          agent: {
            id: "builtin:pi-assistant",
            name: "Shopkeeper (Pi engine)",
            runtimeAdapterId: "pi"
          },
          model: { id: "smollm2-360m", name: "SmolLM2 360M Instruct Q4_0" },
          execution: { type: "backend", hostId: "host-1", ready: true },
          binding: { id: "binding-1" },
          source: "default",
          status: "READY",
          ready: true
        }),
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
        })
    });

    await act(async () => {
      root = createRoot(host);
      root.render(
        <QuickRuntimeSwitcher
          business={business("agent-shop")}
          agent={agent()}
          updateAgent={vi.fn()}
          onAgentChange={vi.fn()}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const agentSelect = host.querySelector<HTMLSelectElement>("select");
    expect(agentSelect?.value).toBe("builtin:pi-assistant");
    const selects = host.querySelectorAll<HTMLSelectElement>("select");
    const modelSelect = selects[1] as HTMLSelectElement;
    expect(modelSelect.value).toBe("smollm2-360m");
    const modelOptionValues = [...modelSelect.options].map((option) => option.value);
    expect(modelOptionValues).toEqual(["smollm2-360m"]);
  });

  it("activates an agent-definition change immediately and reports the new selection", async () => {
    const profileUpdateBodies: unknown[] = [];
    stubFetch({
      "/v1/platform/agent-catalog": () =>
        jsonResponse({
          agents: [
            { id: "builtin:shopkeeper", displayName: "Shopkeeper", description: "" },
            { id: "builtin:pi-assistant", displayName: "Shopkeeper (Pi engine)", description: "" }
          ]
        }),
      "/businesses/agent-shop-2/runtime/effective": () =>
        jsonResponse({
          agent: { id: "builtin:shopkeeper", name: "Shopkeeper", runtimeAdapterId: "soko" },
          model: { id: "smollm2-360m", name: "SmolLM2 360M Instruct Q4_0" },
          execution: { type: "backend", hostId: "host-1", ready: true },
          binding: { id: "binding-1" },
          source: "default",
          status: "READY",
          ready: true
        }),
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
        })
    });

    const updateAgent = vi.fn();
    const onAgentChange = vi.fn();
    await act(async () => {
      root = createRoot(host);
      root.render(
        <QuickRuntimeSwitcher
          business={business("agent-shop-2")}
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
      "/businesses/agent-shop-2/agent-profile": (init) => {
        profileUpdateBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({
          agentDefinitionId: "builtin:pi-assistant",
          name: "Shopkeeper",
          description: "",
          modelId: "smollm2-360m",
          role: "General shopkeeper",
          language: "en",
          personality: "Warm",
          instructions: "Handle one task at a time.",
          knowledge: "Use saved records.",
          tools: [],
          integrations: [],
          contextScripts: [],
          runtimeVersion: 2
        });
      }
    });

    const agentSelect = host.querySelector<HTMLSelectElement>("select") as HTMLSelectElement;
    await act(async () => {
      agentSelect.value = "builtin:pi-assistant";
      agentSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(profileUpdateBodies[0]).toMatchObject({
      agentDefinitionId: "builtin:pi-assistant"
    });
    expect(updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentDefinitionId: "builtin:pi-assistant" })
    );
    expect(host.textContent).toContain("Shopkeeper (Pi engine)");
  });
});
