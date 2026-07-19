import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SYNC_COLLECTIONS,
  isAccountSyncCollection
} from "../packages/shared-types/src/index";
import { buildApi } from "../services/api/src/app";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";

interface SqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
}

interface TestPool extends SqlExecutor {
  connect(): Promise<TestPoolClient>;
  end(): Promise<void>;
}

interface TestPoolClient extends SqlExecutor {
  release(): void;
}

const requireApiDependency = createRequire(resolve(process.cwd(), "services/api/package.json"));
const { Pool } = requireApiDependency("pg") as {
  Pool: new (options: { connectionString: string }) => TestPool;
};

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

interface McpTokenResponse {
  accessToken: string;
  token: { id: string };
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
    await postJson(app, "/auth/pin/setup", { pin: "6138" }, sessionCookie);
    const mcpToken = await postJson<McpTokenResponse>(
      app,
      "/v1/mcp/tokens",
      {
        name: "Postgres restart token",
        scopes: ["mcp:read", "mcp:act"],
        shopId: business.id,
        expiresInSeconds: 3600
      },
      sessionCookie
    );
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
    expect(
      restoredStore.authenticateMcpAccessToken({ accessToken: mcpToken.accessToken })
    ).toMatchObject({ tokenId: mcpToken.token.id, shopId: business.id });
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

  it("completes phone PIN login with canonical, non-duplicated sync rows", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const uniquePhone = `+254701${Date.now().toString().slice(-6)}`;
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const app = buildApi({
      cp2: { store },
      mutationPersistenceFlush: () => store.flush()
    });
    const signup = await app.inject({
      method: "POST",
      url: "/auth/pin/signup",
      headers: jsonHeaders(),
      payload: JSON.stringify({ method: "phone", contact: uniquePhone, pin: "4826" })
    });
    expect(signup.statusCode).toBe(200);
    const accountId = signup.json<{ account: { id: string } }>().account.id;
    const signupCookie = extractSessionCookie(signup.headers["set-cookie"]);
    const context = await getJson<{ conversationId: string }>(
      app,
      "/v1/session/context",
      signupCookie
    );
    await postJson(
      app,
      `/v1/conversations/${context.conversationId}/typing`,
      { typing: true },
      signupCookie
    );

    const pool = new Pool({ connectionString });
    const countBeforeWrongPin = await syncCount(pool, accountId);
    const wrongPin = await app.inject({
      method: "POST",
      url: "/auth/pin/login",
      headers: jsonHeaders(),
      payload: JSON.stringify({ method: "phone", contact: uniquePhone, pin: "0000" })
    });
    expect(wrongPin.statusCode).toBe(401);
    expect(wrongPin.json()).toMatchObject({ code: "pin_invalid" });
    await store.flush();
    expect(await syncCount(pool, accountId)).toBe(countBeforeWrongPin);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const login = await app.inject({
        method: "POST",
        url: "/auth/pin/login",
        headers: jsonHeaders(),
        payload: JSON.stringify({ method: "phone", contact: uniquePhone, pin: "4826" })
      });
      expect(login.statusCode).toBe(200);
      expect(extractSessionCookie(login.headers["set-cookie"])).toContain("soko_session=");
    }

    const rows = await pool.query<{ collection: string }>(
      `
        select collection
        from account_sync_changes
        where account_id = $1
        order by sequence
      `,
      [accountId]
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((row) => isAccountSyncCollection(row.collection))).toBe(true);
    expect(rows.rows.filter((row) => row.collection === "conversations")).toHaveLength(1);
    const duplicates = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from (
          select account_id, sequence
          from account_sync_changes
          where account_id = $1
          group by account_id, sequence
          having count(*) > 1
        ) duplicate_keys
      `,
      [accountId]
    );
    expect(duplicates.rows[0]?.count).toBe("0");

    const constraint = await pool.query<{ definition: string }>(
      `
        select pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conname = 'account_sync_changes_collection_check'
      `
    );
    for (const collection of ACCOUNT_SYNC_COLLECTIONS) {
      expect(constraint.rows[0]?.definition).toContain(collection);
    }

    await pool.end();
    await app.close();
    await store.close();
  });

  it("normalizes known aliases and fails safely on unknown historical collections", async () => {
    expect(databaseUrl).toBeDefined();
    const pool = new Pool({ connectionString: databaseUrl ?? "" });
    const migrationSql = await readFile(
      resolve(process.cwd(), "infra/db/migrations/032_account_sync_collection_constraint.sql"),
      "utf8"
    );
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(
        "alter table account_sync_changes drop constraint account_sync_changes_collection_check"
      );
      const aliasAccountId = randomUUID();
      await insertMigrationTestAccount(client, aliasAccountId);
      await insertMigrationTestSyncChange(client, aliasAccountId, "conversationTyping");
      await client.query(migrationSql);
      const normalized = await client.query<{ collection: string }>(
        "select collection from account_sync_changes where account_id = $1",
        [aliasAccountId]
      );
      expect(normalized.rows[0]?.collection).toBe("conversation_typing");
      await client.query("rollback");

      await client.query("begin");
      await client.query(
        "alter table account_sync_changes drop constraint account_sync_changes_collection_check"
      );
      const unknownAccountId = randomUUID();
      await insertMigrationTestAccount(client, unknownAccountId);
      await insertMigrationTestSyncChange(client, unknownAccountId, "unknown_historical_value");
      await expect(client.query(migrationSql)).rejects.toThrow(
        "Unknown account_sync_changes.collection values remain"
      );
      await client.query("rollback");
    } finally {
      client.release();
      await pool.end();
    }
  });
});

async function syncCount(pool: SqlExecutor, accountId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "select count(*)::text as count from account_sync_changes where account_id = $1",
    [accountId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function insertMigrationTestAccount(
  client: TestPoolClient,
  accountId: string
): Promise<void> {
  await client.query(
    `
      insert into accounts (
        id, primary_auth_channel, primary_auth_destination, created_at
      )
      values ($1, 'phone', $2, now())
    `,
    [accountId, `+254${accountId.replaceAll("-", "").slice(0, 9)}`]
  );
}

async function insertMigrationTestSyncChange(
  client: TestPoolClient,
  accountId: string,
  collection: string
): Promise<void> {
  await client.query(
    `
      insert into account_sync_changes (
        account_id, sequence, cursor, collection, entity_id, operation,
        shop_id, entity, changed_at, tombstone_expires_at
      )
      values ($1, 1, $2, $3, 'migration-test', 'upsert', null, '{}'::jsonb, now(), null)
    `,
    [accountId, randomUUID(), collection]
  );
}

async function createOwnerBusiness(
  app: ReturnType<typeof buildApi>,
  destination: string
): Promise<CreateBusinessResponse & { sessionCookie: string }> {
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/pin/signup",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      method: "phone",
      contact: destination,
      pin: "1234"
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
