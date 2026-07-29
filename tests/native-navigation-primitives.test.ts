import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCapabilitySettings, shouldPrefetch } from "../apps/web/src/capability-profile";
import { createScreenStateCache } from "../apps/web/src/screen-state-cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native navigation primitives", () => {
  it("uses a smaller render and screen window on constrained devices", () => {
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 2,
      deviceMemory: 2,
      onLine: true,
      connection: { effectiveType: "4g", saveData: false }
    });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });

    expect(detectCapabilitySettings()).toMatchObject({
      profile: "constrained",
      messageWindowSize: 40,
      preservedScreenLimit: 2,
      maxConcurrentHeavyWorkers: 1
    });
  });

  it("does not prefetch while offline, on Save-Data, or on a 2G connection", () => {
    vi.stubGlobal("navigator", {
      onLine: false,
      connection: { effectiveType: "4g", saveData: false }
    });
    expect(shouldPrefetch()).toBe(false);

    vi.stubGlobal("navigator", {
      onLine: true,
      connection: { effectiveType: "4g", saveData: true }
    });
    expect(shouldPrefetch()).toBe(false);

    vi.stubGlobal("navigator", {
      onLine: true,
      connection: { effectiveType: "2g", saveData: false }
    });
    expect(shouldPrefetch()).toBe(false);
  });

  it("evicts the least recently used screen within its strict cap", () => {
    const cache = createScreenStateCache(2);
    cache.write("chat", { scrollX: 0, scrollY: 10 });
    cache.write("products", { scrollX: 0, scrollY: 20 });
    expect(cache.read("chat")?.scrollY).toBe(10);
    cache.write("reports", { scrollX: 0, scrollY: 30 });

    expect(cache.size()).toBe(2);
    expect(cache.read("products")).toBeNull();
    expect(cache.read("chat")?.scrollY).toBe(10);
  });
});
