import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("optional local runtime boundary", () => {
  it("allows remote and server fallback unless the merchant explicitly selected local-only", () => {
    const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");

    expect(chatRuntime).toContain(
      "allowOwnerNode: clientInferenceFeatureFlags.ownerNode && !localOnly"
    );
    expect(chatRuntime).toContain(
      "const shouldRequestServerInference = !shouldResolveClientInference"
    );
    expect(chatRuntime).toContain("if (localOnly)");
    expect(chatRuntime).not.toContain("downloadedAgentAndModelActive");
  });

  it("never reports the downloaded GGUF path ready when the assignment is CLOUD_ONLY", () => {
    const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");

    expect(chatRuntime).toContain('readyLocalAssignment.preferredExecutionMode !== "CLOUD_ONLY"');
  });
});
