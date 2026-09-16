// @vitest-environment jsdom

/**
 * Behavioral coverage for apps/web/src/service-worker.ts: the code that runs in the *page*, not
 * inside the worker. This is what decides whether an already-open tab discovers a new deployment
 * (registration.update() on every load) and whether picking up a new worker ever reloads more than
 * once (the controllerchange guard) - the two things that turn "a new sw.js exists" into "an
 * existing installed PWA actually loads it" without a reload loop.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let offlineModeActive = false;
vi.mock("../apps/web/src/offline-runtime", () => ({
  isExplicitOfflineMode: () => offlineModeActive
}));

class MockServiceWorkerContainer extends EventTarget {
  controller: unknown = null;
  register = vi.fn();
  getRegistrations = vi.fn().mockResolvedValue([]);
}

let container: MockServiceWorkerContainer;
let reload: ReturnType<typeof vi.fn>;

beforeAll(() => {
  // Vitest defaults test mode to DEV=true, and the module under test branches on
  // import.meta.env.DEV at call time; force the production path here the same way an actual
  // production build would evaluate it. (A direct `import.meta.env.DEV = false` mutation in this
  // file does not propagate - vite-node gives each module its own env object - so this must go
  // through vi.stubEnv, which patches the shared source every module reads from.)
  vi.stubEnv("DEV", false);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  offlineModeActive = false;
  container = new MockServiceWorkerContainer();
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: container,
    configurable: true
  });
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    writable: true,
    configurable: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function register() {
  const { registerAppServiceWorker } = await import("../apps/web/src/service-worker");
  registerAppServiceWorker();
  // Let the register().then(...) microtask chain settle.
  await Promise.resolve();
  await Promise.resolve();
}

describe("service-worker registration: discovering a new deployment", () => {
  it("registers with updateViaCache: none so sw.js itself is never HTTP-cached stale", async () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    container.register.mockResolvedValue(registration);

    await register();

    expect(container.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none"
    });
  });

  it("checks for a newer worker on every app load", async () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    container.register.mockResolvedValue(registration);

    await register();

    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("skips the update check while a deliberate offline session is active", async () => {
    offlineModeActive = true;
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    container.register.mockResolvedValue(registration);

    await register();

    expect(registration.update).not.toHaveBeenCalled();
  });
});

describe("service-worker registration: the update-adoption reload never loops", () => {
  it("reloads exactly once when a new worker takes control of an already-controlled tab", async () => {
    container.controller = { state: "activated" }; // tab was already controlled at startup
    container.register.mockResolvedValue({ update: vi.fn().mockResolvedValue(undefined) });
    await register();

    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload on the very first install (tab had no controller at startup)", async () => {
    container.controller = null; // first-ever visit / first install, nothing to "adopt"
    container.register.mockResolvedValue({ update: vi.fn().mockResolvedValue(undefined) });
    await register();

    container.dispatchEvent(new Event("controllerchange"));

    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads while a deliberate offline session is active, even repeatedly", async () => {
    offlineModeActive = true;
    container.controller = { state: "activated" };
    container.register.mockResolvedValue({ update: vi.fn().mockResolvedValue(undefined) });
    await register();

    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("service-worker registration: development mode never touches production registration", () => {
  it("unregisters instead of registering when running in dev", async () => {
    vi.stubEnv("DEV", true);
    try {
      const registration = { update: vi.fn().mockResolvedValue(undefined) };
      container.register.mockResolvedValue(registration);

      await register();

      expect(container.register).not.toHaveBeenCalled();
      expect(container.getRegistrations).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubEnv("DEV", false);
    }
  });
});
