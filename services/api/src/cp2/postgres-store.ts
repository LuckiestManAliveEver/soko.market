import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { createCp2Store, type Cp2Snapshot, type Cp2Store, type Cp2StoreOptions } from "./store.js";

type SnapshotCollectionKey = keyof Cp2Snapshot;
type SnapshotRecord = Record<string, unknown>;

interface NormalizedCollection {
  key: SnapshotCollectionKey;
  tableName: string;
}

const normalizedCollections: NormalizedCollection[] = [
  { key: "accounts", tableName: "cp2_accounts" },
  { key: "users", tableName: "cp2_users" },
  { key: "businesses", tableName: "cp2_businesses" },
  { key: "memberships", tableName: "cp2_memberships" },
  { key: "sessionContexts", tableName: "cp2_session_contexts" },
  { key: "conversations", tableName: "cp2_conversations" },
  { key: "conversationParticipants", tableName: "cp2_conversation_participants" },
  { key: "conversationMessages", tableName: "cp2_conversation_messages" },
  { key: "e2eeDevices", tableName: "cp2_e2ee_devices" },
  { key: "pushSubscriptions", tableName: "cp2_push_subscriptions" },
  { key: "marketplaceIntroStates", tableName: "cp2_marketplace_intro_states" },
  { key: "activeAiModels", tableName: "cp2_active_ai_models" },
  { key: "products", tableName: "cp2_products" },
  { key: "customers", tableName: "cp2_customers" },
  { key: "suppliers", tableName: "cp2_suppliers" },
  { key: "salesAgents", tableName: "cp2_sales_agents" },
  { key: "supplierContactLinks", tableName: "cp2_supplier_contact_links" },
  { key: "purchaseReceipts", tableName: "cp2_purchase_receipts" },
  { key: "receiptLineItems", tableName: "cp2_receipt_line_items" },
  { key: "receiptOCRJobs", tableName: "cp2_receipt_ocr_jobs" },
  { key: "invoices", tableName: "cp2_invoices" },
  { key: "payments", tableName: "cp2_payments" },
  { key: "logistics", tableName: "cp2_logistics" },
  { key: "dataExports", tableName: "cp2_data_exports" },
  { key: "accountDeletionRequests", tableName: "cp2_account_deletion_requests" },
  { key: "verificationTiers", tableName: "cp2_verification_tiers" },
  { key: "taxConfigs", tableName: "cp2_tax_configs" },
  { key: "deviceTrust", tableName: "cp2_device_trust" },
  { key: "betaAccess", tableName: "cp2_beta_access" },
  { key: "betaFeatureFlags", tableName: "cp2_beta_feature_flags" },
  { key: "betaDeviceTests", tableName: "cp2_beta_device_tests" },
  { key: "betaSupportTickets", tableName: "cp2_beta_support_tickets" },
  { key: "betaTelemetryEvents", tableName: "cp2_beta_telemetry_events" },
  { key: "launchSettings", tableName: "cp2_launch_settings" },
  { key: "launchChecklist", tableName: "cp2_launch_checklist" },
  { key: "launchIncidents", tableName: "cp2_launch_incidents" },
  { key: "documentImports", tableName: "cp2_document_imports" },
  { key: "documentImportSources", tableName: "cp2_document_import_sources" },
  { key: "notifications", tableName: "cp2_notifications" },
  { key: "runtimeSessions", tableName: "cp2_runtime_sessions" },
  { key: "runtimeTurns", tableName: "cp2_runtime_turns" },
  { key: "inventoryMovements", tableName: "cp2_inventory_movements" },
  { key: "syncQueue", tableName: "cp2_sync_queue_items" },
  { key: "otpChallenges", tableName: "cp2_otp_challenges" },
  { key: "sessions", tableName: "cp2_sessions" },
  { key: "userIdentities", tableName: "cp2_user_identities" },
  { key: "oauthSessions", tableName: "cp2_oauth_sessions" },
  { key: "accountPinHashes", tableName: "cp2_account_pin_hashes" },
  { key: "networkNodes", tableName: "cp2_network_nodes" },
  { key: "networkEdges", tableName: "cp2_network_edges" },
  { key: "networkSources", tableName: "cp2_network_sources" },
  { key: "networkPermissions", tableName: "cp2_network_permissions" },
  { key: "networkRoutes", tableName: "cp2_network_routes" },
  { key: "contactHashes", tableName: "cp2_contact_hashes" },
  { key: "externalIdentities", tableName: "cp2_external_identities" },
  { key: "sokoIdentityLinks", tableName: "cp2_soko_identity_links" },
  { key: "auditEvents", tableName: "cp2_audit_events" }
];

const mutatingMethodNames = new Set([
  "adjustProductStock",
  "approveAgentRoute",
  "authenticateSocialProfile",
  "beginOAuthSession",
  "completeOAuthCallback",
  "completeMarketplaceIntro",
  "confirmProductImport",
  "confirmReceiptOCRJob",
  "confirmSupplierImport",
  "createAgentRoute",
  "createBetaSupportTicket",
  "createBusiness",
  "createConversation",
  "createConversationMessage",
  "createDataExport",
  "createInvoice",
  "createLaunchIncident",
  "createLogistics",
  "createMcpAccessToken",
  "createProduct",
  "createProductCatalogueImport",
  "createReceiptOCRJob",
  "createRuntimeSession",
  "createRuntimeTurn",
  "createSalesAgent",
  "createSalesAgentFromPhoneContact",
  "createSupplier",
  "createSupplierCsvImport",
  "createSupplierFromPhoneContact",
  "createCustomer",
  "deleteSalesAgent",
  "deleteNetworkSource",
  "deleteProduct",
  "deleteSupplier",
  "disconnectLoginAccount",
  "enqueueSyncMutation",
  "getSokoSessionContext",
  "linkSalesAgentContact",
  "linkSupplierContact",
  "loginWithAccountPin",
  "logout",
  "logoutAll",
  "recoverAccountPin",
  "recordBetaDeviceTest",
  "recordBetaTelemetry",
  "recordPayment",
  "rejectAgentRoute",
  "replaySyncQueue",
  "replaySyncQueueItem",
  "requestAccountDeletion",
  "requestShopDeletion",
  "requestOtp",
  "revokeMcpAccessToken",
  "setAccountPin",
  "syncPhoneContacts",
  "syncSocialNetwork",
  "setConversationTyping",
  "updateBetaAccess",
  "updateSokoSessionContext",
  "updateBetaFeatureFlag",
  "updateBetaSupportTicketStatus",
  "updateCustomer",
  "updateDeviceTrust",
  "updateLaunchChecklist",
  "updateLaunchIncidentStatus",
  "updateLaunchSettings",
  "updateLogisticsStatus",
  "updateNotificationStatus",
  "updateProduct",
  "updateProductImportRow",
  "updateSalesAgent",
  "updateSupplier",
  "updateSupplierImportRow",
  "updateConversationMessage",
  "updateConversationSettings",
  "updateTaxConfig",
  "updateVerificationTier",
  "verifyAccountPin",
  "verifyExternallyApprovedOtp",
  "verifyOtp",
  "finalizeShopDeletion",
  "activateAiModel",
  "restoreShopDeletion",
  "purgeExpiredShopDeletions",
  "registerE2eeDevice",
  "revokeE2eeDevice",
  "registerPushSubscription",
  "removePushSubscription"
]);

export interface PostgresCp2StoreOptions extends Cp2StoreOptions {
  databaseUrl: string;
}

export type PostgresCp2Store = Cp2Store & {
  close: () => Promise<void>;
  flush: () => Promise<void>;
  health: () => Promise<PostgresStoreHealth>;
};

export interface PostgresStoreHealth {
  database: "postgres";
  status: "ok";
  latencyMs: number;
  latestMigration: string | null;
  syncChangeCount: number;
  phase1Parity: Array<{
    collection: string;
    relationalCount: number;
    compatibilityCount: number;
    relationalChecksum: string;
    compatibilityChecksum: string;
    ok: boolean;
  }>;
  pool: {
    idleCount: number;
    totalCount: number;
    waitingCount: number;
  };
}

const requiredMigrationFilename = "021_messaging_push_e2ee.sql";

export async function createPostgresCp2Store(
  options: PostgresCp2StoreOptions
): Promise<PostgresCp2Store> {
  const pool = new Pool(poolConfig(options.databaseUrl));
  await assertDatabaseMigrated(pool);

  const store = createCp2Store({
    ...(options.runtimeModelProvider === undefined
      ? {}
      : { runtimeModelProvider: options.runtimeModelProvider }),
    ...(options.pushNotificationSender === undefined
      ? {}
      : { pushNotificationSender: options.pushNotificationSender })
  });
  const savedSnapshot = await loadNormalizedSnapshot(pool);

  if (snapshotHasData(savedSnapshot)) {
    store.hydrateSnapshot(savedSnapshot);
    if (savedSnapshot.syncChanges.length === 0 && store.snapshot().syncChanges.length > 0) {
      await saveNormalizedSnapshot(pool, store.snapshot());
    }
  }

  let saveQueue: Promise<void> = Promise.resolve();

  function enqueueSave(): void {
    saveQueue = saveQueue
      .then(() => saveNormalizedSnapshot(pool, store.snapshot()))
      .catch((error: unknown) => {
        console.error("Failed to persist CP2 store records.", error);
      });
  }

  async function flush(): Promise<void> {
    await saveQueue;
  }

  async function close(): Promise<void> {
    await flush();
    await pool.end();
  }

  async function health(): Promise<PostgresStoreHealth> {
    const startedAt = Date.now();
    const result = await pool.query<{
      latest_migration: string | null;
      sync_change_count: string;
      otp_relational_count: string;
      otp_compatibility_count: string;
      otp_relational_checksum: string;
      otp_compatibility_checksum: string;
      sessions_relational_count: string;
      sessions_compatibility_count: string;
      sessions_relational_checksum: string;
      sessions_compatibility_checksum: string;
      user_identities_relational_count: string;
      user_identities_compatibility_count: string;
      user_identities_relational_checksum: string;
      user_identities_compatibility_checksum: string;
      oauth_sessions_relational_count: string;
      oauth_sessions_compatibility_count: string;
      oauth_sessions_relational_checksum: string;
      oauth_sessions_compatibility_checksum: string;
      account_pin_hashes_relational_count: string;
      account_pin_hashes_compatibility_count: string;
      account_pin_hashes_relational_checksum: string;
      account_pin_hashes_compatibility_checksum: string;
      device_trust_relational_count: string;
      device_trust_compatibility_count: string;
      device_trust_relational_checksum: string;
      device_trust_compatibility_checksum: string;
    }>(
      `
        select
          (
            select filename
            from soko_schema_migrations
            order by filename desc
            limit 1
          ) as latest_migration,
          (select count(*) from account_sync_changes)::text as sync_change_count,
          (select count(*) from otp_challenges)::text as otp_relational_count,
          (select count(*) from cp2_otp_challenges)::text as otp_compatibility_count,
          (select md5(coalesce(string_agg(id::text, ',' order by id::text), '')) from otp_challenges) as otp_relational_checksum,
          (select md5(coalesce(string_agg(entity_id, ',' order by entity_id), '')) from cp2_otp_challenges) as otp_compatibility_checksum,
          (select count(*) from sessions)::text as sessions_relational_count,
          (select count(*) from cp2_sessions)::text as sessions_compatibility_count,
          (select md5(coalesce(string_agg(id::text, ',' order by id::text), '')) from sessions) as sessions_relational_checksum,
          (select md5(coalesce(string_agg(entity_id, ',' order by entity_id), '')) from cp2_sessions) as sessions_compatibility_checksum,
          (select count(*) from user_identities)::text as user_identities_relational_count,
          (select count(*) from cp2_user_identities)::text as user_identities_compatibility_count,
          (select md5(coalesce(string_agg(id::text, ',' order by id::text), '')) from user_identities) as user_identities_relational_checksum,
          (select md5(coalesce(string_agg(entity_id, ',' order by entity_id), '')) from cp2_user_identities) as user_identities_compatibility_checksum,
          (select count(*) from oauth_sessions)::text as oauth_sessions_relational_count,
          (select count(*) from cp2_oauth_sessions)::text as oauth_sessions_compatibility_count,
          (select md5(coalesce(string_agg(id::text, ',' order by id::text), '')) from oauth_sessions) as oauth_sessions_relational_checksum,
          (select md5(coalesce(string_agg(entity_id, ',' order by entity_id), '')) from cp2_oauth_sessions) as oauth_sessions_compatibility_checksum,
          (select count(*) from account_pin_hashes)::text as account_pin_hashes_relational_count,
          (select count(*) from cp2_account_pin_hashes)::text as account_pin_hashes_compatibility_count,
          (select md5(coalesce(string_agg(account_id::text, ',' order by account_id::text), '')) from account_pin_hashes) as account_pin_hashes_relational_checksum,
          (select md5(coalesce(string_agg(entity_id, ',' order by entity_id), '')) from cp2_account_pin_hashes) as account_pin_hashes_compatibility_checksum,
          (select count(*) from device_trust)::text as device_trust_relational_count,
          (select count(*) from cp2_device_trust)::text as device_trust_compatibility_count,
          (
            select md5(coalesce(string_agg(
              business_id::text || ':' || user_id::text || ':' || device_id,
              ','
              order by business_id::text, user_id::text, device_id
            ), ''))
            from device_trust
          ) as device_trust_relational_checksum,
          (select md5(coalesce(string_agg(entity_id, ',' order by entity_id), '')) from cp2_device_trust) as device_trust_compatibility_checksum
      `
    );
    const row = result.rows[0];

    return {
      database: "postgres",
      status: "ok",
      latencyMs: Date.now() - startedAt,
      latestMigration: row?.latest_migration ?? null,
      syncChangeCount: Number(row?.sync_change_count ?? 0),
      phase1Parity:
        row === undefined
          ? []
          : [
              phase1Parity(
                "otp_challenges",
                row.otp_relational_count,
                row.otp_compatibility_count,
                row.otp_relational_checksum,
                row.otp_compatibility_checksum
              ),
              phase1Parity(
                "sessions",
                row.sessions_relational_count,
                row.sessions_compatibility_count,
                row.sessions_relational_checksum,
                row.sessions_compatibility_checksum
              ),
              phase1Parity(
                "user_identities",
                row.user_identities_relational_count,
                row.user_identities_compatibility_count,
                row.user_identities_relational_checksum,
                row.user_identities_compatibility_checksum
              ),
              phase1Parity(
                "oauth_sessions",
                row.oauth_sessions_relational_count,
                row.oauth_sessions_compatibility_count,
                row.oauth_sessions_relational_checksum,
                row.oauth_sessions_compatibility_checksum
              ),
              phase1Parity(
                "account_pin_hashes",
                row.account_pin_hashes_relational_count,
                row.account_pin_hashes_compatibility_count,
                row.account_pin_hashes_relational_checksum,
                row.account_pin_hashes_compatibility_checksum
              ),
              phase1Parity(
                "device_trust",
                row.device_trust_relational_count,
                row.device_trust_compatibility_count,
                row.device_trust_relational_checksum,
                row.device_trust_compatibility_checksum
              )
            ],
      pool: {
        idleCount: pool.idleCount,
        totalCount: pool.totalCount,
        waitingCount: pool.waitingCount
      }
    };
  }

  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "close") {
        return close;
      }

      if (property === "flush") {
        return flush;
      }

      if (property === "health") {
        return health;
      }

      const value = Reflect.get(target, property, receiver);

      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const result = value.apply(target, args);

        if (!mutatingMethodNames.has(property)) {
          return result;
        }

        if (isPromiseLike(result)) {
          return result.then((resolved: unknown) => {
            enqueueSave();
            return resolved;
          });
        }

        enqueueSave();
        return result;
      };
    }
  }) as PostgresCp2Store;
}

function poolConfig(databaseUrl: string): PoolConfig {
  const connectionString = normalizeDatabaseSslMode(databaseUrl);
  const sslRequired =
    !/[?&]sslmode=/i.test(connectionString) &&
    (connectionString.includes(".neon.tech") || connectionString.includes(".neon.database"));

  return {
    application_name: process.env.DB_APPLICATION_NAME ?? "soko-market-api",
    connectionString,
    connectionTimeoutMillis: positiveIntegerFromEnv("DB_CONNECTION_TIMEOUT_MS", 5000),
    idleTimeoutMillis: positiveIntegerFromEnv("DB_IDLE_TIMEOUT_MS", 30000),
    max: positiveIntegerFromEnv("DB_POOL_MAX", 5),
    query_timeout: positiveIntegerFromEnv("DB_QUERY_TIMEOUT_MS", 15000),
    statement_timeout: positiveIntegerFromEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
    ...(sslRequired ? { ssl: true } : {})
  };
}

function normalizeDatabaseSslMode(connectionString: string): string {
  return connectionString.replace(
    /([?&])sslmode=(?:prefer|require|verify-ca)(?=&|$)/gi,
    "$1sslmode=verify-full"
  );
}

async function assertDatabaseMigrated(pool: Pool): Promise<void> {
  const tableResult = await pool.query<{ exists: boolean }>(
    `
      select exists(
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'soko_schema_migrations'
      ) as exists
    `
  );

  if (tableResult.rows[0]?.exists !== true) {
    throw new Error(
      `Database migrations are not initialized. Run "pnpm db:migrate" before starting the API. Missing ${requiredMigrationFilename}.`
    );
  }

  const result = await pool.query<{ applied: boolean }>(
    "select exists(select 1 from soko_schema_migrations where filename = $1) as applied",
    [requiredMigrationFilename]
  );

  if (result.rows[0]?.applied !== true) {
    throw new Error(
      `Database migrations are not up to date. Run "pnpm db:migrate" before starting the API. Missing ${requiredMigrationFilename}.`
    );
  }
}

async function loadNormalizedSnapshot(pool: Pool): Promise<Cp2Snapshot> {
  const snapshot = emptySnapshot();

  for (const collection of normalizedCollections) {
    const result = await pool.query<{ record: SnapshotRecord }>(
      `select record from ${collection.tableName} order by entity_id`
    );
    setSnapshotCollection(
      snapshot,
      collection.key,
      result.rows.map((row) => row.record)
    );
  }

  await loadRelationalCoreSnapshot(pool, snapshot);

  return snapshot;
}

async function loadRelationalCoreSnapshot(pool: Pool, snapshot: Cp2Snapshot): Promise<void> {
  const accountsResult = await timedQuery<{
    id: string;
    primary_auth_channel: string;
    primary_auth_destination: string;
    created_at: Date;
  }>(
    pool,
    "load accounts",
    "select id, primary_auth_channel, primary_auth_destination, created_at from accounts order by id"
  );
  snapshot.accounts = accountsResult.rows.map((row) => ({
    id: row.id,
    primaryAuthChannel: row.primary_auth_channel,
    primaryAuthDestination: row.primary_auth_destination,
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["accounts"];

  const usersResult = await timedQuery<{
    id: string;
    account_id: string;
    display_name: string;
    language: string;
    created_at: Date;
  }>(
    pool,
    "load users",
    "select id, account_id, display_name, language, created_at from users order by id"
  );
  snapshot.users = usersResult.rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    displayName: row.display_name,
    language: row.language,
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["users"];

  const businessesResult = await timedQuery<{
    id: string;
    name: string;
    language: string;
    soko_id: string | null;
    created_at: Date;
  }>(
    pool,
    "load businesses",
    "select id, name, language, soko_id, created_at from businesses order by id"
  );
  snapshot.businesses = businessesResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    language: row.language,
    sokoId: row.soko_id,
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["businesses"];

  const membershipsResult = await timedQuery<{
    id: string;
    business_id: string;
    user_id: string;
    role: string;
    created_at: Date;
  }>(
    pool,
    "load memberships",
    "select id, business_id, user_id, role, created_at from business_memberships order by id"
  );
  snapshot.memberships = membershipsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    role: row.role,
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["memberships"];

  const productsResult = await timedQuery<{
    id: string;
    business_id: string;
    name: string;
    sku: string | null;
    unit: string;
    quantity: string;
    buying_price: string | null;
    selling_price: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load products",
    `
      select id, business_id, name, sku, unit, quantity, buying_price, selling_price, created_at, updated_at
      from products
      order by business_id, name, id
    `
  );
  snapshot.products = productsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    quantity: numberFromDatabase(row.quantity),
    buyingPrice: nullableNumberFromDatabase(row.buying_price),
    sellingPrice: nullableNumberFromDatabase(row.selling_price),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as Cp2Snapshot["products"];

  const customersResult = await timedQuery<{
    id: string;
    business_id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load customers",
    `
      select id, business_id, name, phone, email, notes, created_at, updated_at
      from customers
      order by business_id, name, id
    `
  );
  snapshot.customers = customersResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as Cp2Snapshot["customers"];

  const suppliersResult = await timedQuery<{
    id: string;
    business_id: string;
    name: string;
    phone: string | null;
    linked_phonebook_contact_id: string | null;
    linked_phonebook_contact_name: string | null;
    email: string | null;
    notes: string | null;
    sales_agent_count: number;
    purchase_receipt_count: number;
    last_purchase_date: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load suppliers",
    `
      select id, business_id, name, phone, linked_phonebook_contact_id, linked_phonebook_contact_name,
             email, notes, sales_agent_count, purchase_receipt_count, last_purchase_date, created_at, updated_at
      from suppliers
      order by business_id, name, id
    `
  );
  snapshot.suppliers = suppliersResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    phone: row.phone,
    linkedPhonebookContactId: row.linked_phonebook_contact_id,
    linkedPhonebookContactName: row.linked_phonebook_contact_name,
    email: row.email,
    notes: row.notes,
    salesAgentCount: row.sales_agent_count,
    purchaseReceiptCount: row.purchase_receipt_count,
    lastPurchaseDate:
      row.last_purchase_date === null ? null : timestampToIso(row.last_purchase_date),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as Cp2Snapshot["suppliers"];

  const salesAgentsResult = await timedQuery<{
    id: string;
    business_id: string;
    supplier_id: string;
    supplier_name: string;
    name: string;
    phone: string | null;
    linked_phonebook_contact_id: string | null;
    linked_phonebook_contact_name: string | null;
    notes: string | null;
    receipts_handled: number;
    last_transaction_date: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load sales agents",
    `
      select id, business_id, supplier_id, supplier_name, name, phone, linked_phonebook_contact_id,
             linked_phonebook_contact_name, notes, receipts_handled, last_transaction_date, created_at, updated_at
      from sales_agents
      order by business_id, supplier_id, name, id
    `
  );
  snapshot.salesAgents = salesAgentsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    name: row.name,
    phone: row.phone,
    linkedPhonebookContactId: row.linked_phonebook_contact_id,
    linkedPhonebookContactName: row.linked_phonebook_contact_name,
    notes: row.notes,
    receiptsHandled: row.receipts_handled,
    lastTransactionDate:
      row.last_transaction_date === null ? null : timestampToIso(row.last_transaction_date),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as Cp2Snapshot["salesAgents"];

  const supplierContactLinksResult = await timedQuery<{
    id: string;
    business_id: string;
    link_type: string;
    supplier_id: string | null;
    sales_agent_id: string | null;
    network_node_id: string;
    contact_name: string;
    linked_at: Date;
  }>(
    pool,
    "load supplier contact links",
    `
      select id, business_id, link_type, supplier_id, sales_agent_id, network_node_id, contact_name, linked_at
      from supplier_contact_links
      order by business_id, linked_at, id
    `
  );
  snapshot.supplierContactLinks = supplierContactLinksResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    linkType: row.link_type,
    supplierId: row.supplier_id,
    salesAgentId: row.sales_agent_id,
    networkNodeId: row.network_node_id,
    contactName: row.contact_name,
    linkedAt: timestampToIso(row.linked_at)
  })) as Cp2Snapshot["supplierContactLinks"];

  const ocrJobsResult = await timedQuery<{
    id: string;
    business_id: string;
    tenant_id: string;
    shop_id: string;
    uploaded_by: string;
    status: string;
    source_file_name: string;
    content_type: string;
    engine: string;
    engine_version: string;
    model_version: string;
    profile: string;
    fallback_used: boolean;
    language_hints: unknown;
    full_text: string;
    average_confidence: string;
    warnings: unknown;
    field_evidence: unknown;
    structured_extraction: unknown;
    contact_matching_result: unknown;
    supplier_candidates: unknown;
    sales_agent_candidates: unknown;
    supplier_name: string | null;
    sales_agent_name: string | null;
    phone: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load receipt OCR jobs",
    `
      select id, business_id, tenant_id, shop_id, uploaded_by, status, source_file_name, content_type,
             engine, engine_version, model_version, profile, fallback_used, language_hints, full_text,
             average_confidence, warnings, field_evidence, structured_extraction, contact_matching_result,
             supplier_candidates, sales_agent_candidates, supplier_name, sales_agent_name, phone, created_at, updated_at
      from receipt_ocr_jobs
      order by business_id, updated_at, id
    `
  );
  snapshot.receiptOCRJobs = ocrJobsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    tenantId: row.tenant_id,
    shopId: row.shop_id,
    uploadedBy: row.uploaded_by,
    status: row.status,
    sourceFileName: row.source_file_name,
    contentType: row.content_type,
    engine: row.engine,
    engineVersion: row.engine_version,
    modelVersion: row.model_version,
    profile: row.profile,
    fallbackUsed: row.fallback_used,
    languageHints: row.language_hints,
    fullText: row.full_text,
    averageConfidence: numberFromDatabase(row.average_confidence),
    warnings: row.warnings,
    fieldEvidence: row.field_evidence,
    structuredExtraction: row.structured_extraction,
    contactMatchingResult: row.contact_matching_result,
    supplierCandidates: row.supplier_candidates,
    salesAgentCandidates: row.sales_agent_candidates,
    supplierName: row.supplier_name,
    salesAgentName: row.sales_agent_name,
    phone: row.phone,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as Cp2Snapshot["receiptOCRJobs"];

  const purchaseReceiptsResult = await timedQuery<{
    id: string;
    business_id: string;
    supplier_id: string;
    supplier_name: string;
    sales_agent_id: string | null;
    sales_agent_name: string | null;
    receipt_date: Date;
    total: string;
    source_file_name: string | null;
    ocr_job_id: string | null;
    image_stored: boolean;
    created_at: Date;
  }>(
    pool,
    "load purchase receipts",
    `
      select id, business_id, supplier_id, supplier_name, sales_agent_id, sales_agent_name,
             receipt_date, total, source_file_name, ocr_job_id, image_stored, created_at
      from purchase_receipts
      order by business_id, receipt_date, id
    `
  );
  snapshot.purchaseReceipts = purchaseReceiptsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    salesAgentId: row.sales_agent_id,
    salesAgentName: row.sales_agent_name,
    receiptDate: timestampToIso(row.receipt_date),
    total: numberFromDatabase(row.total),
    sourceFileName: row.source_file_name,
    ocrJobId: row.ocr_job_id,
    imageStored: row.image_stored,
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["purchaseReceipts"];

  const receiptLineItemsResult = await timedQuery<{
    id: string;
    receipt_id: string;
    name: string;
    quantity: string;
    unit_price: string;
    total: string;
  }>(
    pool,
    "load receipt line items",
    "select id, receipt_id, name, quantity, unit_price, total from receipt_line_items order by receipt_id, id"
  );
  snapshot.receiptLineItems = receiptLineItemsResult.rows.map((row) => ({
    id: row.id,
    receiptId: row.receipt_id,
    name: row.name,
    quantity: numberFromDatabase(row.quantity),
    unitPrice: numberFromDatabase(row.unit_price),
    total: numberFromDatabase(row.total)
  })) as Cp2Snapshot["receiptLineItems"];

  const invoicesResult = await timedQuery<{
    id: string;
    business_id: string;
    invoice_number: string;
    status: string;
    customer_id: string | null;
    customer_name: string | null;
    subtotal: string;
    tax_rate: string;
    tax_total: string;
    total: string;
    confirmed_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load invoices",
    `
      select id, business_id, invoice_number, status, customer_id, customer_name,
             subtotal, tax_rate, tax_total, total, confirmed_at, created_at, updated_at
      from invoices
      order by business_id, created_at, id
    `
  );
  const invoiceItemsResult = await timedQuery<{
    id: string;
    invoice_id: string;
    product_id: string;
    product_name: string;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>(
    pool,
    "load invoice items",
    `
      select id, invoice_id, product_id, product_name, quantity, unit_price, line_total
      from invoice_items
      order by invoice_id, id
    `
  );
  const itemsByInvoiceId = new Map<string, SnapshotRecord[]>();

  for (const row of invoiceItemsResult.rows) {
    const item = {
      id: row.id,
      invoiceId: row.invoice_id,
      productId: row.product_id,
      productName: row.product_name,
      quantity: numberFromDatabase(row.quantity),
      unitPrice: numberFromDatabase(row.unit_price),
      lineTotal: numberFromDatabase(row.line_total)
    };
    itemsByInvoiceId.set(row.invoice_id, [...(itemsByInvoiceId.get(row.invoice_id) ?? []), item]);
  }

  snapshot.invoices = invoicesResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    customerId: row.customer_id,
    customerName: row.customer_name,
    items: itemsByInvoiceId.get(row.id) ?? [],
    subtotal: numberFromDatabase(row.subtotal),
    taxRate: numberFromDatabase(row.tax_rate),
    taxTotal: numberFromDatabase(row.tax_total),
    total: numberFromDatabase(row.total),
    confirmedAt: row.confirmed_at === null ? null : timestampToIso(row.confirmed_at),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as unknown as Cp2Snapshot["invoices"];

  const paymentsResult = await timedQuery<{
    id: string;
    business_id: string;
    invoice_id: string;
    customer_id: string | null;
    method: string;
    amount: string;
    reference: string | null;
    note: string | null;
    actor_id: string;
    created_at: Date;
  }>(
    pool,
    "load payments",
    `
      select id, business_id, invoice_id, customer_id, method, amount, reference, note, actor_id, created_at
      from payments
      order by business_id, created_at, id
    `
  );
  snapshot.payments = paymentsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    customerId: row.customer_id,
    method: row.method,
    amount: numberFromDatabase(row.amount),
    reference: row.reference,
    note: row.note,
    actorId: row.actor_id,
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["payments"];

  const sessionsResult = await timedQuery<{
    id: string;
    account_id: string;
    user_id: string;
    expires_at: Date;
    pin_verified_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    pool,
    "load sessions",
    "select id, account_id, user_id, expires_at, pin_verified_at, revoked_at, created_at from sessions order by created_at, id"
  );
  snapshot.sessions = sessionsResult.rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    userId: row.user_id,
    expiresAt: timestampToIso(row.expires_at),
    pinVerifiedAt: row.pin_verified_at === null ? null : timestampToIso(row.pin_verified_at),
    revokedAt: row.revoked_at === null ? null : timestampToIso(row.revoked_at),
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["sessions"];

  const otpChallengesResult = await timedQuery<{
    id: string;
    channel: string;
    destination: string;
    code_hash: string;
    attempts: number;
    max_attempts: number;
    expires_at: Date;
    verified_at: Date | null;
    created_at: Date;
  }>(
    pool,
    "load OTP challenges",
    `
      select id, channel, destination, code_hash, attempts, max_attempts, expires_at, verified_at, created_at
      from otp_challenges
      order by created_at, id
    `
  );
  snapshot.otpChallenges = otpChallengesResult.rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    destination: row.destination,
    codeHash: row.code_hash,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    expiresAt: timestampToIso(row.expires_at),
    verifiedAt: row.verified_at === null ? null : timestampToIso(row.verified_at),
    createdAt: timestampToIso(row.created_at)
  })) as Cp2Snapshot["otpChallenges"];

  const userIdentitiesResult = await timedQuery<{
    id: string;
    account_id: string;
    user_id: string;
    provider_id: string;
    provider_subject: string;
    email: string | null;
    display_name: string | null;
    encrypted_access_token: string | null;
    encrypted_refresh_token: string | null;
    encrypted_id_token: string | null;
    token_type: string | null;
    token_expires_at: Date | null;
    scope: string | null;
    linked_at: Date;
    updated_at: Date;
  }>(
    pool,
    "load user identities",
    `
      select id, account_id, user_id, provider_id, provider_subject, email, display_name,
             encrypted_access_token, encrypted_refresh_token, encrypted_id_token, token_type,
             token_expires_at, scope, linked_at, updated_at
      from user_identities
      order by linked_at, id
    `
  );
  snapshot.userIdentities = userIdentitiesResult.rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    userId: row.user_id,
    provider: row.provider_id,
    providerSubject: row.provider_subject,
    email: row.email,
    displayName: row.display_name,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token,
    encryptedIdToken: row.encrypted_id_token,
    tokenType: row.token_type,
    tokenExpiresAt: row.token_expires_at === null ? null : timestampToIso(row.token_expires_at),
    scope: row.scope,
    linkedAt: timestampToIso(row.linked_at),
    updatedAt: timestampToIso(row.updated_at)
  })) as unknown as Cp2Snapshot["userIdentities"];

  const oauthSessionsResult = await timedQuery<{
    id: string;
    provider_id: string;
    account_id: string | null;
    state_hash: string;
    csrf_hash: string;
    code_challenge: string;
    encrypted_code_verifier: string;
    redirect_uri: string;
    expires_at: Date;
    completed_at: Date | null;
    created_at: Date;
  }>(
    pool,
    "load OAuth sessions",
    `
      select id, provider_id, account_id, state_hash, csrf_hash, code_challenge,
             encrypted_code_verifier, redirect_uri, expires_at, completed_at, created_at
      from oauth_sessions
      order by created_at, id
    `
  );
  snapshot.oauthSessions = oauthSessionsResult.rows.map((row) => ({
    id: row.id,
    provider: row.provider_id,
    accountId: row.account_id,
    stateHash: row.state_hash,
    csrfHash: row.csrf_hash,
    codeChallenge: row.code_challenge,
    codeVerifier: row.encrypted_code_verifier,
    redirectUri: row.redirect_uri,
    expiresAt: timestampToIso(row.expires_at),
    completedAt: row.completed_at === null ? null : timestampToIso(row.completed_at),
    createdAt: timestampToIso(row.created_at)
  })) as unknown as Cp2Snapshot["oauthSessions"];

  const accountPinHashesResult = await timedQuery<{
    account_id: string;
    pin_hash: string;
  }>(
    pool,
    "load account PIN hashes",
    "select account_id, pin_hash from account_pin_hashes order by account_id"
  );
  snapshot.accountPinHashes = accountPinHashesResult.rows.map((row) => ({
    accountId: row.account_id,
    pinHash: row.pin_hash
  }));

  const deviceTrustResult = await timedQuery<{
    business_id: string;
    user_id: string;
    device_id: string;
    level: string;
    reason: string | null;
    updated_by: string | null;
    updated_by_type: "user" | "system" | "service";
    updated_at: Date;
  }>(
    pool,
    "load device trust",
    `
      select business_id, user_id, device_id, level, reason,
             updated_by, updated_by_type, updated_at
      from device_trust
      order by business_id, user_id, device_id
    `
  );
  snapshot.deviceTrust = deviceTrustResult.rows.map((row) => ({
    businessId: row.business_id,
    userId: row.user_id,
    deviceId: row.device_id,
    level: row.level,
    reason: row.reason,
    updatedBy: row.updated_by ?? row.updated_by_type,
    updatedAt: timestampToIso(row.updated_at)
  })) as Cp2Snapshot["deviceTrust"];

  const syncChangesResult = await timedQuery<{
    account_id: string;
    sequence: string;
    cursor: string;
    collection: Cp2Snapshot["syncChanges"][number]["collection"];
    entity_id: string;
    operation: Cp2Snapshot["syncChanges"][number]["operation"];
    shop_id: string | null;
    entity: unknown | null;
    changed_at: Date;
    tombstone_expires_at: Date | null;
  }>(
    pool,
    "load account sync changes",
    `
      select account_id, sequence, cursor, collection, entity_id, operation,
             shop_id, entity, changed_at, tombstone_expires_at
      from account_sync_changes
      order by account_id, sequence
    `
  );
  snapshot.syncChanges = syncChangesResult.rows.map((row) => ({
    accountId: row.account_id,
    sequence: Number(row.sequence),
    cursor: row.cursor,
    collection: row.collection,
    entityId: row.entity_id,
    operation: row.operation,
    shopId: row.shop_id,
    entity: row.entity,
    changedAt: timestampToIso(row.changed_at),
    tombstoneExpiresAt:
      row.tombstone_expires_at === null ? null : timestampToIso(row.tombstone_expires_at)
  }));

  const mcpAccessTokensResult = await timedQuery<{
    id: string;
    account_id: string;
    user_id: string;
    session_id: string;
    token_hash: string;
    name: string;
    scopes: Array<"mcp:read" | "mcp:act">;
    shop_id: string | null;
    created_at: Date;
    expires_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
  }>(
    pool,
    "load MCP access tokens",
    `
      select id, account_id, user_id, session_id, token_hash, name, scopes, shop_id,
             created_at, expires_at, last_used_at, revoked_at
      from mcp_access_tokens
      order by account_id, created_at, id
    `
  );
  snapshot.mcpAccessTokens = mcpAccessTokensResult.rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    userId: row.user_id,
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    name: row.name,
    scopes: row.scopes,
    shopId: row.shop_id,
    createdAt: timestampToIso(row.created_at),
    expiresAt: timestampToIso(row.expires_at),
    lastUsedAt: row.last_used_at === null ? null : timestampToIso(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : timestampToIso(row.revoked_at)
  }));
}

async function saveNormalizedSnapshot(pool: Pool, snapshot: Cp2Snapshot): Promise<void> {
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('soko.cp2.normalized_store'))");

    for (const collection of normalizedCollections) {
      await saveCollectionRecords(
        client,
        collection,
        getSnapshotCollection(snapshot, collection.key)
      );
    }

    await saveRelationalCoreRecords(client, snapshot);

    await client.query("commit");
    logSlowQuery("persist CP2 relational store", startedAt);
  } catch (error) {
    await client.query("rollback").catch((rollbackError: unknown) => {
      console.error("Failed to roll back CP2 normalized persistence transaction.", rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function saveCollectionRecords(
  client: PoolClient,
  collection: NormalizedCollection,
  records: SnapshotRecord[]
): Promise<void> {
  const desiredIds = records.map((record) => recordEntityId(collection.key, record));
  const existingResult = await client.query<{ entity_id: string }>(
    `select entity_id from ${collection.tableName}`
  );
  const desiredIdSet = new Set(desiredIds);
  const removedIds = existingResult.rows
    .map((row) => row.entity_id)
    .filter((entityId) => !desiredIdSet.has(entityId));

  if (removedIds.length > 0) {
    await client.query(`delete from ${collection.tableName} where entity_id = any($1::text[])`, [
      removedIds
    ]);
  }

  for (const record of records) {
    await client.query(
      `
        insert into ${collection.tableName}
          (entity_id, business_id, account_id, user_id, parent_id, record, updated_at)
        values ($1, $2, $3, $4, $5, $6::jsonb, now())
        on conflict (entity_id) do update set
          business_id = excluded.business_id,
          account_id = excluded.account_id,
          user_id = excluded.user_id,
          parent_id = excluded.parent_id,
          record = excluded.record,
          updated_at = now()
      `,
      [
        recordEntityId(collection.key, record),
        firstText(record, ["businessId"]),
        firstText(record, ["accountId"]),
        firstText(record, ["userId", "ownerUserId", "actorId"]),
        firstText(record, ["invoiceId", "importJobId", "sourceId", "eventId", "permissionId"]),
        JSON.stringify(record)
      ]
    );
  }
}

async function saveRelationalCoreRecords(client: PoolClient, snapshot: Cp2Snapshot): Promise<void> {
  const now = new Date().toISOString();

  await saveShopDeletionArchives(client, snapshotRecords(snapshot.accountDeletionRequests));

  await deleteMissingRows(client, "mcp_access_tokens", snapshotRecords(snapshot.mcpAccessTokens));
  await deleteMissingRows(client, "receipt_line_items", snapshotRecords(snapshot.receiptLineItems));
  await deleteMissingRows(client, "payments", snapshotRecords(snapshot.payments));
  await deleteMissingInvoiceRows(client, snapshotRecords(snapshot.invoices));
  await deleteMissingRows(client, "purchase_receipts", snapshotRecords(snapshot.purchaseReceipts));
  await deleteMissingRows(client, "receipt_ocr_jobs", snapshotRecords(snapshot.receiptOCRJobs));
  await deleteMissingRows(
    client,
    "supplier_contact_links",
    snapshotRecords(snapshot.supplierContactLinks)
  );
  await deleteMissingDeviceTrustRows(client, snapshotRecords(snapshot.deviceTrust));
  await deleteMissingRows(client, "oauth_sessions", snapshotRecords(snapshot.oauthSessions));
  await deleteMissingRows(client, "auth_accounts", snapshotRecords(snapshot.userIdentities));
  await deleteMissingRows(
    client,
    "verification_challenges",
    snapshotRecords(snapshot.otpChallenges)
  );
  await deleteMissingRows(client, "user_identities", snapshotRecords(snapshot.userIdentities));
  await deleteMissingRows(client, "otp_challenges", snapshotRecords(snapshot.otpChallenges));
  await deleteMissingAccountPinHashes(client, snapshotRecords(snapshot.accountPinHashes));
  await deleteMissingRows(client, "sales_agents", snapshotRecords(snapshot.salesAgents));
  await deleteMissingRows(client, "suppliers", snapshotRecords(snapshot.suppliers));
  await deleteMissingRows(client, "sessions", snapshotRecords(snapshot.sessions));
  await deleteMissingRows(client, "business_memberships", snapshotRecords(snapshot.memberships));

  for (const record of snapshotRecords(snapshot.accounts)) {
    await client.query(
      `
        insert into accounts (id, primary_auth_channel, primary_auth_destination, created_at)
        values ($1, $2, $3, $4)
        on conflict (id) do update set
          primary_auth_channel = excluded.primary_auth_channel,
          primary_auth_destination = excluded.primary_auth_destination
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "primaryAuthChannel"),
        requiredText(record, "primaryAuthDestination"),
        now
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.users)) {
    await client.query(
      `
        insert into users (id, account_id, display_name, language, created_at)
        values ($1, $2, $3, $4, $5)
        on conflict (id) do update set
          account_id = excluded.account_id,
          display_name = excluded.display_name,
          language = excluded.language
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "accountId"),
        requiredText(record, "displayName"),
        requiredText(record, "language"),
        now
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.businesses)) {
    await client.query(
      `
        insert into businesses (id, name, language, soko_id, created_at)
        values ($1, $2, $3, $4, $5)
        on conflict (id) do update set
          name = excluded.name,
          language = excluded.language,
          soko_id = excluded.soko_id
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "name"),
        requiredText(record, "language"),
        firstText(record, ["sokoId"]),
        now
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.memberships)) {
    await client.query(
      `
        insert into business_memberships (id, business_id, user_id, role, created_at)
        values ($1, $2, $3, $4, $5)
        on conflict (id) do update set
          business_id = excluded.business_id,
          user_id = excluded.user_id,
          role = excluded.role
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "userId"),
        requiredText(record, "role"),
        now
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.products)) {
    await client.query(
      `
        insert into products
          (id, business_id, name, sku, unit, quantity, buying_price, selling_price, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (id) do update set
          business_id = excluded.business_id,
          name = excluded.name,
          sku = excluded.sku,
          unit = excluded.unit,
          quantity = excluded.quantity,
          buying_price = excluded.buying_price,
          selling_price = excluded.selling_price,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "name"),
        firstText(record, ["sku"]),
        requiredText(record, "unit"),
        record.quantity,
        record.buyingPrice ?? null,
        record.sellingPrice ?? null,
        requiredText(record, "createdAt"),
        requiredText(record, "updatedAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.customers)) {
    await client.query(
      `
        insert into customers (id, business_id, name, phone, email, notes, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update set
          business_id = excluded.business_id,
          name = excluded.name,
          phone = excluded.phone,
          email = excluded.email,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "name"),
        firstText(record, ["phone"]),
        firstText(record, ["email"]),
        firstText(record, ["notes"]),
        requiredText(record, "createdAt"),
        requiredText(record, "updatedAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.suppliers)) {
    await client.query(
      `
        insert into suppliers (
          id, business_id, name, phone, linked_phonebook_contact_id, linked_phonebook_contact_name,
          email, notes, sales_agent_count, purchase_receipt_count, last_purchase_date, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id) do update set
          business_id = excluded.business_id,
          name = excluded.name,
          phone = excluded.phone,
          linked_phonebook_contact_id = excluded.linked_phonebook_contact_id,
          linked_phonebook_contact_name = excluded.linked_phonebook_contact_name,
          email = excluded.email,
          notes = excluded.notes,
          sales_agent_count = excluded.sales_agent_count,
          purchase_receipt_count = excluded.purchase_receipt_count,
          last_purchase_date = excluded.last_purchase_date,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "name"),
        firstText(record, ["phone"]),
        firstText(record, ["linkedPhonebookContactId"]),
        firstText(record, ["linkedPhonebookContactName"]),
        firstText(record, ["email"]),
        firstText(record, ["notes"]),
        record.salesAgentCount ?? 0,
        record.purchaseReceiptCount ?? 0,
        firstText(record, ["lastPurchaseDate"]),
        requiredText(record, "createdAt"),
        requiredText(record, "updatedAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.salesAgents)) {
    await client.query(
      `
        insert into sales_agents (
          id, business_id, supplier_id, supplier_name, name, phone, linked_phonebook_contact_id,
          linked_phonebook_contact_name, notes, receipts_handled, last_transaction_date, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id) do update set
          supplier_name = excluded.supplier_name,
          name = excluded.name,
          phone = excluded.phone,
          linked_phonebook_contact_id = excluded.linked_phonebook_contact_id,
          linked_phonebook_contact_name = excluded.linked_phonebook_contact_name,
          notes = excluded.notes,
          receipts_handled = excluded.receipts_handled,
          last_transaction_date = excluded.last_transaction_date,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "supplierId"),
        requiredText(record, "supplierName"),
        requiredText(record, "name"),
        firstText(record, ["phone"]),
        firstText(record, ["linkedPhonebookContactId"]),
        firstText(record, ["linkedPhonebookContactName"]),
        firstText(record, ["notes"]),
        record.receiptsHandled ?? 0,
        firstText(record, ["lastTransactionDate"]),
        requiredText(record, "createdAt"),
        requiredText(record, "updatedAt")
      ]
    );
  }

  await savePhase1AuthSecurityRecords(client, snapshot);

  for (const record of snapshotRecords(snapshot.supplierContactLinks)) {
    await client.query(
      `
        insert into supplier_contact_links (
          id, business_id, link_type, supplier_id, sales_agent_id, network_node_id, contact_name, linked_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update set
          business_id = excluded.business_id,
          link_type = excluded.link_type,
          supplier_id = excluded.supplier_id,
          sales_agent_id = excluded.sales_agent_id,
          network_node_id = excluded.network_node_id,
          contact_name = excluded.contact_name,
          linked_at = excluded.linked_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "linkType"),
        firstText(record, ["supplierId"]),
        firstText(record, ["salesAgentId"]),
        requiredText(record, "networkNodeId"),
        requiredText(record, "contactName"),
        requiredText(record, "linkedAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.receiptOCRJobs)) {
    await client.query(
      `
        insert into receipt_ocr_jobs (
          id, business_id, tenant_id, shop_id, uploaded_by, status, source_file_name, content_type,
          engine, engine_version, model_version, profile, fallback_used, language_hints, full_text,
          average_confidence, warnings, field_evidence, structured_extraction, contact_matching_result,
          supplier_candidates, sales_agent_candidates, supplier_name, sales_agent_name, phone, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb, $23, $24, $25, now())
        on conflict (id) do update set
          status = excluded.status,
          full_text = excluded.full_text,
          average_confidence = excluded.average_confidence,
          warnings = excluded.warnings,
          field_evidence = excluded.field_evidence,
          structured_extraction = excluded.structured_extraction,
          contact_matching_result = excluded.contact_matching_result,
          supplier_candidates = excluded.supplier_candidates,
          sales_agent_candidates = excluded.sales_agent_candidates,
          supplier_name = excluded.supplier_name,
          sales_agent_name = excluded.sales_agent_name,
          phone = excluded.phone,
          updated_at = now()
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "tenantId"),
        requiredText(record, "shopId"),
        requiredText(record, "uploadedBy"),
        requiredText(record, "status"),
        requiredText(record, "sourceFileName"),
        requiredText(record, "contentType"),
        requiredText(record, "engine"),
        requiredText(record, "engineVersion"),
        requiredText(record, "modelVersion"),
        requiredText(record, "profile"),
        record.fallbackUsed === true,
        JSON.stringify(record.languageHints ?? []),
        firstText(record, ["fullText"]) ?? "",
        record.averageConfidence ?? 0,
        JSON.stringify(record.warnings ?? []),
        JSON.stringify(record.fieldEvidence ?? []),
        JSON.stringify(record.structuredExtraction ?? {}),
        JSON.stringify(record.contactMatchingResult ?? {}),
        JSON.stringify(record.supplierCandidates ?? []),
        JSON.stringify(record.salesAgentCandidates ?? []),
        firstText(record, ["supplierName"]),
        firstText(record, ["salesAgentName"]),
        firstText(record, ["phone"])
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.purchaseReceipts)) {
    await client.query(
      `
        insert into purchase_receipts (
          id, business_id, supplier_id, supplier_name, sales_agent_id, sales_agent_name,
          receipt_date, total, source_file_name, ocr_job_id, image_stored, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update set
          supplier_id = excluded.supplier_id,
          supplier_name = excluded.supplier_name,
          sales_agent_id = excluded.sales_agent_id,
          sales_agent_name = excluded.sales_agent_name,
          receipt_date = excluded.receipt_date,
          total = excluded.total,
          source_file_name = excluded.source_file_name,
          ocr_job_id = excluded.ocr_job_id,
          image_stored = excluded.image_stored
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "supplierId"),
        requiredText(record, "supplierName"),
        firstText(record, ["salesAgentId"]),
        firstText(record, ["salesAgentName"]),
        requiredText(record, "receiptDate"),
        record.total,
        firstText(record, ["sourceFileName"]),
        firstText(record, ["ocrJobId"]),
        record.imageStored === true,
        requiredText(record, "createdAt")
      ]
    );
  }

  await replaceReceiptLineItems(client, snapshotRecords(snapshot.receiptLineItems));
  await saveInvoicesAndItems(client, snapshotRecords(snapshot.invoices));

  for (const record of snapshotRecords(snapshot.payments)) {
    await client.query(
      `
        insert into payments (
          id, business_id, invoice_id, customer_id, method, amount, reference, note, actor_id, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (id) do update set
          method = excluded.method,
          amount = excluded.amount,
          reference = excluded.reference,
          note = excluded.note
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "invoiceId"),
        firstText(record, ["customerId"]),
        requiredText(record, "method"),
        record.amount,
        firstText(record, ["reference"]),
        firstText(record, ["note"]),
        requiredText(record, "actorId"),
        requiredText(record, "createdAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.sessions)) {
    await client.query(
      `
        insert into sessions (id, account_id, user_id, expires_at, pin_verified_at, revoked_at, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update set
          expires_at = excluded.expires_at,
          pin_verified_at = excluded.pin_verified_at,
          revoked_at = excluded.revoked_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "accountId"),
        requiredText(record, "userId"),
        requiredText(record, "expiresAt"),
        firstText(record, ["pinVerifiedAt"]),
        firstText(record, ["revokedAt"]),
        requiredText(record, "createdAt")
      ]
    );
  }

  for (const token of snapshot.mcpAccessTokens) {
    await client.query(
      `
        insert into mcp_access_tokens (
          id, account_id, user_id, session_id, token_hash, name, scopes, shop_id,
          created_at, expires_at, last_used_at, revoked_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12)
        on conflict (id) do update set
          token_hash = excluded.token_hash,
          name = excluded.name,
          scopes = excluded.scopes,
          shop_id = excluded.shop_id,
          expires_at = excluded.expires_at,
          last_used_at = excluded.last_used_at,
          revoked_at = excluded.revoked_at
      `,
      [
        token.id,
        token.accountId,
        token.userId,
        token.sessionId,
        token.tokenHash,
        token.name,
        token.scopes,
        token.shopId,
        token.createdAt,
        token.expiresAt,
        token.lastUsedAt,
        token.revokedAt
      ]
    );
  }

  for (const change of snapshot.syncChanges) {
    await client.query(
      `
        insert into account_sync_changes (
          account_id, sequence, cursor, collection, entity_id, operation,
          shop_id, entity, changed_at, tombstone_expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
        on conflict (account_id, sequence) do update set
          cursor = excluded.cursor,
          collection = excluded.collection,
          entity_id = excluded.entity_id,
          operation = excluded.operation,
          shop_id = excluded.shop_id,
          entity = excluded.entity,
          changed_at = excluded.changed_at,
          tombstone_expires_at = excluded.tombstone_expires_at
      `,
      [
        change.accountId,
        change.sequence,
        change.cursor,
        change.collection,
        change.entityId,
        change.operation,
        change.shopId,
        change.entity === null ? null : JSON.stringify(change.entity),
        change.changedAt,
        change.tombstoneExpiresAt
      ]
    );
  }
}

async function saveShopDeletionArchives(
  client: PoolClient,
  records: SnapshotRecord[]
): Promise<void> {
  const archived = records.filter((record) =>
    ["QUARANTINED", "RESTORED", "PURGED", "FAILED", "PARTIALLY_FAILED"].includes(
      requiredText(record, "status")
    )
  );

  for (const record of archived) {
    const status = requiredText(record, "status");
    await client.query(
      `
        insert into shop_deletion_archives (
          request_id, business_id, account_id, status, restore_until,
          archive_key, checksum, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, null, null, $6, $7)
        on conflict (request_id) do update set
          status = excluded.status,
          restore_until = excluded.restore_until,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "accountId"),
        status === "PARTIALLY_FAILED" ? "FAILED" : status,
        requiredText(record, "anonymizeAfter"),
        requiredText(record, "requestedAt"),
        firstText(record, ["completedAt"]) ?? requiredText(record, "requestedAt")
      ]
    );
  }
}

async function savePhase1AuthSecurityRecords(
  client: PoolClient,
  snapshot: Cp2Snapshot
): Promise<void> {
  await saveIdentityProviders(client, snapshot);

  for (const record of snapshotRecords(snapshot.otpChallenges)) {
    await client.query(
      `
        insert into otp_challenges (
          id, channel, destination, code_hash, attempts, max_attempts, expires_at, verified_at, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do update set
          channel = excluded.channel,
          destination = excluded.destination,
          code_hash = excluded.code_hash,
          attempts = excluded.attempts,
          max_attempts = excluded.max_attempts,
          expires_at = excluded.expires_at,
          verified_at = excluded.verified_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "channel"),
        requiredText(record, "destination"),
        requiredText(record, "codeHash"),
        record.attempts ?? 0,
        record.maxAttempts ?? 5,
        requiredText(record, "expiresAt"),
        firstText(record, ["verifiedAt"]),
        requiredText(record, "createdAt")
      ]
    );

    await client.query(
      `
        insert into verification_challenges (
          id, channel, destination, purpose, code_hash, attempts, max_attempts,
          status, expires_at, verified_at, created_at, updated_at
        )
        values (
          $1, $2, $3, 'login', $4, $5, $6,
          case
            when $8::timestamptz is not null then 'verified'
            when $7::timestamptz <= now() then 'expired'
            when $5::integer >= $6::integer then 'locked'
            else 'pending'
          end,
          $7, $8, $9, coalesce($8::timestamptz, $9::timestamptz)
        )
        on conflict (id) do update set
          channel = excluded.channel,
          destination = excluded.destination,
          code_hash = excluded.code_hash,
          attempts = excluded.attempts,
          max_attempts = excluded.max_attempts,
          status = excluded.status,
          expires_at = excluded.expires_at,
          verified_at = excluded.verified_at,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "channel"),
        requiredText(record, "destination"),
        requiredText(record, "codeHash"),
        record.attempts ?? 0,
        record.maxAttempts ?? 5,
        requiredText(record, "expiresAt"),
        firstText(record, ["verifiedAt"]),
        requiredText(record, "createdAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.userIdentities)) {
    await client.query(
      `
        insert into user_identities (
          id, account_id, user_id, provider_id, provider_subject, email, display_name,
          encrypted_access_token, encrypted_refresh_token, encrypted_id_token, token_type,
          token_expires_at, scope, linked_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        on conflict (id) do update set
          account_id = excluded.account_id,
          user_id = excluded.user_id,
          provider_id = excluded.provider_id,
          provider_subject = excluded.provider_subject,
          email = excluded.email,
          display_name = excluded.display_name,
          encrypted_access_token = excluded.encrypted_access_token,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          encrypted_id_token = excluded.encrypted_id_token,
          token_type = excluded.token_type,
          token_expires_at = excluded.token_expires_at,
          scope = excluded.scope,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "accountId"),
        requiredText(record, "userId"),
        requiredText(record, "provider"),
        requiredText(record, "providerSubject"),
        firstText(record, ["email"]),
        firstText(record, ["displayName"]),
        firstText(record, ["encryptedAccessToken"]),
        firstText(record, ["encryptedRefreshToken"]),
        firstText(record, ["encryptedIdToken"]),
        firstText(record, ["tokenType"]),
        firstText(record, ["tokenExpiresAt"]),
        firstText(record, ["scope"]),
        requiredText(record, "linkedAt"),
        firstText(record, ["updatedAt"]) ?? requiredText(record, "linkedAt")
      ]
    );

    await client.query(
      `
        insert into auth_accounts (
          id, account_id, user_id, provider_id, provider_subject, email, display_name,
          linked_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (id) do update set
          account_id = excluded.account_id,
          user_id = excluded.user_id,
          provider_id = excluded.provider_id,
          provider_subject = excluded.provider_subject,
          email = excluded.email,
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "accountId"),
        requiredText(record, "userId"),
        requiredText(record, "provider"),
        requiredText(record, "providerSubject"),
        firstText(record, ["email"]),
        firstText(record, ["displayName"]),
        requiredText(record, "linkedAt"),
        firstText(record, ["updatedAt"]) ?? requiredText(record, "linkedAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.oauthSessions)) {
    await client.query(
      `
        insert into oauth_sessions (
          id, provider_id, account_id, state_hash, csrf_hash, code_challenge,
          encrypted_code_verifier, redirect_uri, expires_at, completed_at, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (id) do update set
          provider_id = excluded.provider_id,
          account_id = excluded.account_id,
          state_hash = excluded.state_hash,
          csrf_hash = excluded.csrf_hash,
          code_challenge = excluded.code_challenge,
          encrypted_code_verifier = excluded.encrypted_code_verifier,
          redirect_uri = excluded.redirect_uri,
          expires_at = excluded.expires_at,
          completed_at = excluded.completed_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "provider"),
        firstText(record, ["accountId"]),
        firstText(record, ["stateHash"]) ?? "",
        firstText(record, ["csrfHash"]) ?? "",
        firstText(record, ["codeChallenge"]) ?? "",
        firstText(record, ["codeVerifier", "encryptedCodeVerifier"]) ?? "",
        firstText(record, ["redirectUri"]) ?? "",
        requiredText(record, "expiresAt"),
        firstText(record, ["completedAt"]),
        requiredText(record, "createdAt")
      ]
    );
  }

  for (const record of snapshotRecords(snapshot.accountPinHashes)) {
    await client.query(
      `
        insert into account_pin_hashes (account_id, pin_hash, updated_at)
        values ($1, $2, now())
        on conflict (account_id) do update set
          pin_hash = excluded.pin_hash,
          updated_at = now()
      `,
      [requiredText(record, "accountId"), requiredText(record, "pinHash")]
    );
  }

  for (const record of snapshotRecords(snapshot.deviceTrust)) {
    const updatedBy = requiredText(record, "updatedBy");
    const updatedByType = updatedBy === "system" || updatedBy === "service" ? updatedBy : "user";

    await client.query(
      `
        insert into device_trust (
          business_id, user_id, device_id, level, reason,
          updated_by, updated_by_type, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (business_id, user_id, device_id) do update set
          level = excluded.level,
          reason = excluded.reason,
          updated_by = excluded.updated_by,
          updated_by_type = excluded.updated_by_type,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "businessId"),
        requiredText(record, "userId"),
        requiredText(record, "deviceId"),
        requiredText(record, "level"),
        firstText(record, ["reason"]),
        updatedByType === "user" ? updatedBy : null,
        updatedByType,
        requiredText(record, "updatedAt")
      ]
    );
  }
}

async function saveIdentityProviders(client: PoolClient, snapshot: Cp2Snapshot): Promise<void> {
  const providerIds = new Set<string>();

  for (const record of snapshotRecords(snapshot.userIdentities)) {
    const provider = firstText(record, ["provider"]);

    if (provider !== null) {
      providerIds.add(provider);
    }
  }

  for (const record of snapshotRecords(snapshot.oauthSessions)) {
    const provider = firstText(record, ["provider"]);

    if (provider !== null) {
      providerIds.add(provider);
    }
  }

  for (const providerId of providerIds) {
    await client.query(
      `
        insert into identity_providers (
          id, display_name, authorization_url, token_url, user_info_url, scopes, pkce, created_at
        )
        values ($1, $1, '', '', null, '[]'::jsonb, true, now())
        on conflict (id) do nothing
      `,
      [providerId]
    );
  }
}

async function replaceReceiptLineItems(
  client: PoolClient,
  records: SnapshotRecord[]
): Promise<void> {
  const receiptIds = [...new Set(records.map((record) => requiredText(record, "receiptId")))];

  if (receiptIds.length > 0) {
    await client.query("delete from receipt_line_items where receipt_id = any($1::uuid[])", [
      receiptIds
    ]);
  }

  for (const record of records) {
    await client.query(
      `
        insert into receipt_line_items (id, receipt_id, name, quantity, unit_price, total)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (id) do update set
          receipt_id = excluded.receipt_id,
          name = excluded.name,
          quantity = excluded.quantity,
          unit_price = excluded.unit_price,
          total = excluded.total
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "receiptId"),
        requiredText(record, "name"),
        record.quantity,
        record.unitPrice,
        record.total
      ]
    );
  }
}

async function deleteMissingRows(
  client: PoolClient,
  tableName: string,
  records: SnapshotRecord[]
): Promise<void> {
  const ids = records.map((record) => requiredText(record, "id"));

  await client.query(`delete from ${tableName} where not (id = any($1::uuid[]))`, [ids]);
}

async function deleteMissingAccountPinHashes(
  client: PoolClient,
  records: SnapshotRecord[]
): Promise<void> {
  const accountIds = records.map((record) => requiredText(record, "accountId"));

  await client.query("delete from account_pin_hashes where not (account_id = any($1::uuid[]))", [
    accountIds
  ]);
}

async function deleteMissingDeviceTrustRows(
  client: PoolClient,
  records: SnapshotRecord[]
): Promise<void> {
  const keys = records.map((record) =>
    [
      requiredText(record, "businessId"),
      requiredText(record, "userId"),
      requiredText(record, "deviceId")
    ].join(":")
  );

  await client.query(
    `
      delete from device_trust
      where not ((business_id::text || ':' || user_id::text || ':' || device_id) = any($1::text[]))
    `,
    [keys]
  );
}

async function deleteMissingInvoiceRows(
  client: PoolClient,
  records: SnapshotRecord[]
): Promise<void> {
  const invoiceIds = records.map((record) => requiredText(record, "id"));

  await client.query("delete from invoice_items where not (invoice_id = any($1::uuid[]))", [
    invoiceIds
  ]);
  await client.query("delete from invoices where not (id = any($1::uuid[]))", [invoiceIds]);
}

async function saveInvoicesAndItems(client: PoolClient, records: SnapshotRecord[]): Promise<void> {
  const invoiceIds = records.map((record) => requiredText(record, "id"));

  for (const record of records) {
    await client.query(
      `
        insert into invoices (
          id, business_id, invoice_number, status, customer_id, customer_name,
          subtotal, tax_rate, tax_total, total, confirmed_at, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id) do update set
          status = excluded.status,
          customer_id = excluded.customer_id,
          customer_name = excluded.customer_name,
          subtotal = excluded.subtotal,
          tax_rate = excluded.tax_rate,
          tax_total = excluded.tax_total,
          total = excluded.total,
          confirmed_at = excluded.confirmed_at,
          updated_at = excluded.updated_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "businessId"),
        requiredText(record, "invoiceNumber"),
        requiredText(record, "status"),
        firstText(record, ["customerId"]),
        firstText(record, ["customerName"]),
        record.subtotal,
        record.taxRate,
        record.taxTotal,
        record.total,
        firstText(record, ["confirmedAt"]),
        requiredText(record, "createdAt"),
        requiredText(record, "updatedAt")
      ]
    );
  }

  if (invoiceIds.length > 0) {
    await client.query("delete from invoice_items where invoice_id = any($1::uuid[])", [
      invoiceIds
    ]);
  }

  for (const invoice of records) {
    const items = Array.isArray(invoice.items) ? (invoice.items as SnapshotRecord[]) : [];

    for (const item of items) {
      await client.query(
        `
          insert into invoice_items
            (id, invoice_id, product_id, product_name, quantity, unit_price, line_total)
          values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (id) do update set
            invoice_id = excluded.invoice_id,
            product_id = excluded.product_id,
            product_name = excluded.product_name,
            quantity = excluded.quantity,
            unit_price = excluded.unit_price,
            line_total = excluded.line_total
        `,
        [
          requiredText(item, "id"),
          requiredText(item, "invoiceId"),
          requiredText(item, "productId"),
          requiredText(item, "productName"),
          item.quantity,
          item.unitPrice,
          item.lineTotal
        ]
      );
    }
  }
}

function emptySnapshot(): Cp2Snapshot {
  return {
    accounts: [],
    users: [],
    businesses: [],
    memberships: [],
    sessionContexts: [],
    conversations: [],
    conversationParticipants: [],
    conversationMessages: [],
    e2eeDevices: [],
    pushSubscriptions: [],
    marketplaceIntroStates: [],
    activeAiModels: [],
    syncChanges: [],
    mcpAccessTokens: [],
    products: [],
    customers: [],
    suppliers: [],
    salesAgents: [],
    supplierContactLinks: [],
    purchaseReceipts: [],
    receiptLineItems: [],
    receiptOCRJobs: [],
    invoices: [],
    payments: [],
    logistics: [],
    dataExports: [],
    accountDeletionRequests: [],
    verificationTiers: [],
    taxConfigs: [],
    deviceTrust: [],
    betaAccess: [],
    betaFeatureFlags: [],
    betaDeviceTests: [],
    betaSupportTickets: [],
    betaTelemetryEvents: [],
    launchSettings: [],
    launchChecklist: [],
    launchIncidents: [],
    documentImports: [],
    documentImportSources: [],
    notifications: [],
    runtimeSessions: [],
    runtimeTurns: [],
    inventoryMovements: [],
    syncQueue: [],
    otpChallenges: [],
    sessions: [],
    userIdentities: [],
    oauthSessions: [],
    accountPinHashes: [],
    networkNodes: [],
    networkEdges: [],
    networkSources: [],
    networkPermissions: [],
    networkRoutes: [],
    contactHashes: [],
    externalIdentities: [],
    sokoIdentityLinks: [],
    auditEvents: []
  };
}

function snapshotHasData(snapshot: Cp2Snapshot): boolean {
  return normalizedCollections.some(
    (collection) => getSnapshotCollection(snapshot, collection.key).length > 0
  );
}

function getSnapshotCollection(
  snapshot: Cp2Snapshot,
  key: SnapshotCollectionKey
): SnapshotRecord[] {
  return snapshot[key] as unknown as SnapshotRecord[];
}

function setSnapshotCollection(
  snapshot: Cp2Snapshot,
  key: SnapshotCollectionKey,
  records: SnapshotRecord[]
): void {
  const target = snapshot as unknown as Record<string, SnapshotRecord[]>;
  target[key] = records;
}

function snapshotRecords(value: unknown): SnapshotRecord[] {
  return value as SnapshotRecord[];
}

function recordEntityId(key: SnapshotCollectionKey, record: SnapshotRecord): string {
  if (key === "accountPinHashes") {
    return requiredText(record, "accountId");
  }

  if (key === "marketplaceIntroStates") {
    return [
      requiredText(record, "accountId"),
      firstText(record, ["businessId"]) ?? "marketplace"
    ].join(":");
  }

  if (key === "activeAiModels") {
    return requiredText(record, "businessId");
  }

  if (key === "verificationTiers" || key === "taxConfigs" || key === "betaAccess") {
    return requiredText(record, "businessId");
  }

  if (key === "launchSettings") {
    return requiredText(record, "businessId");
  }

  if (key === "betaFeatureFlags" || key === "launchChecklist") {
    return [requiredText(record, "businessId"), requiredText(record, "key")].join(":");
  }

  if (key === "deviceTrust") {
    return [
      requiredText(record, "businessId"),
      requiredText(record, "userId"),
      requiredText(record, "deviceId")
    ].join(":");
  }

  return requiredText(record, "id");
}

function requiredText(record: SnapshotRecord, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`CP2 normalized record is missing required text field ${field}.`);
  }

  return value;
}

function firstText(record: SnapshotRecord, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];

    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
}

async function timedQuery<T extends QueryResultRow>(
  pool: Pool,
  operation: string,
  sql: string,
  values?: unknown[]
): Promise<{ rows: T[] }> {
  const startedAt = Date.now();

  try {
    return await pool.query<T>(sql, values);
  } finally {
    logSlowQuery(operation, startedAt);
  }
}

function logSlowQuery(operation: string, startedAt: number): void {
  const elapsedMs = Date.now() - startedAt;
  const thresholdMs = positiveIntegerFromEnv("DB_SLOW_QUERY_MS", 500);

  if (elapsedMs >= thresholdMs) {
    console.warn(`[db] slow operation "${operation}" took ${elapsedMs}ms`);
  }
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function timestampToIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberFromDatabase(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function nullableNumberFromDatabase(value: string | number | null): number | null {
  return value === null ? null : numberFromDatabase(value);
}

function phase1Parity(
  collection: string,
  relationalCountValue: string,
  compatibilityCountValue: string,
  relationalChecksum: string,
  compatibilityChecksum: string
): PostgresStoreHealth["phase1Parity"][number] {
  const relationalCount = Number(relationalCountValue);
  const compatibilityCount = Number(compatibilityCountValue);

  return {
    collection,
    relationalCount,
    compatibilityCount,
    relationalChecksum,
    compatibilityChecksum,
    ok: relationalCount === compatibilityCount && relationalChecksum === compatibilityChecksum
  };
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
