import { describe, expect, it, vi } from "vitest";
import type { LocalAiModel } from "../apps/web/src/ai-model-manager";
import {
  createAgentModelRuntime,
  fallbackAllowed,
  testAgentModelRuntime
} from "../apps/web/src/agent-model-runtime";

function installedModel(id: string): LocalAiModel {
  return {
    id,
    modelId: `model:${id}`,
    label: "Test GGUF",
    displayName: "Test GGUF",
    provider: "custom",
    repositoryId: null,
    fileName: "test-q4_k_m.gguf",
    storageKey: "test-q4_k_m.gguf",
    format: "GGUF",
    quantization: "Q4_K_M",
    architecture: "llama",
    parameterCount: 500_000_000,
    contextLength: 2_048,
    fileSizeBytes: 400_000_000,
    checksum: null,
    license: "Apache-2.0",
    commercialUseAllowed: true,
    runtimeBackend: "LLAMA_CPP_ANDROID",
    installationStatus: "INSTALLED",
    compatibilityStatus: "COMPATIBLE",
    deviceId: "device-test",
    storedAt: "2026-07-19T00:00:00.000Z",
    installedAt: "2026-07-19T00:00:00.000Z",
    lastVerifiedAt: "2026-07-19T00:00:00.000Z",
    validationError: null
  };
}

function bridge(output = "SOKO_MODEL_READY") {
  return {
    inspect: vi.fn(async () => ({
      compatible: true,
      backend: "LLAMA_CPP_ANDROID" as const
    })),
    load: vi.fn(async () => undefined),
    generate: vi.fn(async () => ({
      text: output,
      inputTokenCount: 6,
      outputTokenCount: 3
    })),
    unload: vi.fn(async () => undefined),
    health: vi.fn(async () => ({
      status: "READY" as const,
      backend: "LLAMA_CPP_ANDROID" as const
    }))
  };
}

describe("agent model runtime", () => {
  it("marks a model ready only after the deterministic prompt returns the expected output", async () => {
    const native = bridge("  `SOKO_MODEL_READY`. ");
    const result = await testAgentModelRuntime(
      createAgentModelRuntime(native),
      installedModel("ready-model")
    );

    expect(result).toMatchObject({
      success: true,
      modelId: "model:ready-model",
      backend: "LLAMA_CPP_ANDROID",
      errorCode: null,
      inputTokenCount: 6,
      outputTokenCount: 3
    });
    expect(native.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Reply with exactly: SOKO_MODEL_READY", temperature: 0 })
    );
  });

  it("fails readiness when real inference returns a different response", async () => {
    const result = await testAgentModelRuntime(
      createAgentModelRuntime(bridge("almost ready")),
      installedModel("mismatch-model")
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: "MODEL_READINESS_MISMATCH"
    });
  });

  it("single-flights duplicate model loads", async () => {
    let release: (() => void) | undefined;
    const native = bridge();
    native.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const runtime = createAgentModelRuntime(native);
    const model = installedModel("single-flight-model");
    const first = runtime.load(model);
    const second = runtime.load(model);
    release?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(native.load).toHaveBeenCalledOnce();
  });

  it("emits explicit load lifecycle events and waits for runtime readiness", async () => {
    const native = bridge();
    const events: string[] = [];
    const result = await testAgentModelRuntime(
      createAgentModelRuntime(native),
      installedModel("event-model"),
      { onEvent: (event) => events.push(event.type) }
    );

    expect(result.success).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining(["MODEL_LOAD_STARTED", "MODEL_LOAD_PROGRESS", "MODEL_READY"])
    );
    expect(native.health).toHaveBeenCalledWith({ installationId: "event-model" });
  });

  it("emits MODEL_LOAD_FAILED and rejects readiness after bridge load failure", async () => {
    const native = bridge();
    native.load.mockRejectedValue(new Error("load failed"));
    const events: string[] = [];
    const result = await testAgentModelRuntime(
      createAgentModelRuntime(native),
      installedModel("failed-event-model"),
      { onEvent: (event) => events.push(event.type) }
    );

    expect(result).toMatchObject({ success: false, errorCode: "MODEL_LOAD_FAILED" });
    expect(events).toContain("MODEL_LOAD_FAILED");
  });

  it("applies explicit fallback policies", () => {
    expect(fallbackAllowed("NEVER", "RUNTIME_UNAVAILABLE")).toBe(false);
    expect(fallbackAllowed("WHEN_LOCAL_UNAVAILABLE", "RUNTIME_UNAVAILABLE")).toBe(true);
    expect(fallbackAllowed("WHEN_LOCAL_UNAVAILABLE", "MODEL_LOAD_FAILED")).toBe(false);
    expect(fallbackAllowed("WHEN_LOCAL_FAILS", "MODEL_LOAD_FAILED")).toBe(true);
    expect(fallbackAllowed("WHEN_CONTEXT_EXCEEDED", "CONTEXT_LIMIT_EXCEEDED")).toBe(true);
  });
});
