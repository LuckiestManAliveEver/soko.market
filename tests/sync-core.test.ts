import { describe, expect, it } from "vitest";
import {
  classifySyncConflict,
  createSyncQueueItem,
  markSyncProcessing,
  markSyncRejected,
  markSyncSynced,
  summarizeSyncQueue
} from "../packages/sync-core/src/index";

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
