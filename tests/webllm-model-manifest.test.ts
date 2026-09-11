import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { WEBLLM_PINNED_MODEL } from "../apps/web/src/webllm-model-manifest";

/**
 * This file never mocks @mlc-ai/web-llm - it exists specifically to catch drift between the
 * checked-in public manifest, the pin declared in apps/web/src/webllm-model-manifest.ts, the
 * pinned dependency version, and the real installed package's own model catalogue. Every other
 * webllm-runtime test mocks the package, so none of them would notice an upstream rename or a
 * version bump that drops this modelId.
 */
describe("webllm-model-manifest drift guard", () => {
  it("keeps the checked-in public manifest in sync with the TS pin", () => {
    const publicManifestPath = resolve(
      process.cwd(),
      "apps/web/public/webllm-runtime/manifest.json"
    );
    const publicManifest = JSON.parse(readFileSync(publicManifestPath, "utf8")) as {
      engine: string;
      engineVersion: string;
      agentId: string;
      agentVersion: string;
      modelId: string;
      modelVersion: string;
      modelOrigin: string;
    };
    expect(publicManifest.engine).toBe(WEBLLM_PINNED_MODEL.engine);
    expect(publicManifest.engineVersion).toBe(WEBLLM_PINNED_MODEL.engineVersion);
    expect(publicManifest.agentId).toBe(WEBLLM_PINNED_MODEL.agentId);
    expect(publicManifest.agentVersion).toBe(WEBLLM_PINNED_MODEL.agentVersion);
    expect(publicManifest.modelId).toBe(WEBLLM_PINNED_MODEL.modelId);
    expect(publicManifest.modelVersion).toBe(WEBLLM_PINNED_MODEL.modelVersion);
    expect(publicManifest.modelOrigin).toBe(WEBLLM_PINNED_MODEL.modelOrigin);
  });

  it("pins a dependency version that matches the declared engineVersion, in both apps/web and root", () => {
    const webPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "apps/web/package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    const rootPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      devDependencies: Record<string, string>;
    };
    expect(webPackage.dependencies["@mlc-ai/web-llm"]).toBe(WEBLLM_PINNED_MODEL.engineVersion);
    expect(rootPackage.devDependencies["@mlc-ai/web-llm"]).toBe(WEBLLM_PINNED_MODEL.engineVersion);
  });

  it("finds the pinned modelId in the real installed @mlc-ai/web-llm model list, from the approved origin", () => {
    const record = prebuiltAppConfig.model_list.find(
      (candidate) => candidate.model_id === WEBLLM_PINNED_MODEL.modelId
    );
    expect(
      record,
      "pinned modelId must exist in the real installed @mlc-ai/web-llm model list"
    ).toBeDefined();
    expect(record!.model.startsWith(WEBLLM_PINNED_MODEL.modelOrigin)).toBe(true);
  });
});
