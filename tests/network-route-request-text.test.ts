import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");
const networkState = readFileSync("apps/web/src/hooks/useNetworkState.ts", "utf8");
const sokoApplication = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");

describe("network route requests carry the owner's real message (Phase 4g)", () => {
  it("passes the chat message as requestText instead of a hard-coded string", () => {
    // Before this fix, "find a supplier for rice through my network" silently became the generic
    // "Find suppliers through my network" by the time it reached the server - which matches
    // requestText against network node names, so the specific request was lost every time.
    expect(chatRuntime).toContain("await requestNetworkRoute(undefined, agentRequest);");
    expect(networkState).toContain(
      'requestText: requestText?.trim() || "Find suppliers through my network",'
    );
  });

  it("keeps targetNodeId as the first parameter so the existing UI call site is unaffected", () => {
    // SokoApplication.tsx's "request a route to this specific node" button calls
    // requestNetworkRoute(targetNodeId) positionally - requestText had to be added as the second
    // parameter, not inserted first, or that call site would have silently broken.
    expect(networkState).toContain(
      "async function requestNetworkRoute(targetNodeId?: string, requestText?: string) {"
    );
    expect(sokoApplication).toContain("requestNetworkRoute(targetNodeId)");
  });
});
