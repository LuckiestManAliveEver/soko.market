// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  getSharedAgentModelRuntime,
  resetSharedAgentModelRuntimeForTests,
  withRuntimeDeadline
} from "../apps/web/src/browser-gguf-runtime";

describe("browser GGUF runtime deadlines and registry", () => {
  it("rejects a worker operation that never settles", async () => {
    vi.useFakeTimers();
    const result = withRuntimeDeadline(new Promise<never>(() => undefined), 1_000);
    const rejected = expect(result).rejects.toMatchObject({ code: "INFERENCE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("propagates cancellation while a worker operation is pending", async () => {
    const controller = new AbortController();
    const result = withRuntimeDeadline(
      new Promise<never>(() => undefined),
      10_000,
      controller.signal
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "INFERENCE_TIMEOUT" });
  });

  it("shares one runtime registry between activation and chat", async () => {
    await resetSharedAgentModelRuntimeForTests();
    expect(getSharedAgentModelRuntime()).toBe(getSharedAgentModelRuntime());
  });
});
