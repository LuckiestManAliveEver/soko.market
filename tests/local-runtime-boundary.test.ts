import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The per-device LOCAL_ONLY/LOCAL_FIRST/CLOUD_ONLY execution-mode preference this suite used to
// guard (DeviceAgentModelAssignment.preferredExecutionMode, in the now-deleted
// apps/web/src/agent-model-assignment.ts) was retired with the private on-device model
// architecture. The one surviving client-side route is owner-node, a shop-owned authenticated
// device registered as an execution host - it is not a private per-browser model copy, and it has
// no local-only/cloud-only toggle of its own. This suite now guards that boundary instead: a
// tool-requiring message never routes to owner-node, and every message otherwise still resolves
// to a real execution path (owner-node when reachable, the plain server turn otherwise).
describe("optional client-side runtime boundary", () => {
  const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");

  it("excludes owner-node from candidacy for a tool-requiring request", () => {
    expect(chatRuntime).toContain("inferenceRequest !== null &&");
    expect(chatRuntime).toContain("business !== null &&");
    expect(chatRuntime).toContain("ownerNodeReachable &&");
    expect(chatRuntime).toContain("!requiresServerTool");
  });

  it("falls through to the plain server turn whenever no client route was selected", () => {
    expect(chatRuntime).toContain("const shouldResolveClientInference = inferenceRoute !== null;");
    expect(chatRuntime).toContain(
      "const shouldRequestServerInference = !shouldResolveClientInference;"
    );
    expect(chatRuntime).toContain(
      "postJson<RuntimeTurnResult>(`/businesses/${business.id}/runtime/turns`"
    );
  });

  it("does not reintroduce the retired per-device execution-mode preference", () => {
    expect(chatRuntime).not.toContain("readyLocalAssignment");
    expect(chatRuntime).not.toContain("localOnly");
    expect(chatRuntime).not.toContain("preferredExecutionMode");
    expect(chatRuntime).not.toContain("CLOUD_ONLY");
    expect(chatRuntime).not.toContain("downloadedAgentAndModelActive");
  });
});
