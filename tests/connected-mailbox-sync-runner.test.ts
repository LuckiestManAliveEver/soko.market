import { describe, expect, it, vi } from "vitest";
import { startConnectedMailboxSyncRunner } from "../services/api/src/cp2/connected-mailbox-sync-runner";

describe("connected mailbox sync runner", () => {
  it("runs controlled sync without overlapping executions and stops cleanly", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncDueConnectedMailboxes = vi.fn(async () => {
      await pending;
      return {
        checked: 1,
        synchronized: 1,
        ingested: 1,
        deduplicated: 0,
        filtered: 0,
        failed: 0
      };
    });
    const runner = startConnectedMailboxSyncRunner({
      store: { syncDueConnectedMailboxes },
      intervalMs: 60_000,
      runOnStart: false
    });
    const first = runner.runNow();
    const overlapping = runner.runNow();
    expect(syncDueConnectedMailboxes).toHaveBeenCalledTimes(1);
    expect(first).toBe(overlapping);
    release?.();
    await expect(first).resolves.toMatchObject({ synchronized: 1, ingested: 1 });
    await runner.stop();
    await expect(runner.runNow()).resolves.toBeNull();
  });
});
