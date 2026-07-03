export type RuntimeName = "api" | "sync" | "ai-runtime" | "web";

export interface HealthResponse {
  service: RuntimeName;
  status: "ok";
  timestamp: string;
}

export interface EnvironmentConfig {
  apiHost: string;
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  reason: string;
}

export type AuthChannel = "email" | "phone";

export type BusinessRole = "owner" | "manager" | "sales_agent" | "cashier" | "view_only";

export type SupportedLanguage = "en" | "sw";

export interface AccountSummary {
  id: string;
  primaryAuthChannel: AuthChannel;
  primaryAuthDestination: string;
}

export interface UserSummary {
  id: string;
  accountId: string;
  displayName: string;
  language: SupportedLanguage;
}

export interface BusinessSummary {
  id: string;
  name: string;
  language: SupportedLanguage;
}

export interface MembershipSummary {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessRole;
}

export interface SessionSummary {
  id: string;
  expiresAt: string;
}

export interface AuthSessionView {
  account: AccountSummary;
  user: UserSummary;
  session: SessionSummary;
}

export interface ProductSummary {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSummary {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierSummary {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = "draft" | "confirmed";

export interface InvoiceItemSummary {
  id: string;
  invoiceId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceTotals {
  subtotal: number;
  taxRate: number;
  taxTotal: number;
  total: number;
}

export interface InvoiceSummary extends InvoiceTotals {
  id: string;
  businessId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  customerId: string | null;
  customerName: string | null;
  items: InvoiceItemSummary[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePreview extends InvoiceTotals {
  businessId: string;
  customerId: string | null;
  customerName: string | null;
  items: Omit<InvoiceItemSummary, "id" | "invoiceId">[];
}

export type PaymentMethod =
  "cash" | "bank_transfer" | "mobile_money_manual" | "card_manual" | "other_manual";

export type InvoicePaymentStatus = "unpaid" | "partially_paid" | "paid";

export interface PaymentSummary {
  id: string;
  businessId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string | null;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  note: string | null;
  actorId: string;
  createdAt: string;
}

export interface InvoicePaymentSummary {
  invoiceId: string;
  businessId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string | null;
  invoiceTotal: number;
  paidTotal: number;
  balanceDue: number;
  status: InvoicePaymentStatus;
}

export interface CustomerDebtSummary {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;
}

export type DocumentImportTarget = "supplier";

export type DocumentImportStatus = "previewed" | "confirmed" | "failed";

export interface DocumentImportSourceSummary {
  id: string;
  businessId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface SupplierImportDraft {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface DocumentImportPreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: SupplierImportDraft;
  errors: string[];
  warnings: string[];
  selected: boolean;
}

export interface DocumentImportJobSummary {
  id: string;
  businessId: string;
  source: DocumentImportSourceSummary;
  target: DocumentImportTarget;
  status: DocumentImportStatus;
  fieldMapping: Record<string, keyof SupplierImportDraft>;
  rows: DocumentImportPreviewRow[];
  confirmedCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface DocumentImportConfirmResult {
  job: DocumentImportJobSummary;
  suppliers: SupplierSummary[];
}

export type InventoryMovementType = "manual_adjustment" | "sale";

export interface InventoryMovementSummary {
  id: string;
  businessId: string;
  productId: string;
  type: InventoryMovementType;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  reason: string;
  actorId: string;
  createdAt: string;
}

export interface OfflineCacheSnapshot {
  businessId: string;
  capturedAt: string;
  source: "server_cache";
  products: ProductSummary[];
  customers: CustomerSummary[];
  suppliers: SupplierSummary[];
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  invoicePaymentSummaries: InvoicePaymentSummary[];
  customerDebts: CustomerDebtSummary[];
  inventoryMovements: InventoryMovementSummary[];
}

export type SyncQueueStatus = "pending" | "processing" | "synced" | "failed" | "conflict";

export type SyncMutationType =
  | "product.create"
  | "customer.create"
  | "supplier.create"
  | "inventory.adjust"
  | "invoice.create"
  | "invoice.confirm"
  | "payment.record";

export interface SyncProductCreatePayload {
  name: string;
  sku?: string | null;
  unit?: string | null;
  quantity?: number;
}

export interface SyncContactCreatePayload {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface SyncInventoryAdjustPayload {
  productId: string;
  quantityAfter: number;
  reason?: string | null;
}

export interface SyncInvoiceLinePayload {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface SyncInvoiceCreatePayload {
  customerId?: string | null;
  customerName?: string | null;
  taxRate?: number | null;
  items: SyncInvoiceLinePayload[];
}

export interface SyncInvoiceConfirmPayload {
  invoiceId: string;
}

export interface SyncPaymentRecordPayload {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
}

export type SyncMutationPayload =
  | SyncProductCreatePayload
  | SyncContactCreatePayload
  | SyncInventoryAdjustPayload
  | SyncInvoiceCreatePayload
  | SyncInvoiceConfirmPayload
  | SyncPaymentRecordPayload;

export interface SyncConflict {
  code: string;
  message: string;
  statusCode: number;
  retryable: boolean;
}

export interface SyncQueueItem {
  id: string;
  idempotencyKey: string;
  businessId: string;
  actorId: string;
  mutationType: SyncMutationType;
  payload: SyncMutationPayload;
  status: SyncQueueStatus;
  attempts: number;
  clientCreatedAt: string;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  result: unknown | null;
  conflict: SyncConflict | null;
}

export interface SyncQueueSummary {
  businessId: string;
  pending: number;
  processing: number;
  synced: number;
  failed: number;
  conflict: number;
  total: number;
}

export interface SyncReplayResult {
  item: SyncQueueItem;
  replayed: boolean;
}
