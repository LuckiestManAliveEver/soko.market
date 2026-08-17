import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SYNC_COLLECTIONS,
  isAccountSyncCollection,
  type BetaFeatureFlagSummary,
  type BetaReadinessReportSummary,
  type BetaSupportTicketSummary,
  type BuyFeedSummary,
  type CountryTaxConfigSummary,
  type DeviceTrustSummary,
  type InvoiceSummary,
  type LaunchChecklistItemSummary,
  type LaunchIncidentSummary,
  type LaunchReadinessReportSummary,
  type LaunchSettingsSummary,
  type LogisticsSummary,
  type NetworkGraphSummary,
  type ProductCaptureJobSummary,
  type PurchaseReceiptSummary,
  type ReceiptOCRJobSummary,
  type SalesAgentSummary,
  type StatusBroadcastSummary,
  type SupplierBusinessCardSummary,
  type UnifiedCheckoutSummary,
  type VerificationTierSummary
} from "../packages/shared-types/src/index";
import { buildApi } from "../services/api/src/app";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";
import { createBackendModelAdapter } from "../services/api/src/inference/model-runtime";

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
    sokoId: string;
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
  it("persists passkey ceremony creation without replacing the application snapshot", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const pool = new Pool({ connectionString });
    const sentinelId = randomUUID();
    let ceremonyId: string | null = null;

    try {
      const now = new Date();
      const sentinel = {
        id: sentinelId,
        kind: "authentication",
        purpose: "login",
        accountId: null,
        challenge: "targeted-write-sentinel",
        webauthnUserId: null,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        createdAt: now.toISOString()
      };
      await pool.query(
        `
          insert into cp2_passkey_ceremonies
            (entity_id, business_id, account_id, user_id, parent_id, record, updated_at)
          values ($1, null, null, null, null, $2::jsonb, now())
        `,
        [sentinelId, JSON.stringify(sentinel)]
      );

      const result = await store.beginPasskeyAuthentication({
        rpId: "localhost",
        purpose: "pin_recovery"
      });
      ceremonyId = result.ceremonyId;
      await store.flush();

      const persisted = await pool.query<{ entity_id: string }>(
        "select entity_id from cp2_passkey_ceremonies where entity_id = any($1::text[]) order by entity_id",
        [[sentinelId, ceremonyId]]
      );
      expect(persisted.rows.map((row) => row.entity_id).sort()).toEqual(
        [sentinelId, ceremonyId].sort()
      );
      expect((await store.health()).persistenceQueue).toMatchObject({
        status: "ok",
        pendingCount: 0,
        queuedCount: 0,
        active: false,
        activeOperation: null,
        lastWaitDurationMs: expect.any(Number),
        lastRunDurationMs: expect.any(Number),
        lastCompletedAt: expect.any(String)
      });
    } finally {
      await pool.query("delete from cp2_passkey_ceremonies where entity_id = any($1::text[])", [
        [sentinelId, ...(ceremonyId === null ? [] : [ceremonyId])]
      ]);
      await pool.end();
      await store.close();
    }
  }, 15_000);

  it("does not expose retired phone verification routes", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const app = buildApi({ cp2: { store }, mutationPersistenceFlush: () => store.flush() });
    const response = await app.inject({
      method: "POST",
      url: "/auth/phone/challenges",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        phone: `+254702${Date.now().toString().slice(-6)}`,
        purpose: "signup"
      })
    });
    expect(response.statusCode).toBe(404);
    expect(store.snapshot().smsDeliveryAttempts).toHaveLength(0);
    await app.close();
  }, 15_000);

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
  }, 15_000);

  it("reloads an active binding from Postgres and routes chat through the backend adapter", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const modelId = "qwen2.5-0.5b-android";
    const inferenceCalls: string[] = [];
    const createAdapter = () =>
      createBackendModelAdapter({
        baseUrl: "http://soko-market-inference:4002",
        modelId,
        serviceToken: "postgres-integration-token",
        connectTimeoutMs: 500,
        timeoutMs: 1_000,
        fetch: async (input) => {
          const url = String(input);
          inferenceCalls.push(url);
          const body = url.endsWith("/health/ready")
            ? {
                ok: true,
                engine: "ollama",
                models: [
                  {
                    id: modelId,
                    providerModelId: "qwen2.5:0.5b",
                    available: true,
                    digest: "sha256:postgres-integration"
                  }
                ]
              }
            : url.endsWith("/probe")
              ? {
                  ok: true,
                  modelId,
                  providerModelId: "qwen2.5:0.5b",
                  engine: "ollama",
                  latencyMs: 4
                }
              : {
                  ok: true,
                  id: "postgres-inference-request",
                  modelId,
                  providerModelId: "qwen2.5:0.5b",
                  engine: "ollama",
                  text: JSON.stringify({ type: "response", message: "postgres market" }),
                  latencyMs: 8,
                  usage: { promptTokens: 7, completionTokens: 3 },
                  finishReason: "stop"
                };
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      });
    const adapterResolver = ({ modelId: requestedModelId }: { modelId: string }) =>
      requestedModelId === modelId ? createAdapter() : undefined;

    const store = await createPostgresCp2Store({
      databaseUrl: connectionString,
      modelRuntimeAdapterResolver: adapterResolver
    });
    const app = buildApi({ cp2: { store }, mutationPersistenceFlush: () => store.flush() });
    const uniquePhone = `254705${Date.now().toString().slice(-6)}`;
    const { business, sessionCookie } = await createOwnerBusiness(app, uniquePhone);
    const activation = await postJson<{ binding: { id: string; modelId: string } }>(
      app,
      `/api/agents/${business.id}/models/${modelId}/activate`,
      {
        shopId: business.id,
        executionTarget: "backend",
        executionMode: "LOCAL_FIRST",
        fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
        permissions: {
          allowInstalledApp: false,
          allowRemoteShopDevice: false,
          allowOpenAIFallback: false
        },
        fallbackModelId: null
      },
      sessionCookie
    );
    await store.flush();
    await app.close();

    const restoredStore = await createPostgresCp2Store({
      databaseUrl: connectionString,
      modelRuntimeAdapterResolver: adapterResolver
    });
    const restoredApp = buildApi({
      cp2: { store: restoredStore },
      mutationPersistenceFlush: () => restoredStore.flush()
    });
    const binding = await getJson<{ binding: { id: string; modelId: string } }>(
      restoredApp,
      `/api/agents/${business.id}/model-binding?shopId=${business.id}`,
      sessionCookie
    );
    expect(binding.binding).toMatchObject({ id: activation.binding.id, modelId });

    const turn = await postJson<{
      turn: {
        response: string;
        model: { bindingId: string; modelId: string; inferenceRequestId: string };
      };
    }>(
      restoredApp,
      `/businesses/${business.id}/runtime/turns`,
      { message: "Reply with postgres market" },
      sessionCookie
    );
    expect(turn.turn).toMatchObject({
      response: "postgres market",
      model: {
        bindingId: activation.binding.id,
        modelId,
        inferenceRequestId: "postgres-inference-request"
      }
    });
    expect(inferenceCalls.some((url) => url.endsWith("/v1/chat/completions"))).toBe(true);

    await restoredApp.close();
  }, 30_000);

  it("persists phone-first access, verified recovery email, and password login across restarts", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const suffix = Date.now().toString().slice(-7);
    const phone = `+25473${suffix}`;
    const email = `access-${suffix}@example.test`;
    const password = "persistent account access password";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const app = buildApi({
      cp2: { store },
      mutationPersistenceFlush: () => store.flush()
    });

    const started = await app.inject({
      method: "POST",
      url: "/auth/signup/start",
      headers: jsonHeaders(),
      payload: JSON.stringify({ type: "phone", identifier: phone })
    });
    expect(started.statusCode).toBe(200);
    const transactionId = started.json<{ transactionId: string }>().transactionId;
    const completed = await app.inject({
      method: "POST",
      url: "/auth/signup/complete",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        transactionId,
        displayName: "Persistent Access Owner",
        email,
        password,
        passwordConfirmation: password,
        termsAccepted: true,
        privacyAccepted: true
      })
    });
    expect(completed.statusCode).toBe(200);
    const signupCookie = extractSessionCookie(completed.headers["set-cookie"]);
    const verification = await app.inject({
      method: "POST",
      url: "/auth/email/verification/start",
      headers: { cookie: signupCookie }
    });
    expect(verification.statusCode).toBe(200);
    const verificationData = verification.json<{
      challengeId: string;
      developmentCode: string;
    }>();
    const verified = await app.inject({
      method: "POST",
      url: "/auth/email/verification/verify",
      headers: { ...jsonHeaders(), cookie: signupCookie },
      payload: JSON.stringify({
        challengeId: verificationData.challengeId,
        code: verificationData.developmentCode
      })
    });
    expect(verified.statusCode).toBe(200);

    await store.flush();
    await app.close();
    await store.close();

    const restoredStore = await createPostgresCp2Store({ databaseUrl: connectionString });
    const restoredApp = buildApi({
      cp2: { store: restoredStore },
      mutationPersistenceFlush: () => restoredStore.flush()
    });
    const login = await restoredApp.inject({
      method: "POST",
      url: "/auth/login/password",
      headers: jsonHeaders(),
      payload: JSON.stringify({ type: "email", identifier: email, password })
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      account: { primaryAuthDestination: phone },
      session: { id: expect.any(String) }
    });
    expect(restoredStore.snapshot().accountIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "email",
          normalizedValue: email,
          verifiedAt: expect.any(String)
        })
      ])
    );
    expect(restoredStore.snapshot().passwordCredentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ passwordHash: expect.stringContaining("scrypt$password-v1$") })
      ])
    );

    await restoredApp.close();
    await restoredStore.close();
  }, 20_000);

  // Regression test: continueWithChannelPin and loginWithSokoIdPin back the endpoints the actual
  // product frontend calls for every sign up and log in (PhoneFirstAuthentication.tsx) - unlike
  // the /auth/pin/signup fixture other tests in this file use to bootstrap accounts. Both were
  // missing from postgres-store.ts's mutatingMethodNames allowlist, so calling them through the
  // Postgres proxy never queued a save on its own. In production this gap is masked on the HTTP
  // path because every auth route also calls setAuthSessionCookies -> store.prepareDeviceSession
  // (already allowlisted) right after, and a save is always a full store.snapshot(), so that
  // incidental call sweeps the account/session in too - which is exactly why this needs a store-
  // level test that calls the store directly and skips that side effect, rather than a route-level
  // test through app.inject(), to actually exercise the gap the allowlist entry closes.
  it("queues a Postgres save for continueWithChannelPin and loginWithSokoIdPin on their own", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const suffix = Date.now().toString().slice(-7);
    const phone = `+25470${suffix}`;
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const pool = new Pool({ connectionString });

    try {
      const signup = store.continueWithChannelPin({
        channel: "phone",
        destination: phone,
        pin: "7421"
      });
      expect(signup.isNewAccount).toBe(true);

      await store.flush();
      const accountRow = await pool.query("select id from accounts where id = $1", [
        signup.account.id
      ]);
      expect(accountRow.rows).toHaveLength(1);

      const login = store.continueWithChannelPin({
        channel: "phone",
        destination: phone,
        pin: "7421"
      });
      expect(login.isNewAccount).toBe(false);

      await store.flush();
      const loginSessionRow = await pool.query("select id from sessions where id = $1", [
        login.session.id
      ]);
      expect(loginSessionRow.rows).toHaveLength(1);

      const business = store.createBusiness({
        sessionId: login.session.id,
        name: "Continue Flow Shop",
        language: "en"
      });
      await store.flush();

      const storeLogin = store.loginWithSokoIdPin({
        sokoId: business.business.sokoId,
        pin: "7421"
      });

      await store.flush();
      const storeLoginSessionRow = await pool.query("select id from sessions where id = $1", [
        storeLogin.session.id
      ]);
      expect(storeLoginSessionRow.rows).toHaveLength(1);
    } finally {
      await pool.end();
      await store.close();
    }
  }, 20_000);

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
    expect(wrongPin.json()).toMatchObject({ code: "auth_credentials_invalid" });
    await store.flush();
    expect(await syncCount(pool, accountId)).toBe(countBeforeWrongPin);

    const loginSessionIds: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const login = await app.inject({
        method: "POST",
        url: "/auth/pin/login",
        headers: jsonHeaders(),
        payload: JSON.stringify({ method: "phone", contact: uniquePhone, pin: "4826" })
      });
      expect(login.statusCode).toBe(200);
      const loginCookie = extractSessionCookie(login.headers["set-cookie"]);
      const loginBody = login.json<{ session: { id: string } }>();
      loginSessionIds.push(loginBody.session.id);
      expect(loginCookie).toContain("soko_session=");

      const authenticated = await app.inject({
        method: "GET",
        url: "/session",
        headers: { cookie: loginCookie }
      });
      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json()).toMatchObject({
        account: { id: accountId },
        session: { id: loginBody.session.id }
      });
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
    const persistedLoginSessions = await pool.query<{ count: string }>(
      "select count(*)::text as count from sessions where id = any($1::uuid[])",
      [loginSessionIds]
    );
    expect(persistedLoginSessions.rows[0]?.count).toBe("2");

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
  }, 30_000);

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
  }, 15_000);

  it("persists a shop presence update instead of failing (shopPresences has no id field)", async () => {
    // Regression test: ShopPresenceSummary (packages/shared-types) has no `id` field - it is keyed
    // by businessId in the in-memory store. recordEntityId's fallback case required "id" for any
    // collection without an explicit case, which made every presence update fail with 500 whenever
    // the Postgres store persisted it (discovered while testing the save-skip/retry changes above).
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const app = buildApi({ cp2: { store }, mutationPersistenceFlush: () => store.flush() });
    const pool = new Pool({ connectionString });

    try {
      const uniquePhone = `254703${Date.now().toString().slice(-6)}`;
      const { business, sessionCookie } = await createOwnerBusiness(app, uniquePhone);

      const response = await app.inject({
        method: "PATCH",
        url: `/businesses/${business.id}/presence`,
        headers: { ...jsonHeaders(), cookie: sessionCookie },
        payload: JSON.stringify({ status: "private" })
      });

      expect(response.statusCode).toBe(200);
      const persisted = await pool.query<{ record: { status: string } }>(
        "select record from cp2_shop_presences where entity_id = $1",
        [business.id]
      );
      expect(persisted.rows[0]?.record.status).toBe("private");
    } finally {
      await pool.end();
      await app.close();
      await store.close();
    }
  }, 15_000);

  it("skips re-persisting a collection that has not changed since the last save", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    const app = buildApi({ cp2: { store }, mutationPersistenceFlush: () => store.flush() });
    const pool = new Pool({ connectionString });

    try {
      const uniquePhone = `254701${Date.now().toString().slice(-6)}`;
      const { business, sessionCookie } = await createOwnerBusiness(app, uniquePhone);
      const product = await postJson<ProductResponse>(
        app,
        `/businesses/${business.id}/products`,
        { name: "Untouched Rice", quantity: 5, unit: "kg", buyingPrice: 90, sellingPrice: 120 },
        sessionCookie
      );
      await store.flush();
      const beforeUpdatedAt = await rowUpdatedAt(pool, "cp2_products", product.id);
      expect(beforeUpdatedAt).not.toBeNull();

      // An unrelated mutation on a different collection (presence) must not touch the products
      // row's persisted state at all - not even re-write it with identical content.
      await app.inject({
        method: "PATCH",
        url: `/businesses/${business.id}/presence`,
        headers: { ...jsonHeaders(), cookie: sessionCookie },
        payload: JSON.stringify({ status: "private" })
      });
      await store.flush();
      const afterUpdatedAt = await rowUpdatedAt(pool, "cp2_products", product.id);

      expect(afterUpdatedAt).toEqual(beforeUpdatedAt);

      // Actually changing the product must still persist normally. PATCH replaces the whole
      // record (name is required by parseProductBody), not a partial merge.
      const updateResponse = await app.inject({
        method: "PATCH",
        url: `/businesses/${business.id}/products/${product.id}`,
        headers: { ...jsonHeaders(), cookie: sessionCookie },
        payload: JSON.stringify({
          name: "Untouched Rice",
          quantity: 6,
          unit: "kg",
          buyingPrice: 90,
          sellingPrice: 120
        })
      });
      expect(updateResponse.statusCode).toBe(200);
      await store.flush();
      const afterRealChangeUpdatedAt = await rowUpdatedAt(pool, "cp2_products", product.id);
      expect(afterRealChangeUpdatedAt).not.toEqual(beforeUpdatedAt);

      const persistedProduct = await pool.query<{ record: { quantity: number } }>(
        "select record from cp2_products where entity_id = $1",
        [product.id]
      );
      expect(persistedProduct.rows[0]?.record.quantity).toBe(6);
    } finally {
      await pool.end();
      await app.close();
      await store.close();
    }
  }, 20_000);

  it("does not discard in-memory mutations when a save fails, and recovers on its own", async () => {
    expect(databaseUrl).toBeDefined();
    const connectionString = databaseUrl ?? "";
    process.env.DB_PERSISTENCE_RETRY_INITIAL_MS = "50";
    process.env.DB_PERSISTENCE_RETRY_MAX_MS = "200";
    const store = await createPostgresCp2Store({ databaseUrl: connectionString });
    // Deliberately not wiring mutationPersistenceFlush here: production requests do not block on
    // persistence (see the Proxy at the bottom of postgres-store.ts), and this test needs the
    // product-creation request itself to succeed while the triggered save fails in the background
    // - that gap is exactly what the reverted-in-memory-state bug lived in.
    const app = buildApi({ cp2: { store } });
    const pool = new Pool({ connectionString });

    try {
      const uniquePhone = `254702${Date.now().toString().slice(-6)}`;
      const { business, sessionCookie } = await createOwnerBusiness(app, uniquePhone);
      await store.flush();

      // Force every future write to cp2_products to fail, without disturbing existing rows
      // (NOT VALID skips the initial validation scan) or any other table.
      await pool.query(
        "alter table cp2_products add constraint force_persistence_failure check (false) not valid"
      );

      const failingProduct = await postJson<ProductResponse>(
        app,
        `/businesses/${business.id}/products`,
        {
          name: "Race Condition Beans",
          quantity: 3,
          unit: "kg",
          buyingPrice: 50,
          sellingPrice: 70
        },
        sessionCookie
      );

      // Give the queued save a moment to actually run and fail.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));

      // The mutation must still be visible in memory - not reverted because Postgres rejected it.
      expect(store.snapshot().products).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: failingProduct.id })])
      );
      const healthDuringFailure = await store.health();
      expect(healthDuringFailure.persistenceError).not.toBeNull();
      const notYetPersisted = await pool.query("select 1 from cp2_products where entity_id = $1", [
        failingProduct.id
      ]);
      expect(notYetPersisted.rows).toHaveLength(0);

      // Fix the underlying problem and let the scheduled retry (no further mutation needed) catch up.
      await pool.query("alter table cp2_products drop constraint force_persistence_failure");
      await waitUntil(async () => {
        const result = await pool.query("select 1 from cp2_products where entity_id = $1", [
          failingProduct.id
        ]);
        // Committed-and-visible-in-Postgres can momentarily lead clearing lastPersistenceError,
        // since a few more in-process steps (unlock, snapshot bookkeeping) run after commit before
        // the queue's success handler fires - wait for both, not just the row.
        return result.rows.length > 0 && (await store.health()).persistenceError === null;
      });
    } finally {
      await pool
        .query("alter table cp2_products drop constraint if exists force_persistence_failure")
        .catch(() => undefined);
      await pool.end();
      await app.close();
      await store.close();
      delete process.env.DB_PERSISTENCE_RETRY_INITIAL_MS;
      delete process.env.DB_PERSISTENCE_RETRY_MAX_MS;
    }
  }, 20_000);

  it(
    "persists status broadcasts and unified checkout orders (buy_orders/status_orders) across store restarts",
    async () => {
      expect(databaseUrl).toBeDefined();
      const onePixelPng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZCr8AAAAASUVORK5CYII=";

      const sellerPhone = `254701${Date.now().toString().slice(-6)}`;
      const buyerPhone = `254702${Date.now().toString().slice(-6)}`;
      const store = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const app = buildApi({ cp2: { store } });

      const seller = await createOwnerBusiness(app, sellerPhone);
      const buyer = await createOwnerBusiness(app, buyerPhone);

      await postJson<ProductResponse>(
        app,
        `/businesses/${seller.business.id}/products`,
        { name: "Postgres Mangoes", quantity: 10, unit: "kg", buyingPrice: 100, sellingPrice: 150 },
        seller.sessionCookie
      );

      const sellerGraph = await postJson<NetworkGraphSummary>(
        app,
        "/network/sync/contacts",
        { contacts: [{ name: "Buyer Contact", phone: `+${buyerPhone}` }] },
        seller.sessionCookie
      );
      const buyerNode = sellerGraph.nodes.find((node) => node.displayName === "Buyer Contact")!;

      const job = await postJson<ProductCaptureJobSummary>(
        app,
        `/businesses/${seller.business.id}/product-captures`,
        { fileName: "shelf.jpg", contentType: "image/png", contentBase64: onePixelPng },
        seller.sessionCookie
      );
      await postJson(
        app,
        `/businesses/${seller.business.id}/product-captures/${job.id}/items/${job.items[0]!.id}/confirm`,
        { title: "Postgres Bananas", visiblePrice: 90 },
        seller.sessionCookie
      );
      const status = await postJson<StatusBroadcastSummary>(
        app,
        `/businesses/${seller.business.id}/status-broadcasts`,
        { sourceCaptureJobId: job.id, recipientNodeIds: [buyerNode.id] },
        seller.sessionCookie
      );

      const feed = await getJson<BuyFeedSummary>(app, "/buy/search?query=", buyer.sessionCookie);
      const catalogueResult = feed.results.find((r) => r.title === "Postgres Mangoes")!;
      const contactResult = feed.results.find((r) => r.title === "Postgres Bananas")!;

      const checkout = await postJson<UnifiedCheckoutSummary>(
        app,
        "/buy/checkout",
        {
          items: [
            {
              sourceKind: "catalogue",
              sourceId: catalogueResult.sourceId,
              sourceLabel: catalogueResult.sourceLabel,
              title: catalogueResult.title,
              quantity: 1,
              agentId: catalogueResult.agentId,
              productId: catalogueResult.productId
            },
            {
              sourceKind: "contact",
              sourceId: contactResult.sourceId,
              sourceLabel: contactResult.sourceLabel,
              title: contactResult.title,
              quantity: 1,
              statusBroadcastId: contactResult.statusBroadcastId,
              productCaptureItemId: contactResult.productCaptureItemId
            }
          ]
        },
        buyer.sessionCookie
      );
      expect(checkout.handoffs).toHaveLength(2);
      const contactHandoff = checkout.handoffs.find((handoff) => handoff.kind === "contact")!;

      await store.flush();
      await app.close();

      const restoredStore = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const restoredApp = buildApi({ cp2: { store: restoredStore } });
      try {
        const restoredStatus = await getJson<StatusBroadcastSummary>(
          restoredApp,
          `/businesses/${seller.business.id}/status-broadcasts/${status.id}`,
          seller.sessionCookie
        );
        expect(restoredStatus.resultingOrderIds).toEqual(
          expect.arrayContaining([contactHandoff.orderId])
        );

        const restoredCheckout = await getJson<UnifiedCheckoutSummary>(
          restoredApp,
          `/buy/checkouts/${checkout.id}`,
          buyer.sessionCookie
        );
        expect(restoredCheckout.handoffs).toEqual(checkout.handoffs);
      } finally {
        await restoredApp.close();
        await restoredStore.close();
      }
    },
    20_000
  );

  it(
    "persists compliance/beta/launch domain records across store restarts",
    async () => {
      expect(databaseUrl).toBeDefined();
      const ownerPhone = `254703${Date.now().toString().slice(-6)}`;
      const store = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const app = buildApi({ cp2: { store } });

      const owner = await createOwnerBusiness(app, ownerPhone);
      const businessId = owner.business.id;

      const verification = await patchJson<VerificationTierSummary>(
        app,
        `/businesses/${businessId}/compliance/verification`,
        { tier: "owner_verified", evidenceType: "owner_attestation", note: "Postgres slice test" },
        owner.sessionCookie
      );
      const taxConfig = await patchJson<CountryTaxConfigSummary>(
        app,
        `/businesses/${businessId}/compliance/tax-config`,
        { countryCode: "KE", defaultTaxRate: 0.16, taxId: "P000111222A", pricesIncludeTax: true },
        owner.sessionCookie
      );
      const deviceTrust = await patchJson<DeviceTrustSummary>(
        app,
        `/businesses/${businessId}/compliance/device-trust`,
        { deviceId: "browser-session", level: "trusted", reason: "Postgres slice test" },
        owner.sessionCookie
      );
      await patchJson(
        app,
        `/businesses/${businessId}/beta/access`,
        { status: "active", pauseReason: null, invitedMerchantCount: 3 },
        owner.sessionCookie
      );
      await patchJson(
        app,
        `/businesses/${businessId}/beta/feature-flags/closed_beta`,
        { enabled: true, reason: "Postgres slice test" },
        owner.sessionCookie
      );
      await postJson(
        app,
        `/businesses/${businessId}/beta/device-tests`,
        {
          deviceClass: "android_1gb",
          workflow: "checkout",
          status: "passed",
          durationMs: 1200,
          notes: "Postgres slice test"
        },
        owner.sessionCookie
      );
      const supportTicket = await postJson<BetaSupportTicketSummary>(
        app,
        `/businesses/${businessId}/beta/support-tickets`,
        { severity: "high", title: "Postgres slice ticket", body: "Persistence check" },
        owner.sessionCookie
      );
      await postJson(
        app,
        `/businesses/${businessId}/beta/telemetry`,
        { kind: "session", message: null },
        owner.sessionCookie
      );
      const launchSettings = await patchJson<LaunchSettingsSummary>(
        app,
        `/businesses/${businessId}/launch/settings`,
        {
          status: "open",
          publicOnboardingEnabled: true,
          rollbackArmed: true,
          freezeActive: false,
          allowedSignupCount: 5,
          pauseReason: null
        },
        owner.sessionCookie
      );
      await patchJson(
        app,
        `/businesses/${businessId}/launch/checklist/environment_config`,
        { status: "passed", evidence: "Postgres slice test" },
        owner.sessionCookie
      );
      const incident = await postJson<LaunchIncidentSummary>(
        app,
        `/businesses/${businessId}/launch/incidents`,
        {
          severity: "medium",
          category: "onboarding",
          title: "Postgres slice incident",
          body: "Persistence check"
        },
        owner.sessionCookie
      );

      const betaReadinessBefore = await getJson<BetaReadinessReportSummary>(
        app,
        `/businesses/${businessId}/beta/readiness`,
        owner.sessionCookie
      );
      const launchReadinessBefore = await getJson<LaunchReadinessReportSummary>(
        app,
        `/businesses/${businessId}/launch/readiness`,
        owner.sessionCookie
      );

      await store.flush();
      await app.close();

      const restoredStore = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const restoredApp = buildApi({ cp2: { store: restoredStore } });
      try {
        const restoredVerification = await getJson<VerificationTierSummary>(
          restoredApp,
          `/businesses/${businessId}/compliance/verification`,
          owner.sessionCookie
        );
        expect(restoredVerification).toEqual(verification);

        const restoredTaxConfig = await getJson<CountryTaxConfigSummary>(
          restoredApp,
          `/businesses/${businessId}/compliance/tax-config`,
          owner.sessionCookie
        );
        expect(restoredTaxConfig).toEqual(taxConfig);

        const restoredDeviceTrust = await getJson<DeviceTrustSummary>(
          restoredApp,
          `/businesses/${businessId}/compliance/device-trust`,
          owner.sessionCookie
        );
        expect(restoredDeviceTrust).toEqual(deviceTrust);

        const restoredFeatureFlags = await getJson<BetaFeatureFlagSummary[]>(
          restoredApp,
          `/businesses/${businessId}/beta/feature-flags`,
          owner.sessionCookie
        );
        const restoredClosedBeta = restoredFeatureFlags.find((flag) => flag.key === "closed_beta");
        expect(restoredClosedBeta?.enabled).toBe(true);

        const restoredSupportTickets = await getJson<BetaSupportTicketSummary[]>(
          restoredApp,
          `/businesses/${businessId}/beta/support-tickets`,
          owner.sessionCookie
        );
        expect(restoredSupportTickets.find((ticket) => ticket.id === supportTicket.id)).toEqual(
          supportTicket
        );

        const restoredChecklist = await getJson<LaunchChecklistItemSummary[]>(
          restoredApp,
          `/businesses/${businessId}/launch/checklist`,
          owner.sessionCookie
        );
        const restoredEnvironmentConfig = restoredChecklist.find(
          (item) => item.key === "environment_config"
        );
        expect(restoredEnvironmentConfig?.status).toBe("passed");

        const restoredIncidents = await getJson<LaunchIncidentSummary[]>(
          restoredApp,
          `/businesses/${businessId}/launch/incidents`,
          owner.sessionCookie
        );
        expect(restoredIncidents.find((item) => item.id === incident.id)).toEqual(incident);

        const restoredBetaReadiness = await getJson<BetaReadinessReportSummary>(
          restoredApp,
          `/businesses/${businessId}/beta/readiness`,
          owner.sessionCookie
        );
        expect(restoredBetaReadiness.deviceTesting.passedDeviceClasses).toEqual(
          betaReadinessBefore.deviceTesting.passedDeviceClasses
        );
        expect(restoredBetaReadiness.telemetry.sessionEventCount).toBe(
          betaReadinessBefore.telemetry.sessionEventCount
        );
        expect(restoredBetaReadiness.support.openTicketCount).toBe(
          betaReadinessBefore.support.openTicketCount
        );

        const restoredLaunchReadiness = await getJson<LaunchReadinessReportSummary>(
          restoredApp,
          `/businesses/${businessId}/launch/readiness`,
          owner.sessionCookie
        );
        expect(restoredLaunchReadiness.checklist.passed).toBe(launchReadinessBefore.checklist.passed);
        expect(restoredLaunchReadiness.support.openIncidentCount).toBe(
          launchReadinessBefore.support.openIncidentCount
        );
        expect(restoredLaunchReadiness.settings).toEqual(launchSettings);
      } finally {
        await restoredApp.close();
        await restoredStore.close();
      }
    },
    20_000
  );

  it(
    "persists logistics records (including the logisticsByInvoice index) across store restarts",
    async () => {
      expect(databaseUrl).toBeDefined();
      const ownerPhone = `254704${Date.now().toString().slice(-6)}`;
      const store = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const app = buildApi({ cp2: { store } });

      const owner = await createOwnerBusiness(app, ownerPhone);
      const businessId = owner.business.id;

      const product = await postJson<ProductResponse>(
        app,
        `/businesses/${businessId}/products`,
        { name: "Postgres Logistics Rice", quantity: 10, unit: "kg", buyingPrice: 80, sellingPrice: 120 },
        owner.sessionCookie
      );
      const draftInvoice = await postJson<{ id: string }>(
        app,
        `/businesses/${businessId}/invoices`,
        { items: [{ productId: product.id, quantity: 2, unitPrice: 120 }] },
        owner.sessionCookie
      );
      const confirmed = await postJson<{ invoice: InvoiceSummary }>(
        app,
        `/businesses/${businessId}/invoices/${draftInvoice.id}/confirm`,
        {},
        owner.sessionCookie
      );

      const logistics = await postJson<LogisticsSummary>(
        app,
        `/businesses/${businessId}/logistics`,
        { invoiceId: confirmed.invoice.id, method: "delivery", destination: "Nairobi CBD", note: null },
        owner.sessionCookie
      );
      const updated = await patchJson<LogisticsSummary>(
        app,
        `/businesses/${businessId}/logistics/${logistics.id}`,
        { status: "ready", note: "Postgres slice test" },
        owner.sessionCookie
      );

      await store.flush();
      await app.close();

      const restoredStore = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const restoredApp = buildApi({ cp2: { store: restoredStore } });
      try {
        const restoredList = await getJson<LogisticsSummary[]>(
          restoredApp,
          `/businesses/${businessId}/logistics`,
          owner.sessionCookie
        );
        expect(restoredList.find((item) => item.id === logistics.id)).toEqual(updated);

        // logisticsByInvoice is a derived index (never itself a Cp2Snapshot field) rebuilt
        // per-item during hydrateSnapshot from the restored logistics records - creating a second
        // logistics record for the same invoice must still be rejected after a restart, proving
        // the index round-tripped correctly, not just the underlying logistics Map.
        const duplicateAttempt = await restoredApp.inject({
          method: "POST",
          url: `/businesses/${businessId}/logistics`,
          headers: { ...jsonHeaders(), cookie: owner.sessionCookie },
          payload: JSON.stringify({
            invoiceId: confirmed.invoice.id,
            method: "pickup",
            destination: null,
            note: null
          })
        });
        expect(duplicateAttempt.statusCode).toBe(409);
      } finally {
        await restoredApp.close();
        await restoredStore.close();
      }
    },
    20_000
  );

  it(
    "persists suppliers, sales agents, and purchase receipts (via receipt-OCR confirm) across store restarts",
    async () => {
      expect(databaseUrl).toBeDefined();
      const ownerPhone = `254705${Date.now().toString().slice(-6)}`;
      const store = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const app = buildApi({ cp2: { store } });

      const owner = await createOwnerBusiness(app, ownerPhone);
      const businessId = owner.business.id;

      const supplier = await postJson<SupplierBusinessCardSummary>(
        app,
        `/businesses/${businessId}/suppliers`,
        { name: "Postgres Wholesale Ltd", phone: "+254711222333", email: null, notes: null },
        owner.sessionCookie
      );
      const salesAgent = await postJson<SalesAgentSummary>(
        app,
        `/businesses/${businessId}/suppliers/${supplier.id}/sales-agents`,
        { name: "Postgres Agent", phone: "+254722333444", email: null, notes: null },
        owner.sessionCookie
      );

      const ocrJob = await postJson<ReceiptOCRJobSummary>(
        app,
        `/businesses/${businessId}/receipt-ocr/jobs`,
        {
          fileName: "receipt.txt",
          contentType: "text/plain",
          contentBase64: null,
          extractedText:
            "Supplier: Postgres Wholesale Ltd\nPhone: +254711222333\nTotal: 500\nItem A, 2, 100, 200"
        },
        owner.sessionCookie
      );
      const receipt = await postJson<PurchaseReceiptSummary>(
        app,
        `/businesses/${businessId}/receipt-ocr/jobs/${ocrJob.id}/confirm`,
        { supplierId: supplier.id, salesAgentId: salesAgent.id },
        owner.sessionCookie
      );

      await store.flush();
      await app.close();

      const restoredStore = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
      const restoredApp = buildApi({ cp2: { store: restoredStore } });
      try {
        const restoredSuppliers = await getJson<SupplierBusinessCardSummary[]>(
          restoredApp,
          `/businesses/${businessId}/suppliers`,
          owner.sessionCookie
        );
        const restoredSupplier = restoredSuppliers.find((item) => item.id === supplier.id);
        expect(restoredSupplier?.name).toBe(supplier.name);
        // salesAgentCount/purchaseReceiptCount are derived by supplierBusinessCard from the
        // restored salesAgents/purchaseReceipts maps, not stored verbatim - a non-zero count here
        // proves those two maps round-tripped and stayed linked to this supplier after restart.
        expect(restoredSupplier?.salesAgentCount).toBe(1);
        expect(restoredSupplier?.purchaseReceiptCount).toBe(1);

        const restoredSalesAgents = await getJson<SalesAgentSummary[]>(
          restoredApp,
          `/businesses/${businessId}/suppliers/${supplier.id}/sales-agents`,
          owner.sessionCookie
        );
        expect(restoredSalesAgents.find((item) => item.id === salesAgent.id)?.name).toBe(
          salesAgent.name
        );

        const restoredReceipts = await getJson<PurchaseReceiptSummary[]>(
          restoredApp,
          `/businesses/${businessId}/purchase-receipts`,
          owner.sessionCookie
        );
        const restoredReceipt = restoredReceipts.find((item) => item.id === receipt.id);
        expect(restoredReceipt?.supplierId).toBe(supplier.id);
        expect(restoredReceipt?.salesAgentId).toBe(salesAgent.id);
        expect(restoredReceipt?.lineItems).toEqual(receipt.lineItems);
      } finally {
        await restoredApp.close();
        await restoredStore.close();
      }
    },
    20_000
  );
});

async function rowUpdatedAt(
  pool: SqlExecutor,
  tableName: string,
  entityId: string
): Promise<string | null> {
  const result = await pool.query<{ updated_at: string }>(
    `select updated_at::text as updated_at from ${tableName} where entity_id = $1`,
    [entityId]
  );
  return result.rows[0]?.updated_at ?? null;
}

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("Condition was not met within the timeout.");
}

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
  const phoneSuffix = accountId.replaceAll(/\D/gu, "").padEnd(9, "0").slice(0, 9);
  await client.query(
    `
      insert into accounts (
        id, primary_auth_channel, primary_auth_destination, created_at
      )
      values ($1, 'phone', $2, now())
    `,
    [accountId, `+254${phoneSuffix}`]
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

async function patchJson<T>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: unknown,
  cookie?: string
): Promise<T> {
  const response = await app.inject({
    method: "PATCH",
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
