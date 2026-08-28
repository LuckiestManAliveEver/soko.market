import { describe, expect, it, vi } from "vitest";

import {
  hasPendingLazyModuleRecovery,
  isLazyModuleLoadError,
  loadLazyModuleWithRecovery,
  retryLazyModuleLoad,
  type LazyModuleRecoveryEnvironment
} from "../apps/web/src/lazy-module-recovery";

function createEnvironment(): LazyModuleRecoveryEnvironment & { reload: ReturnType<typeof vi.fn> } {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    reload: vi.fn()
  };
}

describe("lazy module recovery", () => {
  it("recognizes the chunk-load failures emitted by supported browsers and bundlers", () => {
    expect(
      isLazyModuleLoadError(
        new TypeError("Failed to fetch dynamically imported module: /assets/a.js")
      )
    ).toBe(true);
    expect(isLazyModuleLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(
      isLazyModuleLoadError(
        Object.assign(new Error("Loading chunk 42 failed"), { name: "ChunkLoadError" })
      )
    ).toBe(true);
    expect(isLazyModuleLoadError(new Error("Agent profile data is invalid"))).toBe(false);
  });

  it("reloads once after a stale profile chunk and preserves the pending recovery marker", async () => {
    const environment = createEnvironment();
    const error = new TypeError("Failed to fetch dynamically imported module: /assets/profile.js");

    await expect(
      loadLazyModuleWithRecovery("agent-profile", async () => Promise.reject(error), environment)
    ).rejects.toBe(error);
    expect(environment.reload).toHaveBeenCalledTimes(1);
    expect(hasPendingLazyModuleRecovery("agent-profile", environment)).toBe(true);

    await expect(
      loadLazyModuleWithRecovery("agent-profile", async () => Promise.reject(error), environment)
    ).rejects.toBe(error);
    expect(environment.reload).toHaveBeenCalledTimes(1);
  });

  it("clears recovery state after a successful load and when the user retries", async () => {
    const environment = createEnvironment();
    const error = new TypeError("Failed to fetch dynamically imported module: /assets/profile.js");
    await loadLazyModuleWithRecovery(
      "agent-profile",
      async () => Promise.reject(error),
      environment
    ).catch(() => undefined);

    const loaded = await loadLazyModuleWithRecovery(
      "agent-profile",
      async () => ({ profile: true }),
      environment
    );
    expect(loaded).toEqual({ profile: true });
    expect(hasPendingLazyModuleRecovery("agent-profile", environment)).toBe(false);

    await loadLazyModuleWithRecovery(
      "agent-profile",
      async () => Promise.reject(error),
      environment
    ).catch(() => undefined);
    retryLazyModuleLoad("agent-profile", environment);
    expect(hasPendingLazyModuleRecovery("agent-profile", environment)).toBe(false);
    expect(environment.reload).toHaveBeenCalledTimes(3);
  });
});
