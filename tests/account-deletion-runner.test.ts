import { afterEach, describe, expect, it, vi } from "vitest";
import { startAccountDeletionRunner } from "../services/api/src/cp2/account-deletion-runner";
import type { AccountDeletionPurgeRunSummary } from "../services/api/src/cp2/store";

const completedSummary: AccountDeletionPurgeRunSummary = {
  checked: 1,
  completed: 1,
  partiallyFailed: 0,
  skipped: 0
};

describe("account deletion runner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs at startup, prevents overlaps, and stops its timer", async () => {
    vi.useFakeTimers();
    let resolveFirstRun: ((result: AccountDeletionPurgeRunSummary) => void) | undefined;
    const firstRun = new Promise<AccountDeletionPurgeRunSummary>((resolve) => {
      resolveFirstRun = resolve;
    });
    const purgeExpiredAccountDeletions = vi
      .fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(completedSummary);
    const runner = startAccountDeletionRunner({
      store: { purgeExpiredAccountDeletions },
      intervalMs: 1_000
    });

    expect(purgeExpiredAccountDeletions).toHaveBeenCalledTimes(1);
    const overlappingRun = runner.runNow();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(purgeExpiredAccountDeletions).toHaveBeenCalledTimes(1);

    resolveFirstRun?.(completedSummary);
    await expect(overlappingRun).resolves.toEqual(completedSummary);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(purgeExpiredAccountDeletions).toHaveBeenCalledTimes(2);

    await runner.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(purgeExpiredAccountDeletions).toHaveBeenCalledTimes(2);
    await expect(runner.runNow()).resolves.toBeNull();
  });

  it("rejects invalid interval configuration", () => {
    expect(() =>
      startAccountDeletionRunner({
        store: {
          purgeExpiredAccountDeletions: vi.fn().mockResolvedValue(completedSummary)
        },
        intervalMs: 0
      })
    ).toThrow("positive integer");
  });
});
