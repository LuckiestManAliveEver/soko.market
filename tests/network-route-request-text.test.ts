import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");
const networkState = readFileSync("apps/web/src/hooks/useNetworkState.ts", "utf8");
const ownerWorkspace = readFileSync("apps/web/src/OwnerWorkspace.tsx", "utf8");

describe("network route requests carry the owner's real message (Phase 4g)", () => {
  it("routes the chat request through the canonical network capability", () => {
    expect(chatRuntime).not.toContain("requestNetworkRoute");
    expect(chatRuntime).not.toContain("isNetworkDiscoveryRequest");
    expect(chatRuntime).toContain('result.turn.plan.toolName === "network.route"');
    expect(networkState).toContain(
      'requestText: requestText?.trim() || "Find suppliers through my network",'
    );
  });

  it("keeps targetNodeId as the first parameter so the existing UI call site is unaffected", () => {
    // OwnerWorkspace.tsx's "request a route to this specific node" button calls
    // requestNetworkRoute(targetNodeId) positionally - requestText had to be added as the second
    // parameter, not inserted first, or that call site would have silently broken.
    expect(networkState).toContain(
      "async function requestNetworkRoute(targetNodeId?: string, requestText?: string) {"
    );
    expect(ownerWorkspace).toContain("requestNetworkRoute(targetNodeId)");
  });
});
