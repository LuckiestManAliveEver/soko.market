import { Pool, type PoolClient, type PoolConfig } from "pg";
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

const requiredMigrationFilename = "012_production_relational_core.sql";

export async function createPostgresCp2Store(
  options: PostgresCp2StoreOptions
): Promise<PostgresCp2Store> {
  const pool = new Pool(poolConfig(options.databaseUrl));
  await assertDatabaseMigrated(pool);

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
  const client = await pool.connect();

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
        insert into sessions (id, account_id, user_id, expires_at, revoked_at, created_at)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (id) do update set
          expires_at = excluded.expires_at,
          revoked_at = excluded.revoked_at
      `,
      [
        requiredText(record, "id"),
        requiredText(record, "accountId"),
        requiredText(record, "userId"),
        requiredText(record, "expiresAt"),
        firstText(record, ["revokedAt"]),
        requiredText(record, "createdAt")
      ]
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
