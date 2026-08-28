import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { downloadedAgentModelMustStayLocal } from "../apps/web/src/inference/local-runtime-boundary";

describe("downloaded agent/model inference boundary", () => {
  it.each([
    { installedGgufReady: true, cachedBrowserModelReady: false },
    { installedGgufReady: false, cachedBrowserModelReady: true }
  ])("pins a linked agent with ready model weights to the browser", (modelState) => {
    expect(
      downloadedAgentModelMustStayLocal({
        linkedAgentDefinitionId: "github:openclaw/openclaw",
        activeAgentDefinitionId: "github:openclaw/openclaw",
        ...modelState
      })
    ).toBe(true);
  });

  it("does not pin a cloud model or a model linked to another agent", () => {
    expect(
      downloadedAgentModelMustStayLocal({
        linkedAgentDefinitionId: null,
        activeAgentDefinitionId: "github:openclaw/openclaw",
        installedGgufReady: false,
        cachedBrowserModelReady: false
      })
    ).toBe(false);
    expect(
      downloadedAgentModelMustStayLocal({
        linkedAgentDefinitionId: "huggingface:huggingface/smolagents",
        activeAgentDefinitionId: "github:openclaw/openclaw",
        installedGgufReady: true,
        cachedBrowserModelReady: false
      })
    ).toBe(false);
  });

  it("excludes remote providers and server inference from the downloaded runtime path", () => {
    const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");

    expect(chatRuntime).toContain(
      "clientInferenceFeatureFlags.ownerNode && !localOnly && !downloadedAgentAndModelActive"
    );
    expect(chatRuntime).toContain(
      "!shouldResolveClientInference && !downloadedAgentAndModelActive"
    );
  });

  it("never reports the downloaded GGUF path ready when the assignment is CLOUD_ONLY", () => {
    // The native GGUF provider itself is only registered when
    // `readyLocalAssignment.preferredExecutionMode !== "CLOUD_ONLY"`. installedGgufReady must use
    // that same condition - otherwise a stale CLOUD_ONLY assignment pins the session to a local
    // runtime that never gets registered, deadlocking every message with no recoverable provider.
    const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");
    const installedGgufReadyAssignment = chatRuntime.match(
      /installedGgufReady:\s*\n?\s*([^,]+),\n\s*cachedBrowserModelReady/
    );

    expect(installedGgufReadyAssignment).not.toBeNull();
    expect(installedGgufReadyAssignment?.[1]).toContain(
      'readyLocalAssignment?.preferredExecutionMode !== "CLOUD_ONLY"'
    );
  });
});
