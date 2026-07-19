import { describe, expect, it } from "vitest";
import {
  readBrowserInferenceDiagnostics,
  recordBrowserInferenceDiagnostic
} from "../apps/web/src/browser-inference-diagnostics";

describe("browser inference diagnostics", () => {
  it("keeps only bounded, privacy-safe performance fields", () => {
    for (let index = 0; index < 105; index += 1) {
      recordBrowserInferenceDiagnostic({
        type: "generation",
        backend: "wasm",
        modelId: "smollm2-360m-instruct-browser",
        promptTokenCount: 100,
        generatedTokenCount: index,
        durationMs: 1_000,
        timeToFirstTokenMs: 100,
        tokensPerSecond: 10
      });
    }

    const diagnostics = readBrowserInferenceDiagnostics();
    expect(diagnostics).toHaveLength(100);
    expect(diagnostics.at(-1)).toMatchObject({ type: "generation", generatedTokenCount: 104 });
    expect(JSON.stringify(diagnostics)).not.toContain("promptText");
    expect(JSON.stringify(diagnostics)).not.toContain("generatedText");
  });
});
