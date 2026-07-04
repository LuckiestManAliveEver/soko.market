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

export type FulfillmentMethod = "delivery" | "pickup";

export type FulfillmentStatus =
  "pending" | "ready" | "out_for_delivery" | "completed" | "cancelled";

export interface LogisticsSummary {
  id: string;
  businessId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string | null;
  method: FulfillmentMethod;
  status: FulfillmentStatus;
  destination: string | null;
  note: string | null;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface LogisticsReportSummary {
  fulfillmentCount: number;
  pendingCount: number;
  readyCount: number;
  outForDeliveryCount: number;
  completedCount: number;
  cancelledCount: number;
  activeCount: number;
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
  logistics: LogisticsSummary[];
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
  | "payment.record"
  | "logistics.create"
  | "logistics.update_status";

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

export interface SyncLogisticsCreatePayload {
  invoiceId: string;
  method: FulfillmentMethod;
  destination?: string | null;
  note?: string | null;
}

export interface SyncLogisticsStatusPayload {
  logisticsId: string;
  status: FulfillmentStatus;
  note?: string | null;
}

export type SyncMutationPayload =
  | SyncProductCreatePayload
  | SyncContactCreatePayload
  | SyncInventoryAdjustPayload
  | SyncInvoiceCreatePayload
  | SyncInvoiceConfirmPayload
  | SyncPaymentRecordPayload
  | SyncLogisticsCreatePayload
  | SyncLogisticsStatusPayload;

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

export interface SalesReportSummary {
  invoiceCount: number;
  confirmedInvoiceCount: number;
  grossSales: number;
  collectedTotal: number;
  outstandingTotal: number;
}

export interface InventoryReportSummary {
  productCount: number;
  totalUnitsOnHand: number;
  lowStockCount: number;
  outOfStockCount: number;
  movementCount: number;
}

export interface PaymentsReportSummary {
  paymentCount: number;
  paidInvoiceCount: number;
  partiallyPaidInvoiceCount: number;
  unpaidInvoiceCount: number;
  totalPaid: number;
}

export interface DebtReportSummary {
  customerCount: number;
  totalOutstanding: number;
  largestBalanceDue: number;
}

export interface ImportsReportSummary {
  totalJobs: number;
  previewedJobs: number;
  confirmedJobs: number;
  failedJobs: number;
  confirmedRows: number;
}

export interface SyncHealthReportSummary extends SyncQueueSummary {
  active: number;
}

export interface BusinessReportSummary {
  businessId: string;
  generatedAt: string;
  sales: SalesReportSummary;
  inventory: InventoryReportSummary;
  payments: PaymentsReportSummary;
  debts: DebtReportSummary;
  imports: ImportsReportSummary;
  logistics: LogisticsReportSummary;
  sync: SyncHealthReportSummary;
}

export type BusinessNotificationType =
  "low_stock" | "open_debt" | "sync_conflict" | "import_failed" | "fulfillment_pending";

export type BusinessNotificationSeverity = "info" | "warning" | "critical";

export type BusinessNotificationStatus = "unread" | "read" | "archived";

export interface BusinessNotificationSummary {
  id: string;
  businessId: string;
  type: BusinessNotificationType;
  severity: BusinessNotificationSeverity;
  status: BusinessNotificationStatus;
  title: string;
  body: string;
  sourceType:
    "report" | "product" | "customer_debt" | "sync_queue" | "document_import" | "logistics";
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

export interface NotificationInboxSummary {
  businessId: string;
  unread: number;
  read: number;
  archived: number;
  total: number;
}

export interface NotificationInbox {
  summary: NotificationInboxSummary;
  notifications: BusinessNotificationSummary[];
}

export interface BusinessKnowledgeFact {
  topic:
    | "sales"
    | "inventory"
    | "payments"
    | "debt"
    | "imports"
    | "logistics"
    | "sync"
    | "notifications";
  severity: BusinessNotificationSeverity;
  detail: string;
  metric: number;
}

export interface BusinessKnowledgeSummary {
  businessId: string;
  generatedAt: string;
  report: BusinessReportSummary;
  notificationSummary: NotificationInboxSummary;
  facts: BusinessKnowledgeFact[];
}

export type RuntimeToolName =
  | "products.list"
  | "invoices.list"
  | "product.create"
  | "customer.create"
  | "invoice.draft"
  | "payment.record"
  | "unknown.clarify";

export type RuntimeParserIntent =
  | "add_product"
  | "add_customer"
  | "create_invoice"
  | "record_payment"
  | "check_debt"
  | "show_products"
  | "show_invoices"
  | "unknown";

export type RuntimeTurnStatus =
  "completed" | "needs_confirmation" | "clarifying" | "blocked" | "rate_limited";

export type RuntimePlanStatus =
  "safe_to_execute" | "needs_confirmation" | "clarification_required" | "blocked";

export type RuntimeTelemetryState =
  | "turn.received"
  | "context.built"
  | "model.prompt_built"
  | "model.completed"
  | "model.fallback"
  | "intent.routed"
  | "plan.created"
  | "verification.completed"
  | "tool.executed"
  | "confirmation.required"
  | "response.generated"
  | "turn.rate_limited"
  | "turn.blocked";

export interface RuntimeContextSummary {
  businessId: string;
  userId: string;
  role: BusinessRole;
  productCount: number;
  customerCount: number;
  supplierCount: number;
  invoiceCount: number;
  openInvoiceCount: number;
  paymentCount: number;
  importJobCount: number;
  logisticsCount: number;
  activeLogisticsCount: number;
  lowStockCount: number;
  outstandingDebtTotal: number;
  unreadNotificationCount: number;
  knowledgeFactCount: number;
}

export type RuntimeModelProviderName = "llama.cpp" | "test";

export type RuntimeModelAdapterStatus =
  "disabled" | "available" | "unavailable" | "timeout" | "malformed" | "error";

export interface RuntimeModelPrompt {
  message: string;
  context: RuntimeContextSummary;
  allowedTools: RuntimeToolName[];
  schemaVersion: "cp11-runtime-model-v1";
}

export interface RuntimeModelCompletionResult {
  provider: RuntimeModelProviderName;
  status: Exclude<RuntimeModelAdapterStatus, "disabled" | "malformed">;
  outputText: string | null;
  durationMs: number;
  errorCode: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface RuntimeModelProvider {
  name: RuntimeModelProviderName;
  complete(prompt: RuntimeModelPrompt): Promise<RuntimeModelCompletionResult>;
}

export interface RuntimeModelTrace {
  provider: RuntimeModelProviderName | null;
  status: RuntimeModelAdapterStatus;
  durationMs: number | null;
  fallbackUsed: boolean;
  outputKind: "tool" | "clarification" | "response" | null;
  errorCode: string | null;
}

export interface RuntimePlannedAction {
  id: string;
  toolName: RuntimeToolName;
  risk: "low" | "medium" | "high" | "critical";
  requiresConfirmation: boolean;
  status: RuntimePlanStatus;
  input: Record<string, unknown>;
  validationErrors: string[];
  confirmationToken: string | null;
  executedAt: string | null;
}

export interface RuntimeVerificationResult {
  ok: boolean;
  requiresConfirmation: boolean;
  confirmationSatisfied: boolean;
  roleAllowed: boolean;
  rateLimited: boolean;
  errors: string[];
}

export interface RuntimeTelemetryEvent {
  id: string;
  sessionId: string;
  turnId: string;
  state: RuntimeTelemetryState;
  occurredAt: string;
  toolName: RuntimeToolName | null;
  risk: RuntimePlannedAction["risk"] | null;
  status: RuntimeTurnStatus | RuntimePlanStatus;
  metadata: Record<string, string | number | boolean | null>;
}

export interface RuntimeSessionSummary {
  id: string;
  businessId: string;
  userId: string;
  status: "active" | "closed";
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeTurnSummary {
  id: string;
  sessionId: string;
  businessId: string;
  actorId: string;
  message: string;
  normalizedInput: string;
  parserIntent: RuntimeParserIntent;
  parserConfidence: number;
  status: RuntimeTurnStatus;
  context: RuntimeContextSummary;
  plan: RuntimePlannedAction;
  verification: RuntimeVerificationResult;
  model: RuntimeModelTrace | null;
  response: string;
  toolResult: unknown | null;
  telemetry: RuntimeTelemetryEvent[];
  createdAt: string;
}

export interface RuntimeTurnResult {
  session: RuntimeSessionSummary;
  turn: RuntimeTurnSummary;
}
