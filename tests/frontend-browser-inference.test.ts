import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser inference frontend integration", () => {
  it("keeps the feature disabled by default and requires an explicit model action", async () => {
    const env = await readFile(".env.example", "utf8");
    const agentProfileSurface = await readFile("apps/web/src/AgentProfileSurface.tsx", "utf8");
    const registry = await readFile("apps/web/src/browser-model-registry.ts", "utf8");
    expect(env).toContain("VITE_BROWSER_LOCAL_INFERENCE_ENABLED=false");
    expect(agentProfileSurface).toContain("Use the browser model on this device");
    expect(agentProfileSurface).toContain("Cancel download");
    expect(agentProfileSurface).toContain("Downloading ${model.displayName} after your consent");
    expect(agentProfileSurface).toContain("Browser model");
    expect(agentProfileSurface).toContain("selectedBrowserModelId");
    expect(registry).toContain('import.meta.env.VITE_BROWSER_LOCAL_INFERENCE_ENABLED === "true"');
    expect(registry).toContain("smollm2-135m-instruct-browser");
    expect(registry).toContain("qwen2.5-0.5b-instruct-browser");
    expect(registry).toContain("approximateDownloadBytes: 400_000_000");
  });

  it("streams into the existing chat, supports cancellation, and retains server routing", async () => {
    const application = await readFile("apps/web/src/SokoApplication.tsx", "utf8");
    const chatSurface = await readFile("apps/web/src/ChatSurface.tsx", "utf8");
    const agentProfileSurface = await readFile("apps/web/src/AgentProfileSurface.tsx", "utf8");
    expect(application).toContain("generateBrowserAgentResponse");
    expect(application).toContain("setChatMessages((messages) =>");
    expect(chatSurface).toContain("Cancel on-device generation");
    expect(application).toContain("executeInferenceRoute");
    expect(application).toContain("decideClientInferenceRoute");
    expect(application).toContain("createRemoteInferenceProvider");
    expect(agentProfileSurface).toContain("Client-first route permissions");
    expect(application).toContain("requestRequiresServerTool(runtimeMessage)");
    expect(application).toContain("queueMessagingOutbox");
    expect(application).toContain("postJson<RuntimeTurnResult>");
    const session = await readFile("apps/web/src/browser-inference-session.ts", "utf8");
    expect(session).toContain("browserInferenceMaxNewTokens");
    expect(session).toContain('__DEPLOYMENT_ENV__ !== "staging"');
  });

  it("runs inference in a page worker and leaves inference data outside service-worker cleanup", async () => {
    const engine = await readFile("apps/web/src/browser-model-engine.ts", "utf8");
    const worker = await readFile("apps/web/src/workers/browser-model.worker.ts", "utf8");
    const serviceWorker = await readFile("apps/web/public/sw.js", "utf8");
    expect(engine).toContain('new Worker(new URL("./workers/browser-model.worker.ts"');
    expect(worker).toContain("TextStreamer");
    expect(worker).toContain("InterruptableStoppingCriteria");
    expect(worker).toContain("Browser model staging diagnostic:");
    expect(worker).toContain("ort-wasm-simd-threaded.jsep.wasm");
    expect(worker).toContain("env.backends.onnx.wasm.wasmPaths");
    expect(worker).toContain("revision: model.modelRevision");
    expect(worker).toContain("TASK_BUDGET_EXCEEDED");
    expect(worker).not.toContain("cdn.jsdelivr.net");
    expect(serviceWorker).not.toContain("soko-browser-inference");
    expect(serviceWorker).not.toContain("transformers-cache");
  });

  it("synchronizes activation and health metadata without sending prompts or generated text", async () => {
    const application = await readFile("apps/web/src/SokoApplication.tsx", "utf8");
    const agentProfileSurface = await readFile("apps/web/src/AgentProfileSurface.tsx", "utf8");
    const synchronization = await readFile("apps/web/src/browser-inference-sync.ts", "utf8");
    expect(agentProfileSurface).toContain("synchronizeBrowserInferenceAssignment");
    expect(application).toContain("recordSyncedBrowserInferenceExecution");
    expect(agentProfileSurface).toContain("Database workflow:");
    expect(synchronization).toContain("/browser-inference/executions");
    expect(synchronization).toContain("runtimeContract");
    expect(synchronization).toContain("checkpointCompatibilityContract");
    expect(synchronization).not.toContain("systemPrompt");
    expect(synchronization).not.toContain("messages:");
    expect(synchronization).not.toContain("generatedText");
  });
});
