import { describe, expect, it, vi } from "vitest";
import { startAgentOwnerCorrectionRetentionRunner } from "../services/api/src/cp2/agent-owner-correction-retention-runner";

describe("agent owner correction retention runner", () => {
  it("runs a sweep pass on demand and stops cleanly", async () => {
    const purgeExpiredAgentOwnerCorrections = vi.fn().mockReturnValue(3);
    const onResult = vi.fn();
    const runner = startAgentOwnerCorrectionRetentionRunner({
      store: { purgeExpiredAgentOwnerCorrections },
      intervalMs: 60_000,
      runOnStart: false,
      onResult
    });

    await expect(runner.runNow()).resolves.toBe(3);
    expect(purgeExpiredAgentOwnerCorrections).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(3);

    await runner.stop();
    await expect(runner.runNow()).resolves.toBeNull();
  });

  it("contains a failed sweep so later runs can retry", async () => {
    const error = new Error("store unavailable");
    const purgeExpiredAgentOwnerCorrections = vi.fn().mockImplementation(() => {
      throw error;
    });
    const onError = vi.fn();
    const runner = startAgentOwnerCorrectionRetentionRunner({
      store: { purgeExpiredAgentOwnerCorrections },
      intervalMs: 60_000,
      runOnStart: false,
      onError
    });

    await expect(runner.runNow()).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(error);
    await runner.stop();
  });

  it("coalesces overlapping runs instead of sweeping concurrently", async () => {
    let resolveFirst: (() => void) | null = null;
    const purgeExpiredAgentOwnerCorrections = vi.fn().mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveFirst = () => resolve(1);
        })
    );
    const runner = startAgentOwnerCorrectionRetentionRunner({
      store: { purgeExpiredAgentOwnerCorrections },
      intervalMs: 60_000,
      runOnStart: false
    });

    const first = runner.runNow();
    const second = runner.runNow();
    expect(purgeExpiredAgentOwnerCorrections).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(1);

    await runner.stop();
  });
});
