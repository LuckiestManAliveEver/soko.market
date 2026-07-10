import { Pool, type PoolConfig } from "pg";
import { createCp2Store, type Cp2Snapshot, type Cp2Store, type Cp2StoreOptions } from "./store.js";

const snapshotId = "default";

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
  "confirmProductImport",
  "confirmReceiptOCRJob",
  "confirmSupplierImport",
  "createAgentRoute",
  "createBetaSupportTicket",
  "createBusiness",
  "createDataExport",
  "createInvoice",
  "createLaunchIncident",
  "createLogistics",
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
  "enqueueSyncMutation",
  "linkSalesAgentContact",
  "linkSupplierContact",
  "loginWithAccountPin",
  "logout",
  "recoverAccountPin",
  "recordBetaDeviceTest",
  "recordBetaTelemetry",
  "recordPayment",
  "rejectAgentRoute",
  "replaySyncQueue",
  "replaySyncQueueItem",
  "requestAccountDeletion",
  "requestOtp",
  "setAccountPin",
  "syncPhoneContacts",
  "syncSocialNetwork",
  "updateBetaAccess",
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
  "updateTaxConfig",
  "updateVerificationTier",
  "verifyAccountPin",
  "verifyExternallyApprovedOtp",
  "verifyOtp"
]);

export interface PostgresCp2StoreOptions extends Cp2StoreOptions {
  databaseUrl: string;
}

export type PostgresCp2Store = Cp2Store & {
  close: () => Promise<void>;
  flush: () => Promise<void>;
};

export async function createPostgresCp2Store(
  options: PostgresCp2StoreOptions
): Promise<PostgresCp2Store> {
  const pool = new Pool(poolConfig(options.databaseUrl));
  await ensureSnapshotTable(pool);
  await ensureNormalizedTables(pool);

  const store = createCp2Store(
    options.runtimeModelProvider === undefined
      ? {}
      : {
          runtimeModelProvider: options.runtimeModelProvider
        }
  );
  const savedSnapshot = await loadNormalizedSnapshot(pool);

  if (snapshotHasData(savedSnapshot)) {
    store.hydrateSnapshot(savedSnapshot);
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

  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "close") {
        return close;
      }

      if (property === "flush") {
        return flush;
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
  const sslRequired =
    databaseUrl.includes("sslmode=require") ||
    databaseUrl.includes(".neon.tech") ||
    databaseUrl.includes(".neon.database");

  return {
    connectionString: databaseUrl,
    max: 5,
    ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {})
  };
}

async function ensureSnapshotTable(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists cp2_store_snapshots (
      id text primary key,
      version integer not null,
      data jsonb not null,
      updated_at timestamp with time zone not null
    )
  `);
}

async function ensureNormalizedTables(pool: Pool): Promise<void> {
  for (const collection of normalizedCollections) {
    await pool.query(`
      create table if not exists ${collection.tableName} (
        entity_id text primary key,
        business_id text,
        account_id text,
        user_id text,
        parent_id text,
        record jsonb not null,
        updated_at timestamp with time zone not null default now()
      )
    `);
    await pool.query(`
      create index if not exists ${collection.tableName}_business_idx
        on ${collection.tableName} (business_id)
        where business_id is not null
    `);
    await pool.query(`
      create index if not exists ${collection.tableName}_account_idx
        on ${collection.tableName} (account_id)
        where account_id is not null
    `);
    await pool.query(`
      create index if not exists ${collection.tableName}_user_idx
        on ${collection.tableName} (user_id)
        where user_id is not null
    `);
    await pool.query(`
      create index if not exists ${collection.tableName}_parent_idx
        on ${collection.tableName} (parent_id)
        where parent_id is not null
    `);
  }
}

async function loadNormalizedSnapshot(pool: Pool): Promise<Cp2Snapshot> {
  const snapshot = emptySnapshot();
  const hasNormalizedRecords = await hasAnyNormalizedRecords(pool);

  if (!hasNormalizedRecords) {
    const legacySnapshot = await loadLegacySnapshot(pool);

    if (legacySnapshot !== null && snapshotHasData(legacySnapshot)) {
      await saveNormalizedSnapshot(pool, legacySnapshot);
      return legacySnapshot;
    }
  }

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

  return snapshot;
}

async function hasAnyNormalizedRecords(pool: Pool): Promise<boolean> {
  for (const collection of normalizedCollections) {
    const result = await pool.query<{ exists: boolean }>(
      `select exists(select 1 from ${collection.tableName} limit 1) as exists`
    );

    if (result.rows[0]?.exists === true) {
      return true;
    }
  }

  return false;
}

async function loadLegacySnapshot(pool: Pool): Promise<Cp2Snapshot | null> {
  const result = await pool.query<{ data: Cp2Snapshot }>(
    "select data from cp2_store_snapshots where id = $1",
    [snapshotId]
  );

  return result.rows[0]?.data ?? null;
}

async function saveNormalizedSnapshot(pool: Pool, snapshot: Cp2Snapshot): Promise<void> {
  await pool.query("begin");

  try {
    await pool.query("select pg_advisory_xact_lock(hashtext('soko.cp2.normalized_store'))");

    for (const collection of normalizedCollections) {
      await pool.query(`delete from ${collection.tableName}`);

      for (const record of getSnapshotCollection(snapshot, collection.key)) {
        await pool.query(
          `
            insert into ${collection.tableName}
              (entity_id, business_id, account_id, user_id, parent_id, record, updated_at)
            values ($1, $2, $3, $4, $5, $6::jsonb, now())
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

    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback").catch((rollbackError: unknown) => {
      console.error("Failed to roll back CP2 normalized persistence transaction.", rollbackError);
    });
    throw error;
  }
}

function emptySnapshot(): Cp2Snapshot {
  return {
    accounts: [],
    users: [],
    businesses: [],
    memberships: [],
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

function recordEntityId(key: SnapshotCollectionKey, record: SnapshotRecord): string {
  if (key === "accountPinHashes") {
    return requiredText(record, "accountId");
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

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
