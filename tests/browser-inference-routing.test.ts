import { describe, expect, it } from "vitest";
import { parseBrowserAgentAction } from "../apps/web/src/browser-agent-actions";
import { normalizeBrowserInferenceError } from "../apps/web/src/browser-model-engine";
import {
  decideInferenceRoute,
  requestRequiresServerTool
} from "../apps/web/src/browser-inference-routing";
import {
  isBrowserModelWorkerRequest,
  isBrowserModelWorkerResponse
} from "../apps/web/src/browser-model-worker-protocol";
import type {
  BrowserInferenceCapability,
  BrowserInferenceSettings
} from "../apps/web/src/browser-inference-types";

const capability: BrowserInferenceCapability = {
  supported: true,
  backend: "webgpu",
  deviceTier: "medium",
  maxRecommendedContextTokens: 2_048,
  reasons: [],
  browser: { name: "Chrome", version: "130", mobile: false },
  crossOriginIsolated: false,
  logicalProcessors: 8,
  indexedDbAvailable: true,
  persistentStorage: true,
  installedPwa: true,
  workerAvailable: true
};
const settings: BrowserInferenceSettings = {
  accountId: "account-a",
  businessId: "business-a",
  enabled: true,
  selectedModelId: "smollm2-360m-instruct-browser",
  status: "ready",
  downloadedAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
  lastErrorCode: null
};

describe("browser inference routing and validation", () => {
  it("selects browser-local only for a ready bounded conversational request", () => {
    expect(
      decideInferenceRoute({
        deploymentEnabled: true,
        settings,
        capability,
        modelLoaded: true,
        nativeReady: false,
        promptTokens: 500,
        contextLimit: 2_048,
        requiresServerTool: false,
        complexReasoning: false,
        pageActive: true
      })
    ).toMatchObject({ route: "browser-local", reasonCode: "LOCAL_READY" });
  });

  it.each([
    ["disabled", { deploymentEnabled: false }, "LOCAL_DISABLED"],
    ["unsupported", { capability: { ...capability, supported: false } }, "DEVICE_UNSUPPORTED"],
    ["too large", { promptTokens: 3_000 }, "CONTEXT_TOO_LARGE"],
    ["server action", { requiresServerTool: true }, "SERVER_TOOL_REQUIRED"],
    ["inactive tab", { pageActive: false }, "COMPLEXITY_ESCALATION"]
  ])("falls back explicitly when %s", (_label, override, reasonCode) => {
    const decision = decideInferenceRoute({
      deploymentEnabled: true,
      settings,
      capability,
      modelLoaded: true,
      nativeReady: false,
      promptTokens: 500,
      contextLimit: 2_048,
      requiresServerTool: false,
      complexReasoning: false,
      pageActive: true,
      ...override
    });
    expect(decision.route).toBe("server");
    expect(decision.reasonCode).toBe(reasonCode);
  });

  it("routes write intents to server tools", () => {
    expect(requestRequiresServerTool("Please create an order for two bags")).toBe(true);
    expect(requestRequiresServerTool("What products do you have?")).toBe(false);
  });

  it("validates worker contracts and untrusted structured actions", () => {
    expect(isBrowserModelWorkerRequest({ type: "GENERATE", requestId: "r1", request: {} })).toBe(
      true
    );
    expect(isBrowserModelWorkerRequest({ type: "GENERATE" })).toBe(false);
    expect(isBrowserModelWorkerResponse({ type: "TOKEN", requestId: "r1", token: "Hi" })).toBe(
      true
    );
    expect(parseBrowserAgentAction({ type: "CHAT_REPLY", message: " Hello " })).toEqual({
      type: "CHAT_REPLY",
      message: "Hello"
    });
    expect(parseBrowserAgentAction({ type: "DELETE_ACCOUNT", id: "victim" })).toBeNull();
  });

  it("normalizes safe errors without exposing arbitrary details", () => {
    expect(normalizeBrowserInferenceError(new Error("GPU buffer allocation failed")).code).toBe(
      "OUT_OF_MEMORY"
    );
    expect(normalizeBrowserInferenceError(new Error("private prompt text")).message).toBe(
      "Browser inference failed safely."
    );
  });
});
