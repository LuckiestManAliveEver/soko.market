import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const businessEvents = pgTable("business_events", {
  id: uuid("id").primaryKey(),
  aggregateId: text("aggregate_id").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  actorId: text("actor_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  risk: text("risk").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull()
});

export const syncQueue = pgTable("sync_queue", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => businessEvents.id),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey(),
  primaryAuthChannel: text("primary_auth_channel").notNull(),
  primaryAuthDestination: text("primary_auth_destination").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  displayName: text("display_name").notNull(),
  language: text("language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const identityProviders = pgTable("identity_providers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  authorizationUrl: text("authorization_url").notNull(),
  tokenUrl: text("token_url").notNull(),
  userInfoUrl: text("user_info_url"),
  scopes: jsonb("scopes").notNull(),
  pkce: boolean("pkce").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const userIdentities = pgTable("user_identities", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  providerId: text("provider_id")
    .notNull()
    .references(() => identityProviders.id),
  providerSubject: text("provider_subject").notNull(),
  email: text("email"),
  displayName: text("display_name"),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  encryptedIdToken: text("encrypted_id_token"),
  tokenType: text("token_type"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const oauthSessions = pgTable("oauth_sessions", {
  id: uuid("id").primaryKey(),
  providerId: text("provider_id")
    .notNull()
    .references(() => identityProviders.id),
  accountId: uuid("account_id").references(() => accounts.id),
  stateHash: text("state_hash").notNull(),
  csrfHash: text("csrf_hash").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    sokoId: text("soko_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    sokoIdUnique: uniqueIndex("businesses_soko_id_unique_idx").on(table.sokoId)
  })
);

export const businessMemberships = pgTable("business_memberships", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id").primaryKey(),
  channel: text("channel").notNull(),
  destination: text("destination").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    sku: text("sku"),
    unit: text("unit").notNull(),
    quantity: numeric("quantity").notNull(),
    buyingPrice: numeric("buying_price"),
    sellingPrice: numeric("selling_price"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    businessSkuUnique: uniqueIndex("products_business_sku_unique_idx").on(
      table.businessId,
      table.sku
    ),
    businessUpdated: index("products_business_updated_idx").on(table.businessId, table.updatedAt)
  })
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    businessContact: index("customers_business_contact_idx").on(
      table.businessId,
      table.phone,
      table.email
    )
  })
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    phone: text("phone"),
    linkedPhonebookContactId: text("linked_phonebook_contact_id"),
    linkedPhonebookContactName: text("linked_phonebook_contact_name"),
    email: text("email"),
    notes: text("notes"),
    salesAgentCount: integer("sales_agent_count").notNull().default(0),
    purchaseReceiptCount: integer("purchase_receipt_count").notNull().default(0),
    lastPurchaseDate: timestamp("last_purchase_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    businessUpdated: index("suppliers_business_updated_idx").on(table.businessId, table.updatedAt)
  })
);

export const salesAgents = pgTable(
  "sales_agents",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    supplierName: text("supplier_name").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    linkedPhonebookContactId: text("linked_phonebook_contact_id"),
    linkedPhonebookContactName: text("linked_phonebook_contact_name"),
    notes: text("notes"),
    receiptsHandled: integer("receipts_handled").notNull().default(0),
    lastTransactionDate: timestamp("last_transaction_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    businessSupplier: index("sales_agents_business_supplier_idx").on(
      table.businessId,
      table.supplierId,
      table.name
    ),
    businessPhone: index("sales_agents_business_phone_idx").on(table.businessId, table.phone)
  })
);

export const supplierContactLinks = pgTable(
  "supplier_contact_links",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    linkType: text("link_type").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    salesAgentId: uuid("sales_agent_id").references(() => salesAgents.id),
    networkNodeId: text("network_node_id").notNull(),
    contactName: text("contact_name").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    supplierUnique: uniqueIndex("supplier_contact_links_supplier_unique_idx").on(
      table.businessId,
      table.supplierId,
      table.networkNodeId
    ),
    agentUnique: uniqueIndex("supplier_contact_links_agent_unique_idx").on(
      table.businessId,
      table.salesAgentId,
      table.networkNodeId
    )
  })
);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  type: text("type").notNull(),
  quantityBefore: numeric("quantity_before").notNull(),
  quantityAfter: numeric("quantity_after").notNull(),
  delta: numeric("delta").notNull(),
  reason: text("reason").notNull(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull(),
  customerId: uuid("customer_id").references(() => customers.id),
  customerName: text("customer_name"),
  subtotal: numeric("subtotal").notNull(),
  taxRate: numeric("tax_rate").notNull(),
  taxTotal: numeric("tax_total").notNull(),
  total: numeric("total").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  productName: text("product_name").notNull(),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price").notNull(),
  lineTotal: numeric("line_total").notNull()
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    customerId: uuid("customer_id").references(() => customers.id),
    method: text("method").notNull(),
    amount: numeric("amount").notNull(),
    reference: text("reference"),
    note: text("note"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    businessInvoice: index("payments_business_invoice_idx").on(
      table.businessId,
      table.invoiceId,
      table.createdAt
    )
  })
);

export const receiptOCRJobs = pgTable(
  "receipt_ocr_jobs",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    tenantId: text("tenant_id").notNull(),
    shopId: text("shop_id").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    status: text("status").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    contentType: text("content_type").notNull(),
    engine: text("engine").notNull(),
    engineVersion: text("engine_version").notNull(),
    modelVersion: text("model_version").notNull(),
    profile: text("profile").notNull(),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    languageHints: jsonb("language_hints").notNull().default([]),
    fullText: text("full_text").notNull().default(""),
    averageConfidence: numeric("average_confidence").notNull().default("0"),
    warnings: jsonb("warnings").notNull().default([]),
    fieldEvidence: jsonb("field_evidence").notNull().default([]),
    structuredExtraction: jsonb("structured_extraction").notNull().default({}),
    contactMatchingResult: jsonb("contact_matching_result").notNull().default({}),
    supplierCandidates: jsonb("supplier_candidates").notNull().default([]),
    salesAgentCandidates: jsonb("sales_agent_candidates").notNull().default([]),
    supplierName: text("supplier_name"),
    salesAgentName: text("sales_agent_name"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    businessStatus: index("receipt_ocr_jobs_business_status_idx").on(
      table.businessId,
      table.status,
      table.updatedAt
    )
  })
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    supplierName: text("supplier_name").notNull(),
    salesAgentId: uuid("sales_agent_id").references(() => salesAgents.id),
    salesAgentName: text("sales_agent_name"),
    receiptDate: timestamp("receipt_date", { withTimezone: true }).notNull(),
    total: numeric("total").notNull(),
    sourceFileName: text("source_file_name"),
    ocrJobId: uuid("ocr_job_id").references(() => receiptOCRJobs.id),
    imageStored: boolean("image_stored").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    businessSupplierDate: index("purchase_receipts_business_supplier_date_idx").on(
      table.businessId,
      table.supplierId,
      table.receiptDate
    ),
    businessAgentDate: index("purchase_receipts_business_agent_date_idx").on(
      table.businessId,
      table.salesAgentId,
      table.receiptDate
    )
  })
);

export const receiptLineItems = pgTable(
  "receipt_line_items",
  {
    id: uuid("id").primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => purchaseReceipts.id),
    name: text("name").notNull(),
    quantity: numeric("quantity").notNull(),
    unitPrice: numeric("unit_price").notNull(),
    total: numeric("total").notNull()
  },
  (table) => ({
    receipt: index("receipt_line_items_receipt_idx").on(table.receiptId)
  })
);

export const invoiceNumberCounters = pgTable("invoice_number_counters", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id),
  nextNumber: integer("next_number").notNull()
});

export const offlineSyncQueue = pgTable("offline_sync_queue", {
  id: uuid("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  mutationType: text("mutation_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  clientCreatedAt: timestamp("client_created_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  result: jsonb("result"),
  conflict: jsonb("conflict")
});

export const offlineCacheSnapshots = pgTable("offline_cache_snapshots", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  source: text("source").notNull()
});

export const documentImportSources = pgTable("document_import_sources", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksum: text("checksum").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const documentImportJobs = pgTable("document_import_jobs", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => documentImportSources.id),
  target: text("target").notNull(),
  status: text("status").notNull(),
  fieldMapping: jsonb("field_mapping").notNull(),
  confirmedCount: integer("confirmed_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true })
});

export const documentImportRows = pgTable("document_import_rows", {
  id: uuid("id").primaryKey(),
  importJobId: uuid("import_job_id")
    .notNull()
    .references(() => documentImportJobs.id),
  rowNumber: integer("row_number").notNull(),
  raw: jsonb("raw").notNull(),
  mapped: jsonb("mapped").notNull(),
  errors: jsonb("errors").notNull(),
  warnings: jsonb("warnings").notNull(),
  selected: integer("selected").notNull().default(0)
});

export const cp2StoreSnapshots = pgTable("cp2_store_snapshots", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});
