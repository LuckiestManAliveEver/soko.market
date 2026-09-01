import { describe, expect, it } from "vitest";

/**
 * loadLlamaRuntime's entire purpose is running node-llama-cpp's native binding on Vercel.
 * TypeScript compiling is not proof that binding actually loaded for the current platform/Node
 * major - pnpm 10 silently skips native install scripts unless explicitly allowed
 * (pnpm-workspace.yaml's onlyBuiltDependencies), and a skipped postinstall only fails at runtime,
 * never at build time. This calls the real native binding (no GGUF file, no model load - just the
 * llama.cpp backend init/dispose lifecycle loadLlamaRuntime itself performs) so a broken or
 * un-built native binary fails the regular test suite instead of surfacing only on Vercel. A full
 * model-load-and-generate proof against a real GGUF file lives in
 * scripts/ai-runtime-live-inference-probe.mjs (pnpm inference:live-probe), which is opt-in because
 * it requires downloading/pointing at an actual multi-hundred-megabyte model artifact.
 */
describe("node-llama-cpp native binding", () => {
  it("loads and disposes the real native runtime", async () => {
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama({ gpu: false });
    try {
      expect(llama.gpu).toBe(false);
    } finally {
      await llama.dispose();
    }
  });
});
