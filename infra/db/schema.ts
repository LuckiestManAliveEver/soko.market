import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  language: text("language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

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

export const products = pgTable("products", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  name: text("name").notNull(),
  sku: text("sku"),
  unit: text("unit").notNull(),
  quantity: numeric("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const customers = pgTable("customers", {
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
});

export const suppliers = pgTable("suppliers", {
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
});

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

export const payments = pgTable("payments", {
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
});

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
