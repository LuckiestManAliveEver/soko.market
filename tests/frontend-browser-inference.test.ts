import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser inference frontend integration", () => {
  it("keeps the feature disabled by default and requires an explicit model action", async () => {
    const env = await readFile(".env.example", "utf8");
    const application = await readFile("apps/web/src/SokoApplication.tsx", "utf8");
    const registry = await readFile("apps/web/src/browser-model-registry.ts", "utf8");
    expect(env).toContain("VITE_BROWSER_LOCAL_INFERENCE_ENABLED=false");
    expect(application).toContain("Use the browser model on this device");
    expect(application).toContain("Cancel download");
    expect(application).toContain("Downloading ${model.displayName} after your consent");
    expect(registry).toContain('import.meta.env.VITE_BROWSER_LOCAL_INFERENCE_ENABLED === "true"');
  });

  it("streams into the existing chat, supports cancellation, and retains server routing", async () => {
    const application = await readFile("apps/web/src/SokoApplication.tsx", "utf8");
    expect(application).toContain("generateBrowserAgentResponse");
    expect(application).toContain("setChatMessages((messages) =>");
    expect(application).toContain("Cancel on-device generation");
    expect(application).toContain("Using Cloud");
    expect(application).toContain("requestRequiresServerTool(runtimeMessage)");
    expect(application).toContain("queueMessagingOutbox");
    expect(application).toContain("postJson<RuntimeTurnResult>");
  });

  it("runs inference in a page worker and leaves inference data outside service-worker cleanup", async () => {
    const engine = await readFile("apps/web/src/browser-model-engine.ts", "utf8");
    const worker = await readFile("apps/web/src/workers/browser-model.worker.ts", "utf8");
    const serviceWorker = await readFile("apps/web/public/sw.js", "utf8");
    expect(engine).toContain('new Worker(new URL("./workers/browser-model.worker.ts"');
    expect(worker).toContain("TextStreamer");
    expect(worker).toContain("InterruptableStoppingCriteria");
    expect(serviceWorker).not.toContain("soko-browser-inference");
    expect(serviceWorker).not.toContain("transformers-cache");
  });
});
