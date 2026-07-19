import { describe, expect, it, vi } from "vitest";
import { isExpiredRuntimeSessionError, RuntimeManager } from "../apps/web/src/runtime-manager";

describe("application runtime manager", () => {
  it("deduplicates concurrent initialization and reuses the session", async () => {
    const manager = new RuntimeManager();
    const create = vi.fn(async () => "runtime-1");

    const [first, second] = await Promise.all([
      manager.ensureSession("account:business", create),
      manager.ensureSession("account:business", create)
    ]);
    const third = await manager.ensureSession("account:business", create);

    expect([first, second, third]).toEqual(["runtime-1", "runtime-1", "runtime-1"]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toBe("ready");
  });

  it("recreates one expired session and retries the affected action once", async () => {
    const manager = new RuntimeManager();
    const create = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("runtime-expired")
      .mockResolvedValueOnce("runtime-fresh");
    const action = vi.fn(async (runtimeSessionId: string) => {
      if (runtimeSessionId === "runtime-expired") {
        throw Object.assign(new Error("Runtime session not found."), { status: 404 });
      }
      return "activated";
    });

    await expect(manager.runWithSession("account:business", create, action)).resolves.toBe(
      "activated"
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("does not classify unrelated request failures as expired sessions", () => {
    expect(isExpiredRuntimeSessionError(Object.assign(new Error("Offline"), { status: 503 }))).toBe(
      false
    );
  });
});
