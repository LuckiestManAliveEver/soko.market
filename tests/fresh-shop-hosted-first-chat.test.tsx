// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatRuntimeState } from "../apps/web/src/hooks/useChatRuntimeState";
import type { ActiveBusiness, AgentSettings, SessionResponse } from "../apps/web/src/soko-application-shared";

// Regression coverage for the private on-device model architecture's removal: a fresh shop's
// first AI message must reach the plain server runtime turn with zero client-side model state -
// no device id, no local model installation, no browser-inference session, nothing read or
// written before the request goes out. This is what "hosted-first" means end to end, not just at
// the type level.
describe("fresh shop, first AI message: hosted-first with no client model state", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function business(): ActiveBusiness {
    return {
      id: "fresh-shop-1",
      name: "Fresh Shop",
      language: "en",
      sokoId: "fresh-shop-1",
      role: "owner"
    } as unknown as ActiveBusiness;
  }

  function agentSettings(): AgentSettings {
    return {
      model: "smollm2-360m",
      role: "shopkeeper",
      instructions: "Help the owner run their shop.",
      name: "Shopkeeper"
    } as unknown as AgentSettings;
  }

  function session(): SessionResponse {
    return {
      account: {
        id: "account-1",
        primaryAuthChannel: "phone",
        primaryAuthDestination: "+254700000000",
        identityLevel: "verified_contact"
      },
      user: { id: "user-1", accountId: "account-1", displayName: "Owner", language: "en" },
      session: { id: "session-1", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
    } as unknown as SessionResponse;
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  }

  it("sends the first message straight to the plain server runtime turn, with no device/model fetch", async () => {
    const fetchedPaths: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url, "http://localhost").pathname;
      fetchedPaths.push(path);
      if (path === "/v1/messages") {
        return jsonResponse({
          id: "merchant-message-1",
          agentMessage: { id: "agent-message-1" },
          runtime: null
        });
      }
      throw new Error(`Unexpected fetch to ${path} - a fresh shop's first message should only ` +
        "call POST /v1/messages, never an owner-node/device endpoint.");
    });
    vi.stubGlobal("fetch", fetchMock);

    let sendChatDraft: ((draft?: string) => Promise<void>) | null = null;
    function Harness() {
      const api = useChatRuntimeState({
        business: business(),
        mode: "buyer",
        session: session(),
        authBootstrapState: "authenticated",
        ensureAuthenticatedSession: async () => session(),
        rejectDefinitiveAuthenticationFailure: () => false,
        agentSettings: agentSettings(),
        setStatusMessage: () => undefined,
        navigateToView: () => undefined,
        requireMessagingSignIn: () => undefined,
        loadProducts: async () => undefined,
        loadSuppliers: async () => undefined,
        loadCustomers: async () => undefined,
        loadInvoices: async () => undefined,
        loadReports: async () => undefined,
        loadNotifications: async () => undefined,
        loadRuntimeSessions: async () => undefined,
        createManagedRuntimeSession: async () => "runtime-session-1",
        ensureRuntimeSession: async (setRuntimeSessionId) => {
          setRuntimeSessionId("runtime-session-1");
          return "runtime-session-1";
        },
        loadDocumentImports: async () => undefined,
        chatMessages: [],
        setChatMessages: () => undefined,
        chatDraft: "",
        setChatDraft: () => undefined,
        pendingAttachments: [],
        setPendingAttachments: () => undefined,
        runtimeSessionId: null,
        setRuntimeSessionId: () => undefined,
        replyToMessageId: null,
        setReplyToMessageId: () => undefined,
        activeConversationId: "conversation-1",
        activeConversation: null,
        loadMessagingInbox: async () => undefined,
        registerReset: () => undefined
      });
      sendChatDraft = api.sendChatDraft;
      return null;
    }

    await act(async () => {
      root = createRoot(host);
      root.render(<Harness />);
    });

    expect(sendChatDraft).not.toBeNull();
    expect(localStorage.length).toBe(0);

    await act(async () => {
      await sendChatDraft!("Hello, what can you help me with today?");
    });

    expect(fetchedPaths).toEqual(["/v1/messages"]);
    expect(fetchedPaths.some((path) => path.includes("owner-node"))).toBe(false);
    expect(fetchedPaths.some((path) => path.includes("device"))).toBe(false);

    const [, requestInit] = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined];
    const body = JSON.parse(String(requestInit?.body)) as {
      agent?: { businessId: string; message: string };
    };
    expect(body.agent).toMatchObject({ businessId: "fresh-shop-1" });

    // No on-device model assignment, browser-inference session, or model-scoped device id was
    // read or written - only lib/api.ts's generic request-tracing device id (unrelated to model
    // execution) may exist. The retired keys (agent-model-assignment.ts's
    // "soko.agent-model-assignment.v1", browser-inference-*'s IndexedDB/localStorage state) must
    // never reappear.
    const storedKeys = Object.keys(localStorage);
    expect(storedKeys).not.toContain("soko.agent-model-assignment.v1");
    expect(storedKeys.some((key) => key.includes("model-scope"))).toBe(false);
    expect(storedKeys.some((key) => key.includes("browser-inference"))).toBe(false);
  });
});
