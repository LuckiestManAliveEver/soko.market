import { describe, expect, it } from "vitest";
import { runtimeToolRegistry, type RuntimeToolName } from "../packages/tool-core/src";
import { executeComputerCapability } from "../services/api/src/cp2/domains/agent-runtime/computer-capabilities.js";
import type { AgentRuntimeDomainDeps } from "../services/api/src/cp2/domains/agent-runtime/domain-deps.js";

const computerToolNames = Object.keys(runtimeToolRegistry).filter((name) =>
  name.startsWith("computer.")
) as RuntimeToolName[];

describe("computer.* registry entries", () => {
  it("registers exactly the 13 capabilities the architecture doc lists", () => {
    expect(computerToolNames.sort()).toEqual(
      [
        "computer.checkpoint",
        "computer.click",
        "computer.close",
        "computer.control.release",
        "computer.control.take",
        "computer.navigate",
        "computer.observe",
        "computer.scroll",
        "computer.session.create",
        "computer.session.resume",
        "computer.suspend",
        "computer.type",
        "computer.upload"
      ].sort()
    );
  });

  it("every computer.* tool is not MCP-exposable (matches every other tool's current default)", () => {
    for (const name of computerToolNames) {
      expect(runtimeToolRegistry[name].mcpExposable).toBe(false);
    }
  });

  it("every computer.* tool declares requiresConfirmation: false (the dynamic policy gate lives in the domain, not the static registry)", () => {
    for (const name of computerToolNames) {
      expect(runtimeToolRegistry[name].requiresConfirmation).toBe(false);
    }
  });

  it("every computer.* tool has a non-empty description and inputSchema", () => {
    for (const name of computerToolNames) {
      const definition = runtimeToolRegistry[name];
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.inputSchema.type).toBe("object");
    }
  });
});

describe("executeComputerCapability dispatch coverage", () => {
  it("has a dispatch case for every registered computer.* tool name (no silent null fallthrough)", async () => {
    for (const toolName of computerToolNames) {
      const deps = fakeDispatchDeps();
      const result = await executeComputerCapability(deps, {
        sessionId: "session-1",
        businessId: "biz-1",
        conversationId: "conv-1",
        now: new Date(),
        action: {
          id: "action-1",
          toolName,
          input: { computerSessionId: "cs-1" },
          risk: "low",
          requiresConfirmation: false,
          status: "safe_to_execute",
          validationErrors: [],
          confirmationToken: null,
          executedAt: null
        }
      });
      expect(result).not.toBeNull();
    }
  });
});

function fakeDispatchDeps(): AgentRuntimeDomainDeps {
  const marker = { called: true };
  const asyncMarker = () => Promise.resolve(marker);
  return {
    computerSessionCreate: asyncMarker,
    computerSessionResume: asyncMarker,
    computerNavigate: asyncMarker,
    computerObserve: asyncMarker,
    computerClick: asyncMarker,
    computerType: asyncMarker,
    computerScroll: asyncMarker,
    computerUpload: asyncMarker,
    computerControlTake: () => marker,
    computerControlRelease: asyncMarker,
    computerCheckpoint: asyncMarker,
    computerSuspend: asyncMarker,
    computerClose: asyncMarker
  } as unknown as AgentRuntimeDomainDeps;
}
