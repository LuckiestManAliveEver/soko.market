import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { NativeAgentModelRuntimeBridge } from "../apps/web/src/agent-model-runtime";
import { collectClientWorkspaceFileTransfers } from "../apps/web/src/local-workspace-files";

describe("client-local workspace file transfer", () => {
  it("reads the exact server-tool proposal through the installed-app workspace bridge", async () => {
    const bytes = Buffer.from("local report");
    const readWorkspaceFile = vi.fn(async () => ({ contentBase64: bytes.toString("base64") }));
    const transfers = await collectClientWorkspaceFileTransfers({
      outputText: JSON.stringify({
        type: "tool",
        toolName: "workspace.deliver",
        input: { path: "reports/monthly.txt" },
        reason: "Deliver the report."
      }),
      runtime: "native-llama-cpp",
      businessId: "business-1",
      nativeBridge: nativeBridge(readWorkspaceFile)
    });

    expect(readWorkspaceFile).toHaveBeenCalledWith({
      businessId: "business-1",
      path: "reports/monthly.txt"
    });
    expect(transfers).toEqual([
      {
        path: "reports/monthly.txt",
        contentBase64: bytes.toString("base64"),
        checksum: createHash("sha256").update(bytes).digest("hex")
      }
    ]);
  });

  it("does not read files for non-delivery output and rejects traversal before the bridge", async () => {
    const readWorkspaceFile = vi.fn(async () => ({ contentBase64: "" }));
    const bridge = nativeBridge(readWorkspaceFile);
    await expect(
      collectClientWorkspaceFileTransfers({
        outputText: '{"type":"response","message":"Hello"}',
        runtime: "native-llama-cpp",
        businessId: "business-1",
        nativeBridge: bridge
      })
    ).resolves.toEqual([]);
    await expect(
      collectClientWorkspaceFileTransfers({
        outputText: JSON.stringify({
          type: "tool",
          toolName: "workspace.deliver",
          input: { path: "../secret.txt" }
        }),
        runtime: "native-llama-cpp",
        businessId: "business-1",
        nativeBridge: bridge
      })
    ).rejects.toThrow("local workspace path is invalid");
    expect(readWorkspaceFile).not.toHaveBeenCalled();
  });
});

function nativeBridge(
  readWorkspaceFile: NonNullable<NativeAgentModelRuntimeBridge["readWorkspaceFile"]>
): NativeAgentModelRuntimeBridge {
  return {
    async inspect() {
      throw new Error("unused");
    },
    async load() {},
    async generate() {
      throw new Error("unused");
    },
    async unload() {},
    async health() {
      return { status: "READY" };
    },
    readWorkspaceFile
  };
}
