import { describe, expect, it, vi } from "vitest";

import {
  applySessionContextPatchWithConflictRetry,
  SESSION_CONTEXT_PATCH_MAX_ATTEMPTS
} from "../apps/web/src/cross-device-session-context";
import { ApiRequestError } from "../apps/web/src/lib/api";

function sessionConflict(): ApiRequestError {
  return new ApiRequestError(
    409,
    "Session context changed on another client. Refresh before retrying.",
    {
      code: "session_context_conflict"
    }
  );
}

function contextAt(sessionVersion: number) {
  return {
    accountId: "account-1",
    userId: "user-1",
    sessionId: "session-1",
    conversationId: "conversation-1",
    activeShopId: null,
    agentId: "agent-1",
    activeModelId: "model-1",
    mode: "marketplace" as const,
    activeSurface: "conversation" as const,
    permissions: [],
    sessionVersion,
    shops: []
  };
}

describe("applySessionContextPatchWithConflictRetry", () => {
  it("applies the patch immediately when there is no version conflict", async () => {
    const patchContext = vi.fn().mockResolvedValue(contextAt(2));
    const fetchLatestContext = vi.fn();

    const result = await applySessionContextPatchWithConflictRetry({ mode: "seller" }, 1, {
      patchContext,
      fetchLatestContext
    });

    expect(result).toEqual(contextAt(2));
    expect(patchContext).toHaveBeenCalledTimes(1);
    expect(patchContext).toHaveBeenCalledWith({ mode: "seller", expectedSessionVersion: 1 });
    expect(fetchLatestContext).not.toHaveBeenCalled();
  });

  // Regression test for the "409 twice in a row" bug: production logs showed
  // /v1/session/context PATCH conflicting twice back to back after login, and the
  // old implementation only ever retried once, silently dropping the update on the
  // second conflict. Two concurrent writers (a second tab/device, or a stale
  // in-flight request from before login) is enough to trigger this.
  it("recovers from two consecutive version conflicts by refetching before each retry", async () => {
    const patchContext = vi
      .fn()
      .mockRejectedValueOnce(sessionConflict())
      .mockRejectedValueOnce(sessionConflict())
      .mockResolvedValueOnce(contextAt(4));
    const fetchLatestContext = vi
      .fn()
      .mockResolvedValueOnce(contextAt(2))
      .mockResolvedValueOnce(contextAt(3));
    const onDropped = vi.fn();

    const result = await applySessionContextPatchWithConflictRetry({ mode: "seller" }, 1, {
      patchContext,
      fetchLatestContext,
      onDropped
    });

    expect(result).toEqual(contextAt(4));
    expect(patchContext).toHaveBeenCalledTimes(3);
    expect(patchContext).toHaveBeenNthCalledWith(1, { mode: "seller", expectedSessionVersion: 1 });
    expect(patchContext).toHaveBeenNthCalledWith(2, { mode: "seller", expectedSessionVersion: 2 });
    expect(patchContext).toHaveBeenNthCalledWith(3, { mode: "seller", expectedSessionVersion: 3 });
    expect(onDropped).not.toHaveBeenCalled();
  });

  it("gives up and reports the drop after exhausting every attempt", async () => {
    const patchContext = vi.fn().mockRejectedValue(sessionConflict());
    const fetchLatestContext = vi
      .fn()
      .mockResolvedValueOnce(contextAt(2))
      .mockResolvedValueOnce(contextAt(3));
    const onDropped = vi.fn();

    const result = await applySessionContextPatchWithConflictRetry({ mode: "seller" }, 1, {
      patchContext,
      fetchLatestContext,
      onDropped
    });

    expect(result).toBeNull();
    expect(patchContext).toHaveBeenCalledTimes(SESSION_CONTEXT_PATCH_MAX_ATTEMPTS);
    expect(onDropped).toHaveBeenCalledTimes(1);
    expect(onDropped).toHaveBeenCalledWith(SESSION_CONTEXT_PATCH_MAX_ATTEMPTS);
  });

  it("does not retry non-conflict errors", async () => {
    const networkError = new Error("network down");
    const patchContext = vi.fn().mockRejectedValue(networkError);
    const fetchLatestContext = vi.fn();

    await expect(
      applySessionContextPatchWithConflictRetry({ mode: "seller" }, 1, {
        patchContext,
        fetchLatestContext
      })
    ).rejects.toBe(networkError);
    expect(patchContext).toHaveBeenCalledTimes(1);
    expect(fetchLatestContext).not.toHaveBeenCalled();
  });
});
