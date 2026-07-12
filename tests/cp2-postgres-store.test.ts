import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

interface ProductResponse {
  id: string;
  name: string;
}

interface SyncPageResponse {
  accountId: string;
  nextCursor: string;
  changes: Array<{ accountId: string; collection: string }>;
}

const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

describePostgres("CP2 Postgres store", () => {
  it("persists API state in normalized Postgres tables across store restarts", async () => {
    expect(databaseUrl).toBeDefined();

    const uniquePhone = `254700${Date.now().toString().slice(-6)}`;
    const store = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
    const app = buildApi({ cp2: { store } });
    const { business, sessionCookie } = await createOwnerBusiness(app, uniquePhone);
    const product = await postJson<ProductResponse>(
      app,
      `/businesses/${business.id}/products`,
      {
        name: "Postgres Sugar",
        quantity: 8,
        unit: "kg",
        buyingPrice: 100,
        sellingPrice: 130
      },
      sessionCookie
    );
    const initialSyncPage = await getJson<SyncPageResponse>(
      app,
      "/v1/sync/changes?limit=100",
      sessionCookie
    );
    expect(initialSyncPage.changes.map((change) => change.collection)).toContain("shops");

    await store.flush();
    await app.close();

    const restoredStore = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
    const restoredApp = buildApi({ cp2: { store: restoredStore } });
    const products = await getJson<ProductResponse[]>(
      restoredApp,
      `/businesses/${business.id}/products`,
      sessionCookie
    );

    expect(products).toEqual([expect.objectContaining({ id: product.id, name: "Postgres Sugar" })]);
    const restoredSyncPage = await getJson<SyncPageResponse>(
      restoredApp,
      "/v1/sync/changes?limit=100",
      sessionCookie
    );
    expect(restoredSyncPage.nextCursor).toBe(initialSyncPage.nextCursor);
    expect(restoredSyncPage.changes).toEqual(initialSyncPage.changes);
    expect((await restoredStore.health()).syncChangeCount).toBeGreaterThan(0);

    await restoredApp.close();
  });
});

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  destination: string
): Promise<CreateBusinessResponse & { sessionCookie: string }> {
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination
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
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "Postgres Persistent Shop",
      language: "en"
    },
    sessionCookie
  );

  return {
    ...business,
    sessionCookie
  };
}

async function postJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown,
  cookie?: string
): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: {
      ...jsonHeaders(),
      ...(cookie === undefined ? {} : { cookie })
    },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json<T>();
}

async function getJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<T> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: {
      cookie
    }
  });

  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function jsonHeaders() {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | number | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  expect(typeof value).toBe("string");
  return String(value).split(";")[0] ?? "";
}
