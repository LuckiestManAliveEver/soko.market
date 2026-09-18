import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkRetiredDeviceModelReferences,
  permittedOfflineInferencePackage,
  permittedWebLlmFiles,
  retiredBrowserInferencePackages
} from "../scripts/check-retired-device-model-references.mjs";

const workspaces: string[] = [];

function createWorkspace(files: Record<string, string>): string {
  const workspace = mkdtempSync(join(tmpdir(), "retired-device-model-check-"));
  workspaces.push(workspace);
  for (const [path, source] of Object.entries(files)) {
    const absolutePath = join(workspace, path);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, source);
  }
  return workspace;
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("retired device model reference gate", () => {
  it("keeps WebLLM out of the globally retired package list", () => {
    expect(retiredBrowserInferencePackages).not.toContain(permittedOfflineInferencePackage);
    expect(retiredBrowserInferencePackages).toEqual([
      "@huggingface/transformers",
      "@wllama/wllama"
    ]);
  });

  it("permits WebLLM only in the two explicit offline runtime adapters", () => {
    const workspace = createWorkspace({
      "apps/web/package.json": JSON.stringify({
        dependencies: { [permittedOfflineInferencePackage]: "0.2.85" }
      }),
      "apps/web/src/webllm-runtime.ts": `import type * as WebLLM from "${permittedOfflineInferencePackage}";`,
      "apps/web/src/webllm-model-manifest.ts": `export const engine = "${permittedOfflineInferencePackage}";`
    });

    expect(checkRetiredDeviceModelReferences({ rootDirectory: workspace })).toEqual([]);
    expect([...permittedWebLlmFiles]).toHaveLength(2);
  });

  it("rejects a WebLLM reference anywhere else in production web source", () => {
    const workspace = createWorkspace({
      "apps/web/package.json": JSON.stringify({
        dependencies: { [permittedOfflineInferencePackage]: "0.2.85" }
      }),
      "apps/web/src/chat-runtime.ts": `import "${permittedOfflineInferencePackage}";`
    });

    expect(checkRetiredDeviceModelReferences({ rootDirectory: workspace })).toEqual([
      {
        file: "apps/web/src/chat-runtime.ts",
        reference: `${permittedOfflineInferencePackage} outside explicit offline runtime`
      }
    ]);
  });

  it("still rejects globally retired browser inference packages", () => {
    const workspace = createWorkspace({
      "apps/web/package.json": JSON.stringify({
        dependencies: { "@huggingface/transformers": "1.0.0" }
      })
    });

    expect(checkRetiredDeviceModelReferences({ rootDirectory: workspace })).toContainEqual({
      file: "apps/web/package.json",
      reference: "@huggingface/transformers"
    });
  });
});
