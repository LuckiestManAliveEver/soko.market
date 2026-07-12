import { describe, expect, it } from "vitest";
import {
  applySyncPullPage,
  classifySyncConflict,
  createSyncQueueItem,
  markSyncProcessing,
  markSyncRejected,
  markSyncSynced,
  summarizeSyncQueue
} from "../packages/sync-core/src/index";
import type { LocalSyncSnapshot, SyncPullPage } from "../packages/shared-types/src/index";

describe("sync-core CP7 queue rules", () => {
  it("transitions queued mutations deterministically and summarizes by business", () => {
    const item = createSyncQueueItem({
      id: "queue-1",
      idempotencyKey: "offline-product-1",
      businessId: "business-1",
      actorId: "user-1",
      mutationType: "product.create",
      payload: {
        name: "Maize",
        quantity: 2
      },
      clientCreatedAt: "2026-07-03T00:00:00.000Z",
      now: "2026-07-03T00:00:01.000Z"
    });

    expect(item.status).toBe("pending");
    expect(item.attempts).toBe(0);

    const processing = markSyncProcessing(item, "2026-07-03T00:00:02.000Z");
    expect(processing.status).toBe("processing");
    expect(processing.attempts).toBe(1);

    const synced = markSyncSynced(processing, { id: "product-1" }, "2026-07-03T00:00:03.000Z");
    expect(synced.status).toBe("synced");
    expect(synced.result).toEqual({ id: "product-1" });

    expect(summarizeSyncQueue("business-1", [synced])).toMatchObject({
      total: 1,
      synced: 1,
      pending: 0
    });
  });

  it("classifies validation and stock rejections as conflicts", () => {
    const processing = markSyncProcessing(
      createSyncQueueItem({
        id: "queue-2",
        idempotencyKey: "offline-invoice-1",
        businessId: "business-1",
        actorId: "user-1",
        mutationType: "invoice.confirm",
        payload: {
          invoiceId: "invoice-1"
        },
        clientCreatedAt: "2026-07-03T00:00:00.000Z",
        now: "2026-07-03T00:00:01.000Z"
      }),
      "2026-07-03T00:00:02.000Z"
    );

    const rejected = markSyncRejected(processing, {
      code: "stock_insufficient",
      message: "Not enough stock.",
      statusCode: 409,
      now: "2026-07-03T00:00:03.000Z"
    });

    expect(rejected.status).toBe("conflict");
    expect(rejected.conflict).toMatchObject({
      code: "stock_insufficient",
      retryable: false
    });
    expect(
      classifySyncConflict({ code: "server_busy", message: "Try again.", statusCode: 503 })
        .retryable
    ).toBe(true);
  });
});

describe("sync-core CP21 catch-up rules", () => {
  const emptySnapshot: LocalSyncSnapshot<{ title: string }> = {
    accountId: "account-1",
    cursor: null,
    records: []
  };

  const firstPage: SyncPullPage<{ title: string }> = {
    accountId: "account-1",
    fromCursor: null,
    nextCursor: "cursor-2",
    hasMore: false,
    serverTime: "2026-07-12T12:00:00.000Z",
    changes: [
      {
        accountId: "account-1",
        collection: "conversations",
        entityId: "conversation-1",
        operation: "upsert",
        sequence: 1,
        cursor: "cursor-1",
        shopId: null,
        entity: { title: "Orders" },
        changedAt: "2026-07-12T11:59:00.000Z",
        tombstoneExpiresAt: null
      },
      {
        accountId: "account-1",
        collection: "conversation_messages",
        entityId: "message-1",
        operation: "delete",
        sequence: 2,
        cursor: "cursor-2",
        shopId: null,
        entity: null,
        changedAt: "2026-07-12T11:59:30.000Z",
        tombstoneExpiresAt: "2026-10-10T11:59:30.000Z"
      }
    ]
  };

  it("commits ordered upserts and tombstones before advancing the cursor", () => {
    const snapshot = applySyncPullPage(emptySnapshot, firstPage);

    expect(snapshot.cursor).toBe("cursor-2");
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records[0]).toMatchObject({
      collection: "conversation_messages",
      entity: null,
      deletedAt: "2026-07-12T11:59:30.000Z"
    });
    expect(snapshot.records[1]).toMatchObject({
      collection: "conversations",
      entity: { title: "Orders" },
      deletedAt: null
    });
  });

  it("is idempotent when a committed page is delivered again", () => {
    const committed = applySyncPullPage(emptySnapshot, firstPage);
    expect(applySyncPullPage(committed, firstPage)).toBe(committed);
  });

  it("rejects cursor gaps, cross-account changes, and malformed deletes", () => {
    expect(() =>
      applySyncPullPage({ ...emptySnapshot, cursor: "unexpected" }, firstPage)
    ).toThrowError(/does not continue/);

    expect(() =>
      applySyncPullPage(emptySnapshot, {
        ...firstPage,
        changes: [{ ...firstPage.changes[0]!, accountId: "account-2" }]
      })
    ).toThrowError(/another account/);

    expect(() =>
      applySyncPullPage(emptySnapshot, {
        ...firstPage,
        nextCursor: "cursor-1",
        changes: [
          {
            ...firstPage.changes[0]!,
            operation: "delete",
            entity: { title: "must be null" }
          }
        ]
      })
    ).toThrowError(/deletes require a null entity/);
  });
});
