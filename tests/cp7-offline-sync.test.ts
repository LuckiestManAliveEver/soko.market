import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface VerifyOtpResponse {
  session: {
    id: string;
  };
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

interface ProductResponse {
  id: string;
  quantity: number;
}

interface InvoiceResponse {
  id: string;
  status: "draft" | "confirmed";
}

interface OfflineCacheResponse {
  businessId: string;
  source: "server_cache";
  products: ProductResponse[];
  customers: Array<{ id: string }>;
  suppliers: Array<{ id: string }>;
  invoices: InvoiceResponse[];
  inventoryMovements: Array<{ type: string; productId: string }>;
}

interface SyncQueueItemResponse {
  id: string;
  idempotencyKey: string;
  businessId: string;
  mutationType: string;
  status: "pending" | "processing" | "synced" | "failed" | "conflict";
  attempts: number;
  result: unknown | null;
  conflict: {
    code: string;
    message: string;
  } | null;
}

interface SyncQueueResponse {
  summary: {
    pending: number;
    synced: number;
    failed: number;
    conflict: number;
    total: number;
  };
  items: SyncQueueItemResponse[];
}

interface SyncReplayResponse {
  summary: SyncQueueResponse["summary"];
  results: Array<{
    replayed: boolean;
    item: SyncQueueItemResponse;
  }>;
}

interface SyncReplayItemResponse {
  replayed: boolean;
  item: SyncQueueItemResponse;
}

describe("CP7 offline local data and sync queue", () => {
  it("serves offline cache and replays queued mutations idempotently in order", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const secondBusiness = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: "Second Shop",
        language: "en"
      },
      sessionCookie
    );
    const existingProduct = await postJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products`,
      {
        name: "Rice",
        quantity: 1
      },
      sessionCookie
    );

    const cache = await getJson<OfflineCacheResponse>(
      app,
      `/businesses/${businessId}/offline-cache`,
      sessionCookie
    );

    expect(cache).toMatchObject({
      businessId,
      source: "server_cache"
    });
    expect(cache.products.map((product) => product.id)).toContain(existingProduct.id);

    const productQueueItem = await postJson<SyncQueueItemResponse>(
      app,
      `/businesses/${businessId}/sync-queue`,
      {
        idempotencyKey: "cp7-product-create-1",
        mutationType: "product.create",
        clientCreatedAt: "2026-07-03T00:00:00.000Z",
        payload: {
          name: "Offline Beans",
          quantity: 3
        }
      },
      sessionCookie
    );
    const duplicateProductQueueItem = await postJson<SyncQueueItemResponse>(
      app,
      `/businesses/${businessId}/sync-queue`,
      {
        idempotencyKey: "cp7-product-create-1",
        mutationType: "product.create",
        payload: {
          name: "Should Not Replace",
          quantity: 99
        }
      },
      sessionCookie
    );
    const customerQueueItem = await postJson<SyncQueueItemResponse>(
      app,
      `/businesses/${businessId}/sync-queue`,
      {
        idempotencyKey: "cp7-customer-create-1",
        mutationType: "customer.create",
        clientCreatedAt: "2026-07-03T00:00:01.000Z",
        payload: {
          name: "Offline Customer"
        }
      },
      sessionCookie
    );

    expect(duplicateProductQueueItem.id).toBe(productQueueItem.id);
    expect(customerQueueItem.status).toBe("pending");

    const secondBusinessQueue = await getJson<SyncQueueResponse>(
      app,
      `/businesses/${secondBusiness.business.id}/sync-queue`,
      sessionCookie
    );
    expect(secondBusinessQueue.items).toHaveLength(0);

    const crossBusinessReplay = await app.inject({
      method: "POST",
      url: `/businesses/${secondBusiness.business.id}/sync-queue/${productQueueItem.id}/replay`,
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({})
    });
    expect(crossBusinessReplay.statusCode).toBe(404);
    expect(crossBusinessReplay.json()).toMatchObject({
      code: "sync_item_not_found"
    });

    const replay = await postJson<SyncReplayResponse>(
      app,
      `/businesses/${businessId}/sync-queue/replay`,
      {},
      sessionCookie
    );

    expect(replay.results.map((result) => result.item.mutationType)).toEqual([
      "product.create",
      "customer.create"
    ]);
    expect(replay.summary).toMatchObject({
      pending: 0,
      synced: 2,
      conflict: 0
    });

    const replayAgain = await postJson<SyncReplayItemResponse>(
      app,
      `/businesses/${businessId}/sync-queue/${productQueueItem.id}/replay`,
      {},
      sessionCookie
    );
    expect(replayAgain.replayed).toBe(false);

    const snapshot = store.snapshot();
    expect(snapshot.products.filter((product) => product.businessId === businessId)).toHaveLength(
      2
    );
    expect(snapshot.products.map((product) => product.name)).not.toContain("Should Not Replace");
    expect(
      snapshot.customers.filter((customer) => customer.businessId === businessId)
    ).toHaveLength(1);

    await app.close();
  });

  it("surfaces CP6 invoice confirmation conflicts without mutating stock", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);
    const product = await postJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products`,
      {
        name: "Maize Flour",
        quantity: 1
      },
      sessionCookie
    );
    const draft = await postJson<InvoiceResponse>(
      app,
      `/businesses/${businessId}/invoices`,
      {
        items: [
          {
            productId: product.id,
            quantity: 2,
            unitPrice: 100
          }
        ]
      },
      sessionCookie
    );
    const queueItem = await postJson<SyncQueueItemResponse>(
      app,
      `/businesses/${businessId}/sync-queue`,
      {
        idempotencyKey: "cp7-confirm-oversold-1",
        mutationType: "invoice.confirm",
        payload: {
          invoiceId: draft.id
        }
      },
      sessionCookie
    );

    const replay = await postJson<SyncReplayItemResponse>(
      app,
      `/businesses/${businessId}/sync-queue/${queueItem.id}/replay`,
      {},
      sessionCookie
    );

    expect(replay.item.status).toBe("conflict");
    expect(replay.item.conflict).toMatchObject({
      code: "stock_insufficient"
    });
    expect(store.snapshot().products.find((item) => item.id === product.id)?.quantity).toBe(1);
    expect(store.snapshot().invoices.find((invoice) => invoice.id === draft.id)?.status).toBe(
      "draft"
    );
    expect(
      store.snapshot().inventoryMovements.filter((movement) => movement.type === "sale")
    ).toHaveLength(0);

    const queue = await getJson<SyncQueueResponse>(
      app,
      `/businesses/${businessId}/sync-queue`,
      sessionCookie
    );
    expect(queue.summary).toMatchObject({
      conflict: 1,
      synced: 0
    });

    await app.close();
  });
});

async function createOwnerBusiness(app: ReturnType<typeof buildApi>) {
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination: "254700000007"
  });
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otpResponse.challengeId,
      code: otpResponse.devOtp
    })
  });
  const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
  const auth = verifyResponse.json<VerifyOtpResponse>();
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "Jane's Shop",
      language: "en"
    },
    sessionCookie
  );

  expect(auth.session.id).toBeTruthy();

  return {
    businessId: business.business.id,
    sessionCookie
  };
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: cookie === undefined ? jsonHeaders() : { ...jsonHeaders(), cookie },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);

  return response.json<TResponse>();
}

async function getJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: {
      cookie
    }
  });

  expect(response.statusCode).toBe(200);

  return response.json<TResponse>();
}

function jsonHeaders(): Record<string, string> {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined) {
    throw new Error("Expected set-cookie header.");
  }

  return value.split(";")[0] ?? value;
}
