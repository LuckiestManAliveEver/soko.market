import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from "react";
import { createRoot } from "react-dom/client";
import {
  defaultProductVocabularyContextScript,
  parseMerchantCommand,
  parseProductContextScriptCommand,
  productContextScriptMatchToParseResult,
  type ParseResult
} from "@soko/tool-core";
import { Surface } from "@soko/ui";
import {
  createInitialChatMessages,
  quickActions,
  type ChatAttachment,
  type ChatMessage,
  type ShellView,
  type SokoMode
} from "./app-shell";
import { openIndexedDbSyncRepository } from "./sync/indexeddb-repository";
import { catchUpAccountSync } from "./sync/sync-client";
import { subscribeToAccountRealtime } from "./sync/realtime-client";
import "./styles.css";

type AuthChannel = "phone" | "email";
type SupportedLanguage = "en" | "sw";
type ShopPresenceStatus = "online" | "private" | "offline";
type SocialSignupProvider =
  "google" | "facebook" | "tiktok" | "x" | "linkedin" | "apple" | "github" | "microsoft";
type NetworkSyncProviderId =
  "phone" | "google" | "facebook" | "instagram" | "x" | "linkedin" | "whatsapp" | "other";
type CountryDialCode = "+254" | "+1" | "+44" | "+234" | "+27" | "+255" | "+256" | "+250";

const chatAttachmentAccept = [
  "image/*",
  "video/*",
  "application/*",
  "text/*",
  ".csv",
  ".doc",
  ".docx",
  ".json",
  ".odp",
  ".ods",
  ".odt",
  ".pdf",
  ".ppt",
  ".pptx",
  ".rtf",
  ".txt",
  ".xls",
  ".xlsx",
  ".xml"
].join(",");

interface OtpRequestResponse {
  challengeId: string;
  destination: string;
  expiresAt: string;
  devOtp?: string;
}

interface SessionResponse {
  account: {
    id: string;
  };
  user: {
    id: string;
    displayName: string;
    language: SupportedLanguage;
  };
  session: {
    expiresAt: string;
  };
}

interface OAuthStartResponse {
  authorizationUrl: string;
  csrfToken: string;
  expiresAt: string;
  provider: SocialSignupProvider;
  state: string;
}

interface OAuthProviderSummary {
  callbackPath?: string;
  configured: boolean;
  displayName: string;
  enabled?: boolean;
  icon?: string;
  id: SocialSignupProvider;
  implemented?: boolean;
  scopes?: string[];
}

interface OAuthProvidersResponse {
  providers: OAuthProviderSummary[];
}

interface PendingOAuthLogin {
  csrfToken: string;
  provider: SocialSignupProvider;
  state: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

interface PinStatusResponse {
  hasPin: boolean;
}

interface BusinessResponse {
  business: {
    id: string;
    name: string;
    language: SupportedLanguage;
    sokoId: string;
  };
  membership: {
    role: string;
  };
}

interface RoleCheckResponse {
  allowed: boolean;
  role: string;
  permission: string;
}

type ActiveBusiness = BusinessResponse["business"] & {
  role: string;
};

type AgentModel = "qwen2.5-0.5b-android" | "sokoclaw-local" | "openai-fast" | "openai-reasoning";

interface AgentSettings {
  id: string;
  name: string;
  description: string;
  model: AgentModel;
  role: string;
  globalAgentId: string;
  storefrontUrl: string;
  language: SupportedLanguage;
  personality: string;
  instructions: string;
  knowledge: string;
  tools: string[];
  integrations: string[];
  contextScripts: string[];
  status: "active" | "draft";
}

interface AgentRuntimeProfile {
  behavior: string;
  contextScripts: string[];
  integrations: string[];
  knowledge: string;
  model: AgentModel;
  role: string;
  instructions: string;
  tools: string[];
}

interface SetupDraft {
  channel: AuthChannel;
  countryCode: CountryDialCode;
  destination: string;
  businessName: string;
  language: SupportedLanguage;
  completedStep: 0 | 1 | 2;
}

interface OwnerAuthRecord {
  contact: string;
  countryCode: CountryDialCode;
  pinSet?: boolean;
  provider?: SocialSignupProvider;
}

interface ProductSummary {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

interface PublicStorefrontProductSummary {
  id: string;
  name: string;
  unit: string;
  available: boolean;
}

interface PublicStorefrontSummary {
  agentId: string;
  sokoId: string;
  businessName: string;
  products: PublicStorefrontProductSummary[];
}

interface StorefrontChatMessage {
  id: string;
  author: "agent" | "customer";
  body: string;
}

interface StorefrontCartItem {
  productId: string;
  quantity: number;
}

interface StorefrontCheckoutDetails {
  name: string;
  phone: string;
  note: string;
}

interface StorefrontCrmNote {
  id: string;
  label: string;
  body: string;
}

interface ContactPickerContact {
  name?: string[];
  tel?: string[];
  email?: string[];
}

type NetworkNodeDegree = 0 | 1 | 2;

interface NetworkNodeSummary {
  id: string;
  kind?: "soko_user" | "soko_shop" | "external_contact" | "external_social";
  displayName: string;
  degree: NetworkNodeDegree;
  sourceType: "owner" | "phone_contact" | "social";
  sourcePlatform: string | null;
  sokoUserId?: string | null;
  sokoBusinessId?: string | null;
  sokoAgentId?: string | null;
  visibilityStatus: "direct" | "agent_mediated" | "private";
  consentStatus: "granted" | "pending" | "agent_required" | "rejected" | "revoked";
}

interface NetworkEdgeSummary {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  degree: 1 | 2;
  sourceType: string;
  sourcePlatform: string | null;
}

interface NetworkSyncSourceSummary {
  id: string;
  sourceType: "phone_contact" | "social";
  sourcePlatform: string;
  displayName: string;
  importedCount: number;
  directCount: number;
  extendedCount: number;
  status: "active" | "disconnected";
  createdAt?: string;
  updatedAt?: string;
  disconnectedAt?: string | null;
}

interface AgentRouteSummary {
  id: string;
  requestText: string;
  status: "pending_permission" | "forwarded" | "suggested" | "blocked" | "approved" | "rejected";
  path: string[];
  viaAgentLabel: string;
}

interface SokoIdentityLinkSummary {
  id: string;
  ownerUserId: string;
  nodeId: string;
  linkedUserId: string | null;
  linkedBusinessId: string | null;
  linkedAgentId: string | null;
  confidence: number;
  createdAt: string;
}

interface NetworkGraphSummary {
  ownerUserId: string;
  generatedAt: string;
  nodes: NetworkNodeSummary[];
  edges: NetworkEdgeSummary[];
  sources: NetworkSyncSourceSummary[];
  routes: AgentRouteSummary[];
  identityLinks?: SokoIdentityLinkSummary[];
}

interface ContactPickerNavigator extends Navigator {
  contacts?: {
    select: (
      properties: Array<"name" | "tel" | "email">,
      options?: { multiple?: boolean }
    ) => Promise<ContactPickerContact[]>;
  };
}

interface CustomerSummary {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SupplierSummary {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  linkedPhonebookContactId: string | null;
  linkedPhonebookContactName: string | null;
  email: string | null;
  notes: string | null;
  salesAgentCount: number;
  purchaseReceiptCount: number;
  lastPurchaseDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SalesAgentSummary {
  id: string;
  businessId: string;
  supplierId: string;
  supplierName: string;
  name: string;
  phone: string | null;
  linkedPhonebookContactId: string | null;
  linkedPhonebookContactName: string | null;
  notes: string | null;
  receiptsHandled: number;
  lastTransactionDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReceiptLineItemSummary {
  id: string;
  receiptId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PurchaseReceiptSummary {
  id: string;
  businessId: string;
  supplierId: string;
  supplierName: string;
  salesAgentId: string | null;
  salesAgentName: string | null;
  receiptDate: string;
  total: number;
  sourceFileName: string | null;
  ocrJobId: string | null;
  imageStored: boolean;
  createdAt: string;
  lineItems: ReceiptLineItemSummary[];
}

interface ReceiptOCRMatchCandidate {
  id: string;
  entityType: "supplier" | "sales_agent" | "contact";
  recordId: string | null;
  contactId: string | null;
  displayName: string;
  name: string;
  confidence: number;
  matchedBy: string[];
  sources: string[];
  requiresConfirmation: boolean;
  reason: string;
  sourceProvider: string | null;
}

interface ReceiptOCRJobSummary {
  id: string;
  businessId: string;
  tenantId: string;
  shopId: string;
  uploadedBy: string;
  status:
    | "UPLOADED"
    | "QUEUED"
    | "VALIDATING"
    | "PREPROCESSING"
    | "OCR_RUNNING"
    | "FIELDS_EXTRACTED"
    | "CONTACT_MATCHING"
    | "PARSING"
    | "MATCHING"
    | "REVIEW_REQUIRED"
    | "CONFIRMED"
    | "PURCHASE_RECORDED"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "CLEANUP_PENDING"
    | "IMAGE_DELETED"
    | "pending"
    | "matched"
    | "needs_review"
    | "failed"
    | "confirmed";
  sourceFileName: string;
  contentType: string;
  engine: "paddleocr" | "tesseract";
  engineVersion: string;
  modelVersion: string;
  profile: "mobile" | "balanced" | "accurate";
  fallbackUsed: boolean;
  languageHints: string[];
  blocks: Array<{
    id: string;
    page: number;
    text: string;
    confidence: number;
    boundingBox: Array<{ x: number; y: number }> | null;
  }>;
  fullText: string;
  averageConfidence: number;
  warnings: string[];
  fieldEvidence: Array<{
    field: string;
    value: string | number | null;
    confidence: number;
    sourceText: string | null;
  }>;
  structuredExtraction: {
    supplier: {
      supplierName: string | null;
      tradingName: string | null;
      legalName: string | null;
      phoneNumber: string | null;
      alternatePhoneNumber: string | null;
      email: string | null;
      physicalAddress: string | null;
      taxPin: string | null;
      registrationNumber: string | null;
      branch: string | null;
      accountNumber: string | null;
    };
    salesAgent: {
      name: string | null;
      phoneNumber: string | null;
      email: string | null;
      agentNumber: string | null;
      supplierRepresented: string | null;
      branch: string | null;
      notes: string | null;
    };
    receipt: {
      receiptNumber: string | null;
      invoiceNumber: string | null;
      orderNumber: string | null;
      purchaseDate: string | null;
      purchaseTime: string | null;
      currency: string | null;
      subtotal: number | null;
      discount: number | null;
      tax: number | null;
      total: number | null;
      amountPaid: number | null;
      balance: number | null;
      paymentMethod: string | null;
      tillNumber: string | null;
      paybillNumber: string | null;
      transactionReference: string | null;
    };
    products: Array<{
      itemName: string;
      itemCode: string | null;
      sku: string | null;
      quantity: number;
      unit: string | null;
      unitPrice: number;
      lineTotal: number;
      batchNumber: string | null;
      expiryDate: string | null;
    }>;
  };
  contactMatchingResult: {
    matched: boolean;
    scriptId: "receipt_contact_matching";
    intent: "RECEIPT_CONTACT_MATCH";
    source: "context_script";
    ocrJobId: string;
    supplier: {
      extractedName: string | null;
      extractedPhone: string | null;
      extractedEmail: string | null;
      selectedRecordId: string | null;
      selectedContactId: string | null;
      confidence: number;
      matchedBy: string[];
      sources: string[];
      requiresConfirmation: boolean;
      candidates: ReceiptOCRMatchCandidate[];
    };
    salesAgent: {
      extractedName: string | null;
      extractedPhone: string | null;
      extractedEmail: string | null;
      selectedRecordId: string | null;
      selectedContactId: string | null;
      confidence: number;
      matchedBy: string[];
      sources: string[];
      requiresConfirmation: boolean;
      candidates: ReceiptOCRMatchCandidate[];
    };
    unmatchedFields: string[];
    warnings: string[];
    thresholds: {
      autoSelect: number;
      confirmationRequired: number;
      rejectBelow: number;
    };
  };
  supplierCandidates: ReceiptOCRMatchCandidate[];
  salesAgentCandidates: ReceiptOCRMatchCandidate[];
  supplierName: string | null;
  salesAgentName: string | null;
  phone: string | null;
  receiptDate: string | null;
  total: number | null;
  items: Array<{
    name: string;
    quantity: number;
    unit?: string | null;
    itemCode?: string | null;
    sku?: string | null;
    unitPrice: number;
    total: number;
    batchNumber?: string | null;
    expiryDate?: string | null;
  }>;
  matchedSupplierId: string | null;
  matchedSalesAgentId: string | null;
  errorMessage: string | null;
  failureCode: string | null;
  imageStorageKey: string | null;
  imageHash: string | null;
  imageRetained: boolean;
  imageDeletedAt: string | null;
  cleanupPending: boolean;
  retryCount: number;
  processingStartedAt: string | null;
  completedAt: string | null;
  temporaryImageExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

interface SupplierBusinessCardSummary extends SupplierSummary {
  salesAgents: SalesAgentSummary[];
  purchaseReceipts: PurchaseReceiptSummary[];
}

interface StockAdjustmentResponse {
  product: ProductSummary;
}

interface InvoiceItemSummary {
  id: string;
  invoiceId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface InvoicePreview {
  businessId: string;
  customerId: string | null;
  customerName: string | null;
  items: Omit<InvoiceItemSummary, "id" | "invoiceId">[];
  subtotal: number;
  taxRate: number;
  taxTotal: number;
  total: number;
}

interface InvoiceSummary extends InvoicePreview {
  id: string;
  invoiceNumber: string;
  status: "draft" | "confirmed";
  items: InvoiceItemSummary[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConfirmInvoiceResponse {
  invoice: InvoiceSummary;
}

type PaymentMethod =
  "cash" | "bank_transfer" | "mobile_money_manual" | "card_manual" | "other_manual";

interface PaymentSummary {
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

interface InvoicePaymentSummary {
  invoiceId: string;
  businessId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string | null;
  invoiceTotal: number;
  paidTotal: number;
  balanceDue: number;
  status: "unpaid" | "partially_paid" | "paid";
}

interface CustomerDebtSummary {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;
}

interface RecordPaymentResponse {
  payment: PaymentSummary;
  invoicePayment: InvoicePaymentSummary;
}

type FulfillmentMethod = "delivery" | "pickup";
type FulfillmentStatus = "pending" | "ready" | "out_for_delivery" | "completed" | "cancelled";

interface LogisticsSummary {
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

interface SyncQueueSummary {
  businessId: string;
  pending: number;
  processing: number;
  synced: number;
  failed: number;
  conflict: number;
  total: number;
}

interface SyncQueueItem {
  id: string;
  mutationType: string;
  status: "pending" | "processing" | "synced" | "failed" | "conflict";
  attempts: number;
  clientCreatedAt: string;
  conflict: {
    code: string;
    message: string;
  } | null;
}

interface SyncQueueResponse {
  summary: SyncQueueSummary;
  items: SyncQueueItem[];
}

interface OfflineCacheSnapshot {
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
  inventoryMovements: Array<{
    id: string;
    productId: string;
    type: string;
    quantityBefore: number;
    quantityAfter: number;
    delta: number;
    reason: string;
    createdAt: string;
  }>;
}

interface BusinessReportSummary {
  businessId: string;
  generatedAt: string;
  sales: {
    invoiceCount: number;
    confirmedInvoiceCount: number;
    grossSales: number;
    collectedTotal: number;
    outstandingTotal: number;
  };
  inventory: {
    productCount: number;
    totalUnitsOnHand: number;
    lowStockCount: number;
    outOfStockCount: number;
    movementCount: number;
  };
  payments: {
    paymentCount: number;
    paidInvoiceCount: number;
    partiallyPaidInvoiceCount: number;
    unpaidInvoiceCount: number;
    totalPaid: number;
  };
  debts: {
    customerCount: number;
    totalOutstanding: number;
    largestBalanceDue: number;
  };
  imports: {
    totalJobs: number;
    previewedJobs: number;
    confirmedJobs: number;
    failedJobs: number;
    confirmedRows: number;
  };
  logistics: {
    fulfillmentCount: number;
    pendingCount: number;
    readyCount: number;
    outForDeliveryCount: number;
    completedCount: number;
    cancelledCount: number;
    activeCount: number;
  };
  compliance: {
    exportCount: number;
    deletionRequestCount: number;
    scheduledAnonymizationCount: number;
    retainedRecordCount: number;
    verificationTier: VerificationTier;
    taxCountryCode: "KE";
    deviceTrustLevel: DeviceTrustLevel;
    highRiskAuditEventCount: number;
  };
  beta: BetaReadinessReportSummary;
  launch: LaunchReadinessReportSummary;
  sync: SyncQueueSummary & {
    active: number;
  };
}

interface BusinessKnowledgeSummary {
  businessId: string;
  generatedAt: string;
  report: BusinessReportSummary;
  notificationSummary: NotificationInboxSummary;
  facts: Array<{
    topic: string;
    severity: "info" | "warning" | "critical";
    detail: string;
    metric: number;
  }>;
}

interface BusinessNotificationSummary {
  id: string;
  businessId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  status: "unread" | "read" | "archived";
  title: string;
  body: string;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

interface NotificationInboxSummary {
  businessId: string;
  unread: number;
  read: number;
  archived: number;
  total: number;
}

interface NotificationInbox {
  summary: NotificationInboxSummary;
  notifications: BusinessNotificationSummary[];
}

interface SupplierImportDraft {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

interface ProductImportDraft {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
}

type DocumentImportDraft = SupplierImportDraft | ProductImportDraft;
type DocumentImportTarget = "supplier" | "product";

interface DocumentImportPreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: DocumentImportDraft;
  errors: string[];
  warnings: string[];
  selected: boolean;
}

interface DocumentImportJobSummary {
  id: string;
  businessId: string;
  source: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    createdAt: string;
  };
  target: DocumentImportTarget;
  status: "previewed" | "confirmed" | "failed";
  rows: DocumentImportPreviewRow[];
  confirmedCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

interface DocumentImportConfirmResult {
  job: DocumentImportJobSummary;
}

interface RuntimeSessionSummary {
  id: string;
  businessId: string;
  userId: string;
  status: "active" | "closed";
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RuntimeTurnSummary {
  id: string;
  sessionId: string;
  businessId: string;
  actorId: string;
  message: string;
  normalizedInput: string;
  status: "completed" | "needs_confirmation" | "clarifying" | "blocked" | "rate_limited";
  plan: {
    toolName: string;
    confirmationToken: string | null;
  };
  response: string;
  createdAt: string;
}

interface RuntimeTurnResult {
  session: RuntimeSessionSummary;
  turn: {
    status: "completed" | "needs_confirmation" | "clarifying" | "blocked" | "rate_limited";
    response: string;
    plan: {
      toolName: string;
      confirmationToken: string | null;
    };
  };
}

type VerificationTier = "unverified" | "owner_verified" | "business_verified";
type DeviceTrustLevel = "unknown" | "trusted" | "restricted";

interface SecurityReviewSummary {
  businessId: string;
  generatedAt: string;
  rbac: {
    reviewedPermissionCount: number;
    highRiskPermissionCount: number;
    ownerOnlyPermissionCount: number;
    gaps: string[];
  };
  audit: {
    highRiskActionCount: number;
    missingHighRiskAuditCount: number;
    coveredActionTypes: string[];
  };
  sensitiveData: {
    scannedSurfaceCount: number;
    rawSensitiveLogFindings: number;
    promptExposure: "bounded";
    redactionRules: string[];
  };
  tielReadiness: {
    verificationTier: VerificationTier;
    deviceTrustLevel: DeviceTrustLevel;
    fullTielDeferred: true;
  };
}

interface DataExportBundle {
  id: string;
  status: "ready";
  checksum: string;
  recordCounts: Record<string, number>;
  createdAt: string;
}

interface AccountDeletionRequestSummary {
  id: string;
  status:
    | "scheduled"
    | "PENDING_VERIFICATION"
    | "VERIFIED"
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "PARTIALLY_FAILED"
    | "FAILED"
    | "CANCELLED";
  requestedAt: string;
  deactivatedAt: string;
  anonymizeAfter: string;
  retention: {
    retainedInvoiceCount: number;
    retainedPaymentCount: number;
    retainedLogisticsCount: number;
    retainedAuditEventCount: number;
    directIdentifierFieldsRemoved: number;
  };
}

interface ConnectedSocialAccountSummary {
  id: string;
  provider: SocialSignupProvider;
  providerName: string;
  connected: boolean;
  displayName: string | null;
  email: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
}

interface ConnectedSocialAccountsResponse {
  accounts: ConnectedSocialAccountSummary[];
}

interface ShopDeletionPreviewSummary {
  businessId: string;
  shopId: string;
  generatedAt: string;
  counts: {
    products: number;
    customers: number;
    suppliers: number;
    salesAgents: number;
    salesRecords: number;
    messages: number;
    notifications: number;
    connectedProviders: number;
    uploadedFiles: number;
    installedIntegrations: number;
  };
  retentionNotice: string;
}

interface ShopDeletionRequestResult {
  request: AccountDeletionRequestSummary;
  preview: ShopDeletionPreviewSummary;
  otp: {
    challengeId: string;
    destination: string;
    expiresAt: string;
    devOtp?: string;
  };
}

interface VerificationTierSummary {
  tier: VerificationTier;
  evidenceType: "none" | "owner_attestation" | "business_document";
  note: string | null;
  updatedAt: string;
}

interface CountryTaxConfigSummary {
  countryCode: "KE";
  defaultTaxRate: number;
  taxIdLabel: string;
  taxId: string | null;
  pricesIncludeTax: boolean;
  updatedAt: string;
}

interface DeviceTrustSummary {
  deviceId: string;
  level: DeviceTrustLevel;
  reason: string | null;
  updatedAt: string;
}

type BetaAccessStatus = "not_invited" | "active" | "paused";
type BetaFeatureFlagKey =
  | "closed_beta"
  | "offline_hardening"
  | "controlled_payments"
  | "support_intake"
  | "crash_telemetry";
type BetaDeviceClass = "android_1gb" | "android_2gb";
type BetaDeviceTestStatus = "passed" | "failed";
type BetaSupportSeverity = "low" | "medium" | "high" | "critical";
type BetaSupportTicketStatus = "open" | "triaged" | "resolved";
type BetaTelemetryKind = "session" | "crash" | "error";
type BetaReadinessStatus = "blocked" | "needs_review" | "ready";
type LaunchAccessStatus = "closed" | "open" | "paused";
type LaunchChecklistKey =
  | "environment_config"
  | "secrets_ready"
  | "backup_verified"
  | "monitoring_ready"
  | "deploy_verified"
  | "rollback_runbook"
  | "support_coverage";
type LaunchChecklistStatus = "pending" | "passed" | "failed";
type LaunchIncidentSeverity = "low" | "medium" | "high" | "critical";
type LaunchIncidentStatus = "open" | "mitigating" | "resolved";
type LaunchIncidentCategory =
  "onboarding" | "payments" | "sync" | "support" | "telemetry" | "rollback";
type LaunchReadinessStatus = "blocked" | "needs_review" | "ready";

interface BetaAccessSummary {
  status: BetaAccessStatus;
  targetMerchantCount: number;
  invitedMerchantCount: number;
  pauseReason: string | null;
  updatedAt: string;
}

interface BetaFeatureFlagSummary {
  key: BetaFeatureFlagKey;
  enabled: boolean;
  risk: "low" | "medium" | "high";
  reason: string;
  updatedAt: string;
}

interface BetaSupportTicketSummary {
  id: string;
  severity: BetaSupportSeverity;
  status: BetaSupportTicketStatus;
  title: string;
  bodySummary: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface BetaReadinessReportSummary {
  businessId: string;
  generatedAt: string;
  status: BetaReadinessStatus;
  access: BetaAccessSummary;
  featureFlags: BetaFeatureFlagSummary[];
  deviceTesting: {
    passedDeviceClasses: BetaDeviceClass[];
    failedTestCount: number;
  };
  offline: {
    cachedRecordCount: number;
    betaCriticalSurfaceCount: number;
    testedSurfaceCount: number;
  };
  syncStress: {
    syncedMutationCount: number;
    conflictCount: number;
    failedCount: number;
    ready: boolean;
  };
  payments: {
    paymentCount: number;
    reconciliationMismatchCount: number;
    controlledProductionReady: boolean;
  };
  support: {
    openTicketCount: number;
    criticalOpenTicketCount: number;
    documentedSeverityCount: number;
  };
  telemetry: {
    sessionEventCount: number;
    crashEventCount: number;
    errorEventCount: number;
    crashFreeSessionRate: number;
    rawSensitivePayloadCount: number;
  };
  gates: Array<{
    key: string;
    passed: boolean;
    detail: string;
  }>;
}

interface LaunchSettingsSummary {
  status: LaunchAccessStatus;
  publicOnboardingEnabled: boolean;
  rollbackArmed: boolean;
  freezeActive: boolean;
  allowedSignupCount: number;
  pauseReason: string | null;
  updatedAt: string;
}

interface LaunchChecklistItemSummary {
  key: LaunchChecklistKey;
  status: LaunchChecklistStatus;
  evidence: string;
  updatedAt: string;
}

interface LaunchIncidentSummary {
  id: string;
  severity: LaunchIncidentSeverity;
  status: LaunchIncidentStatus;
  category: LaunchIncidentCategory;
  title: string;
  bodySummary: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface LaunchReadinessReportSummary {
  businessId: string;
  generatedAt: string;
  status: LaunchReadinessStatus;
  settings: LaunchSettingsSummary;
  betaStatus: BetaReadinessStatus;
  checklist: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    items: LaunchChecklistItemSummary[];
  };
  onboarding: {
    publicOnboardingEnabled: boolean;
    allowedSignupCount: number;
    firstRunComplete: boolean;
    productCount: number;
    customerCount: number;
    invoiceCount: number;
    paymentCount: number;
  };
  support: {
    openIncidentCount: number;
    criticalOpenIncidentCount: number;
    resolvedIncidentCount: number;
    betaOpenTicketCount: number;
  };
  telemetry: {
    sessionEventCount: number;
    crashEventCount: number;
    errorEventCount: number;
    crashFreeSessionRate: number;
    launchSafePayloadCount: number;
  };
  sync: {
    activeQueueCount: number;
    conflictCount: number;
    failedCount: number;
  };
  payments: {
    paymentCount: number;
    reconciliationMismatchCount: number;
  };
  rollback: {
    rollbackArmed: boolean;
    freezeActive: boolean;
    canPauseOnboarding: boolean;
  };
  gates: Array<{
    key: string;
    passed: boolean;
    detail: string;
  }>;
}

interface ProductFormState {
  id: string | null;
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  buyingPrice: string;
  sellingPrice: string;
}

type ProductFieldInputType = "text" | "number" | "select" | "textarea" | "yes_no";

interface ProductFieldDraft {
  id: string;
  inputType: ProductFieldInputType;
  label: string;
  required: boolean;
  value: string;
}

interface CustomerFormState {
  id: string | null;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

type SupplierFormState = CustomerFormState;

interface InvoiceFormState {
  id: string | null;
  customerId: string;
  customerName: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

interface PaymentFormState {
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  reference: string;
  note: string;
}

interface ImportFormState {
  target: DocumentImportTarget;
  sourceType: "upload" | "paste" | "database";
  sourceLocator: string;
  fileName: string;
  contentType: string;
  content: string;
}

interface LogisticsFormState {
  invoiceId: string;
  method: FulfillmentMethod;
  destination: string;
  note: string;
}

interface ComplianceFormState {
  verificationTier: VerificationTier;
  verificationNote: string;
  defaultTaxRate: string;
  taxId: string;
  pricesIncludeTax: boolean;
  deviceId: string;
  deviceTrustLevel: DeviceTrustLevel;
  deviceTrustReason: string;
  deletionConfirmation: string;
  deletionReason: string;
}

interface BetaFormState {
  accessStatus: BetaAccessStatus;
  invitedMerchantCount: string;
  pauseReason: string;
  deviceClass: BetaDeviceClass;
  deviceWorkflow: string;
  deviceStatus: BetaDeviceTestStatus;
  deviceDurationMs: string;
  supportSeverity: BetaSupportSeverity;
  supportTitle: string;
  supportBody: string;
  telemetryKind: BetaTelemetryKind;
  telemetryMessage: string;
}

interface LaunchFormState {
  status: LaunchAccessStatus;
  publicOnboardingEnabled: boolean;
  rollbackArmed: boolean;
  freezeActive: boolean;
  allowedSignupCount: string;
  pauseReason: string;
  checklistKey: LaunchChecklistKey;
  checklistStatus: LaunchChecklistStatus;
  checklistEvidence: string;
  incidentSeverity: LaunchIncidentSeverity;
  incidentCategory: LaunchIncidentCategory;
  incidentTitle: string;
  incidentBody: string;
}

const apiBaseUrl = readApiBaseUrl();
const buildIdentity = {
  apiBaseUrl,
  appName: __APP_NAME__,
  buildTimestamp: __BUILD_TIMESTAMP__,
  commitSha: __GIT_COMMIT_SHA__,
  environment: __DEPLOYMENT_ENV__,
  version: __APP_VERSION__
};
const showBuildIdentity = import.meta.env.DEV || __DEBUG_UI__;
const activeBusinessStorageKey = "soko.chatFirst.activeBusiness";
const legacyActiveBusinessStorageKey = `soko.c${"p"}3.activeBusiness`;
const activeAgentStorageKey = "soko.chatFirst.agentSettings";
const activeModeStorageKey = "soko.chatFirst.mode";
const ownerAuthStorageKey = "soko.chatFirst.ownerAuth";
const setupDraftStorageKey = "soko.chatFirst.setupDraft";
const pendingOAuthStorageKey = "soko.chatFirst.pendingOAuth";
const contextScriptsPasswordStorageKey = "soko.chatFirst.contextScriptsPassword";

const socialSignupProviders: Array<{
  id: SocialSignupProvider;
  label: string;
  icon: string;
  authRedirectPath: string;
  primary: boolean;
}> = [
  {
    id: "google",
    label: "Gmail",
    icon: "G",
    authRedirectPath: "/auth/oauth/start",
    primary: true
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "f",
    authRedirectPath: "/auth/oauth/start",
    primary: true
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: "TT",
    authRedirectPath: "/auth/oauth/start",
    primary: true
  },
  {
    id: "x",
    label: "X",
    icon: "X",
    authRedirectPath: "/auth/oauth/start",
    primary: false
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "in",
    authRedirectPath: "/auth/oauth/start",
    primary: false
  },
  {
    id: "apple",
    label: "Apple",
    icon: "A",
    authRedirectPath: "/auth/oauth/start",
    primary: false
  },
  {
    id: "github",
    label: "GitHub",
    icon: "GH",
    authRedirectPath: "/auth/oauth/start",
    primary: false
  },
  {
    id: "microsoft",
    label: "Microsoft",
    icon: "MS",
    authRedirectPath: "/auth/oauth/start",
    primary: false
  }
];

const networkSyncProviders: Array<{
  id: NetworkSyncProviderId;
  label: string;
  detail: string;
  icon: string;
  oauthProvider: SocialSignupProvider | null;
}> = [
  {
    id: "phone",
    label: "Phone Contacts",
    detail: "Read contacts with explicit device permission",
    icon: "PH",
    oauthProvider: null
  },
  {
    id: "google",
    label: "Google Contacts",
    detail: "Connect your Google identity",
    icon: "G",
    oauthProvider: "google"
  },
  {
    id: "facebook",
    label: "Facebook Friends",
    detail: "Connect your Meta account",
    icon: "f",
    oauthProvider: "facebook"
  },
  {
    id: "instagram",
    label: "Instagram",
    detail: "Provider graph import is not configured",
    icon: "IG",
    oauthProvider: null
  },
  {
    id: "x",
    label: "X",
    detail: "OAuth flow is pending backend implementation",
    icon: "X",
    oauthProvider: "x"
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    detail: "Connect your LinkedIn identity",
    icon: "in",
    oauthProvider: "linkedin"
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    detail: "Connect where platform APIs permit",
    icon: "WA",
    oauthProvider: null
  },
  {
    id: "other",
    label: "Other Provider",
    detail: "Additional providers will appear here",
    icon: "+",
    oauthProvider: null
  }
];

const defaultAgentContextScripts = [
  [
    "script: product_catalogue_commands",
    "scope: products",
    "allow: read, add, edit, remove",
    "en: show products => list existing catalogue before suggesting changes",
    "en: add product <name> => open product card and request missing stock or price fields",
    "en: edit product <name> => find closest product, open edit card, confirm changes",
    "en: remove product <name> => find closest product, require confirmation before delete",
    "sw: bidhaa => products",
    "sw: ongeza bidhaa => add product",
    "sw: hariri bidhaa => edit product",
    "sw: toa bidhaa => remove product"
  ].join("\n"),
  [
    "script: local_language_negotiation",
    "scope: storefront_conversation",
    "allow: explain, negotiate, request_confirmation",
    "en: negotiate politely, protect the owner's margin, and offer alternatives",
    "sw: salimia mteja, eleza bei kwa heshima, toa punguzo tu ikiwa mmiliki ameruhusu",
    "sheng: keep tone friendly but do not invent discounts",
    "rule: never finalize a discount, delivery promise, refund, or payment without owner confirmation"
  ].join("\n")
];

const countryDialCodes: Array<{
  code: CountryDialCode;
  country: string;
  flag: string;
  suffixLength: number;
}> = [
  { code: "+254", country: "Kenya", flag: "KE", suffixLength: 9 },
  { code: "+1", country: "United States", flag: "US", suffixLength: 10 },
  { code: "+44", country: "United Kingdom", flag: "UK", suffixLength: 10 },
  { code: "+234", country: "Nigeria", flag: "NG", suffixLength: 10 },
  { code: "+27", country: "South Africa", flag: "ZA", suffixLength: 9 },
  { code: "+255", country: "Tanzania", flag: "TZ", suffixLength: 9 },
  { code: "+256", country: "Uganda", flag: "UG", suffixLength: 9 },
  { code: "+250", country: "Rwanda", flag: "RW", suffixLength: 9 }
];

const emptyProductForm: ProductFormState = {
  id: null,
  name: "",
  sku: "",
  unit: "unit",
  quantity: "0",
  buyingPrice: "",
  sellingPrice: ""
};

const emptyCustomerForm: CustomerFormState = {
  id: null,
  name: "",
  phone: "",
  email: "",
  notes: ""
};

const emptySupplierForm: SupplierFormState = {
  id: null,
  name: "",
  phone: "",
  email: "",
  notes: ""
};

const emptyInvoiceForm: InvoiceFormState = {
  id: null,
  customerId: "",
  customerName: "",
  productId: "",
  quantity: "1",
  unitPrice: "0",
  taxRate: "0"
};

const emptyPaymentForm: PaymentFormState = {
  invoiceId: "",
  amount: "",
  method: "cash",
  reference: "",
  note: ""
};

const emptyImportForm: ImportFormState = {
  target: "product",
  sourceType: "upload",
  sourceLocator: "",
  fileName: "products.csv",
  contentType: "text/csv",
  content: "name,sku,unit,quantity,buyingPrice,sellingPrice\nTomatoes,TOM-001,kg,20,60,90"
};

const emptyLogisticsForm: LogisticsFormState = {
  invoiceId: "",
  method: "delivery",
  destination: "",
  note: ""
};

const emptyComplianceForm: ComplianceFormState = {
  verificationTier: "unverified",
  verificationNote: "",
  defaultTaxRate: "0.16",
  taxId: "",
  pricesIncludeTax: false,
  deviceId: "browser-session",
  deviceTrustLevel: "unknown",
  deviceTrustReason: "",
  deletionConfirmation: "",
  deletionReason: ""
};

const emptyBetaForm: BetaFormState = {
  accessStatus: "not_invited",
  invitedMerchantCount: "1",
  pauseReason: "",
  deviceClass: "android_1gb",
  deviceWorkflow: "daily owner workflow",
  deviceStatus: "passed",
  deviceDurationMs: "90000",
  supportSeverity: "medium",
  supportTitle: "Beta support rehearsal",
  supportBody: "Operator can triage and resolve beta support issues.",
  telemetryKind: "session",
  telemetryMessage: "beta session completed"
};

const emptyLaunchForm: LaunchFormState = {
  status: "closed",
  publicOnboardingEnabled: false,
  rollbackArmed: true,
  freezeActive: true,
  allowedSignupCount: "0",
  pauseReason: "Public launch is closed until launch gates pass.",
  checklistKey: "environment_config",
  checklistStatus: "passed",
  checklistEvidence: "Verified for public launch.",
  incidentSeverity: "medium",
  incidentCategory: "onboarding",
  incidentTitle: "Launch support rehearsal",
  incidentBody: "Operator can triage and resolve public launch incidents."
};

const emptySyncSummary: SyncQueueSummary = {
  businessId: "",
  pending: 0,
  processing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
  total: 0
};

const emptyNotificationSummary: NotificationInboxSummary = {
  businessId: "",
  unread: 0,
  read: 0,
  archived: 0,
  total: 0
};

function App() {
  useEffect(() => {
    registerAppServiceWorker();
  }, []);

  const storefrontAgentId = readStorefrontAgentId();

  if (storefrontAgentId !== null) {
    return <PublicStorefrontChat agentId={storefrontAgentId} />;
  }

  if (window.location.pathname === "/terms") {
    return (
      <LegalPlaceholder
        title="Terms of Service"
        body="Soko.market terms are being prepared. Continue only if you agree to use the service responsibly and follow applicable commerce laws."
      />
    );
  }

  if (window.location.pathname === "/privacy") {
    return (
      <LegalPlaceholder
        title="Privacy Policy"
        body="Soko.market privacy details are being prepared. Account, shop, contact, and transaction data are used to operate your retail workspace."
      />
    );
  }

  return <OwnerApp />;
}

function BuildIdentity() {
  if (!showBuildIdentity) {
    return null;
  }

  return (
    <span className="build-identity">
      {buildIdentity.environment} · v{buildIdentity.version} ·{" "}
      {formatShortCommit(buildIdentity.commitSha)} · built {buildIdentity.buildTimestamp}
    </span>
  );
}

function readApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL;

  if (configuredUrl !== undefined && configuredUrl.trim() !== "") {
    return configuredUrl.trim().replace(/\/+$/, "");
  }

  if (import.meta.env.PROD) {
    console.error("Soko.market frontend is missing VITE_API_BASE_URL; backend requests will fail.");
    return "";
  }

  return "http://127.0.0.1:4000";
}

function formatShortCommit(commitSha: string): string {
  return commitSha === "local" ? "local" : commitSha.slice(0, 7);
}

function LegalPlaceholder(props: { title: string; body: string }) {
  return (
    <Surface title={`Soko.market ${props.title}`}>
      <main className="legal-placeholder">
        <a href="/" aria-label="Back to soko.market">
          soko.market
        </a>
        <section className="panel">
          <p className="eyebrow">soko.market</p>
          <h1>{props.title}</h1>
          <p>{props.body}</p>
        </section>
      </main>
    </Surface>
  );
}

function OwnerApp() {
  const initialSetupDraft = readSetupDraft();
  const initialBusiness = readStoredBusiness();
  const initialOwnerAuth = readStoredOwnerAuth();
  const [channel, setChannel] = useState<AuthChannel>(
    initialOwnerAuth === null
      ? (initialSetupDraft?.channel ?? "phone")
      : initialOwnerAuth.contact.includes("@")
        ? "email"
        : "phone"
  );
  const [countryCode, setCountryCode] = useState<CountryDialCode>(
    initialOwnerAuth?.countryCode ??
      initialSetupDraft?.countryCode ??
      inferCountryCode(initialSetupDraft?.destination ?? "") ??
      "+254"
  );
  const [destination, setDestination] = useState(
    initialOwnerAuth !== null
      ? initialOwnerAuth.contact.includes("@")
        ? initialOwnerAuth.contact
        : stripDialCode(initialOwnerAuth.contact, initialOwnerAuth.countryCode)
      : initialSetupDraft?.channel === "phone"
        ? stripDialCode(initialSetupDraft.destination, initialSetupDraft.countryCode)
        : (initialSetupDraft?.destination ?? "")
  );
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);
  const [otp, setOtp] = useState("");
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [signupPin, setSignupPin] = useState("");
  const [signupPinConfirm, setSignupPinConfirm] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [isRecoveringPin, setIsRecoveringPin] = useState(false);
  const [hasLoginPin, setHasLoginPin] = useState(initialOwnerAuth?.pinSet ?? true);
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryPinConfirm, setRecoveryPinConfirm] = useState("");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderSummary[]>([]);
  const [oauthProvidersLoaded, setOauthProvidersLoaded] = useState(false);
  const [isOtherSocialOpen, setIsOtherSocialOpen] = useState(false);
  const [businessName, setBusinessName] = useState(initialSetupDraft?.businessName ?? "");
  const [language, setLanguage] = useState<SupportedLanguage>(initialSetupDraft?.language ?? "en");
  const [business, setBusiness] = useState<ActiveBusiness | null>(initialBusiness);
  const [ownerAuth, setOwnerAuth] = useState<OwnerAuthRecord | null>(initialOwnerAuth);
  const [isWorkspaceUnlocked, setIsWorkspaceUnlocked] = useState(initialOwnerAuth === null);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(
    () => readStoredAgent() ?? createDefaultAgent(initialBusiness)
  );
  const [statusMessage, setStatusMessage] = useState("Checking session");
  const [view, setView] = useState<ShellView>("chat");
  const [mode, setMode] = useState<SokoMode>(readStoredSokoMode);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [shopPresenceStatus, setShopPresenceStatus] = useState<ShopPresenceStatus>("online");
  const [isWorkspacePanelOpen, setIsWorkspacePanelOpen] = useState(false);
  const [isBusinessSetupOpen, setIsBusinessSetupOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [runtimeSessionId, setRuntimeSessionId] = useState<string | null>(null);
  const [clarificationCount, setClarificationCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    createInitialChatMessages(initialBusiness?.name ?? "Soko.market")
  );
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierBusinessCardSummary[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [logistics, setLogistics] = useState<LogisticsSummary[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<InvoicePaymentSummary[]>([]);
  const [customerDebts, setCustomerDebts] = useState<CustomerDebtSummary[]>([]);
  const [importJobs, setImportJobs] = useState<DocumentImportJobSummary[]>([]);
  const [selectedImportJobId, setSelectedImportJobId] = useState<string | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [syncSummary, setSyncSummary] = useState<SyncQueueSummary>(emptySyncSummary);
  const [offlineCache, setOfflineCache] = useState<OfflineCacheSnapshot | null>(null);
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeSessionSummary[]>([]);
  const [selectedRuntimeHistorySessionId, setSelectedRuntimeHistorySessionId] = useState<
    string | null
  >(null);
  const [runtimeTurns, setRuntimeTurns] = useState<RuntimeTurnSummary[]>([]);
  const [networkGraph, setNetworkGraph] = useState<NetworkGraphSummary | null>(null);
  const [reportSummary, setReportSummary] = useState<BusinessReportSummary | null>(null);
  const [knowledgeSummary, setKnowledgeSummary] = useState<BusinessKnowledgeSummary | null>(null);
  const [notificationInbox, setNotificationInbox] = useState<NotificationInbox>({
    summary: emptyNotificationSummary,
    notifications: []
  });
  const [securityReview, setSecurityReview] = useState<SecurityReviewSummary | null>(null);
  const [dataExport, setDataExport] = useState<DataExportBundle | null>(null);
  const [accountDeletion, setAccountDeletion] = useState<AccountDeletionRequestSummary | null>(
    null
  );
  const [verificationTier, setVerificationTier] = useState<VerificationTierSummary | null>(null);
  const [taxConfig, setTaxConfig] = useState<CountryTaxConfigSummary | null>(null);
  const [deviceTrust, setDeviceTrust] = useState<DeviceTrustSummary | null>(null);
  const [betaReadiness, setBetaReadiness] = useState<BetaReadinessReportSummary | null>(null);
  const [betaSupportTickets, setBetaSupportTickets] = useState<BetaSupportTicketSummary[]>([]);
  const [launchReadiness, setLaunchReadiness] = useState<LaunchReadinessReportSummary | null>(null);
  const [launchIncidents, setLaunchIncidents] = useState<LaunchIncidentSummary[]>([]);
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [supplierForm, setSupplierForm] = useState<SupplierFormState>(emptySupplierForm);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(emptyPaymentForm);
  const [importForm, setImportForm] = useState<ImportFormState>(emptyImportForm);
  const [logisticsForm, setLogisticsForm] = useState<LogisticsFormState>(emptyLogisticsForm);
  const [complianceForm, setComplianceForm] = useState<ComplianceFormState>(emptyComplianceForm);
  const [betaForm, setBetaForm] = useState<BetaFormState>(emptyBetaForm);
  const [launchForm, setLaunchForm] = useState<LaunchFormState>(emptyLaunchForm);
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreview | null>(null);
  const [stockProductId, setStockProductId] = useState("");
  const [stockQuantityAfter, setStockQuantityAfter] = useState("0");
  const [stockReason, setStockReason] = useState("Manual stock count");

  const shouldShowLogin = ownerAuth !== null && !isWorkspaceUnlocked;
  const setupComplete = business !== null && !shouldShowLogin;
  const shouldShowSignup = business === null && ownerAuth === null;
  const isAuthScreen = shouldShowSignup || shouldShowLogin;
  const publicStorefrontUrl = business === null ? "" : createPublicStorefrontUrl(business);
  const userLabel = session?.user.displayName ?? "Signed out";
  const activeImportJob =
    importJobs.find((job) => job.id === selectedImportJobId) ?? importJobs[0] ?? null;

  useEffect(() => {
    void loadOAuthProviders();
    void handleOAuthCallback().then((handled) => {
      if (!handled) {
        void refreshSession();
      }
    });
  }, []);

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine);
    }

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(activeAgentStorageKey, JSON.stringify(agentSettings));
  }, [agentSettings]);

  useEffect(() => {
    localStorage.setItem(activeModeStorageKey, mode);
  }, [mode]);

  useEffect(() => {
    if (session === null || globalThis.indexedDB === undefined) {
      return;
    }

    let cancelled = false;
    let closeRepository: (() => void) | undefined;
    let closeRealtime: (() => void) | undefined;
    let catchUpPromise: Promise<void> | null = null;
    void openIndexedDbSyncRepository()
      .then(async (repository) => {
        if (cancelled) {
          repository.close();
          return;
        }
        closeRepository = () => repository.close();
        const catchUp = () => {
          if (catchUpPromise === null) {
            catchUpPromise = catchUpAccountSync({
              accountId: session.account.id,
              repository,
              endpoint: `${apiBaseUrl}/v1/sync/changes`
            })
              .then(() => undefined)
              .finally(() => {
                catchUpPromise = null;
              });
          }
          return catchUpPromise;
        };
        await catchUp();
        if (!cancelled) {
          const realtimeUrl = new URL("/v1/realtime", apiBaseUrl);
          realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";
          closeRealtime = subscribeToAccountRealtime({
            accountId: session.account.id,
            endpoint: realtimeUrl.toString(),
            onChangesAvailable: catchUp
          });
        }
      })
      .catch(() => {
        if (!cancelled && !navigator.onLine) {
          setStatusMessage("Offline data loaded; catch-up will resume when connected");
        }
      });

    return () => {
      cancelled = true;
      closeRealtime?.();
      closeRepository?.();
    };
  }, [session?.account.id]);

  useEffect(() => {
    if (business !== null) {
      localStorage.removeItem(setupDraftStorageKey);
      return;
    }

    const draft: SetupDraft = {
      channel,
      countryCode,
      destination,
      businessName,
      language,
      completedStep: session === null ? 0 : 1
    };
    localStorage.setItem(setupDraftStorageKey, JSON.stringify(draft));
  }, [business, businessName, channel, countryCode, destination, language, session]);

  useEffect(() => {
    if (business !== null) {
      setAgentSettings((agent) => {
        const defaultAgent = createDefaultAgent(business);

        if (agent.globalAgentId.length === 0) {
          return defaultAgent;
        }

        if (
          agent.globalAgentId === defaultAgent.globalAgentId &&
          agent.storefrontUrl === defaultAgent.storefrontUrl
        ) {
          return agent;
        }

        return {
          ...agent,
          globalAgentId: defaultAgent.globalAgentId,
          storefrontUrl: defaultAgent.storefrontUrl
        };
      });
      setChatMessages((messages) =>
        messages[0]?.id === "welcome"
          ? createInitialChatMessages(business.name)
          : [
              createInitialChatMessages(business.name)[0] as ChatMessage,
              ...messages.filter((message) => message.id !== "welcome")
            ]
      );
    }
  }, [business]);

  useEffect(() => {
    if (!setupComplete || business === null) {
      return;
    }

    if (view === "chat") {
      void loadProducts(business.id);
      void loadSuppliers(business.id);
      void loadCustomers(business.id);
      void loadInvoices(business.id);
      void loadSyncQueue(business.id);
      void loadReports(business.id);
      void loadNotifications(business.id);
      void loadRuntimeSessions(business.id);
    }

    if (view === "products") {
      void loadProducts(business.id);
    }

    if (view === "suppliers") {
      void loadSuppliers(business.id);
    }

    if (view === "customers") {
      void loadCustomers(business.id);
    }

    if (view === "invoices") {
      void loadProducts(business.id);
      void loadCustomers(business.id);
      void loadInvoices(business.id);
    }

    if (view === "home" || view === "sync") {
      void loadSyncQueue(business.id);
      void loadOfflineCache(business.id);
    }

    if (view === "chat" || view === "home" || view === "network") {
      void loadNetworkGraph();
    }

    if (view === "runtime") {
      void loadRuntimeSessions(business.id);
    }

    if (view === "home" || view === "reports") {
      void loadReports(business.id);
    }

    if (view === "home" || view === "notifications") {
      void loadNotifications(business.id);
    }

    if (view === "payments") {
      void loadInvoices(business.id);
      void loadPaymentData(business.id);
    }

    if (view === "imports") {
      void loadDocumentImports(business.id);
      void loadSuppliers(business.id);
      void loadProducts(business.id);
    }

    if (view === "logistics") {
      void loadInvoices(business.id);
      void loadLogistics(business.id);
    }

    if (view === "compliance") {
      void loadCompliance(business.id);
    }

    if (view === "home" || view === "beta") {
      void loadBetaReadiness(business.id);
    }

    if (view === "home" || view === "launch") {
      void loadLaunchReadiness(business.id);
    }
  }, [business, setupComplete, view]);

  async function handleOAuthCallback(): Promise<boolean> {
    if (window.location.pathname !== "/auth/oauth/callback") {
      return false;
    }

    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code");
    const state = parameters.get("state");
    const pendingOAuth = readPendingOAuthLogin();

    if (code === null || state === null || pendingOAuth === null || state !== pendingOAuth.state) {
      setStatusMessage("Social sign-in could not be verified. Please try again.");
      sessionStorage.removeItem(pendingOAuthStorageKey);
      window.history.replaceState({}, document.title, "/");
      return true;
    }

    try {
      const response = await postJson<SessionResponse>("/auth/oauth/callback", {
        provider: pendingOAuth.provider,
        state,
        code,
        csrfToken: pendingOAuth.csrfToken
      });
      sessionStorage.removeItem(pendingOAuthStorageKey);
      window.history.replaceState({}, document.title, "/");
      await completeOAuthSession(response, pendingOAuth.provider);
    } catch (error) {
      sessionStorage.removeItem(pendingOAuthStorageKey);
      window.history.replaceState({}, document.title, "/");
      setStatusMessage(getErrorMessage(error));
    }

    return true;
  }

  async function loadOAuthProviders() {
    try {
      const response = await getJson<OAuthProvidersResponse>("/auth/oauth/providers");
      setOauthProviders(response.providers);
    } catch {
      setOauthProviders([]);
    } finally {
      setOauthProvidersLoaded(true);
    }
  }

  async function completeOAuthSession(response: SessionResponse, provider: SocialSignupProvider) {
    const selectedProvider = socialSignupProviders.find((item) => item.id === provider);
    setSession(response);
    setChallenge(null);
    setOtp("");
    setIsOtpVerified(true);

    if (business !== null) {
      const roleCheck = await postJson<RoleCheckResponse>("/roles/check", {
        businessId: business.id,
        role: "owner"
      });

      if (!roleCheck.allowed) {
        setStatusMessage("This social profile is not linked to this Soko shop yet");
        return;
      }

      const nextOwnerAuth: OwnerAuthRecord = {
        contact: `oauth:${provider}:${response.account.id}`,
        countryCode,
        pinSet: true,
        provider
      };
      setOwnerAuth(nextOwnerAuth);
      localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
      setIsWorkspaceUnlocked(true);
      setView("chat");
      setStatusMessage(`${selectedProvider?.label ?? "Social"} login complete`);
      return;
    }

    const nextOwnerAuth: OwnerAuthRecord = {
      contact: `oauth:${provider}:${response.account.id}`,
      countryCode,
      pinSet: true,
      provider
    };
    setOwnerAuth(nextOwnerAuth);
    localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
    localStorage.removeItem(setupDraftStorageKey);
    setIsWorkspaceUnlocked(true);
    setMode("marketplace");
    setView("chat");
    setStatusMessage(
      `${selectedProvider?.label ?? "Social"} signup complete. Browse the marketplace or tap Sell to set up a business.`
    );
  }

  async function refreshSession() {
    try {
      const response = await fetch(`${apiBaseUrl}/session`, {
        credentials: "include"
      });

      if (response.ok) {
        const nextSession = (await response.json()) as SessionResponse;
        setSession(nextSession);
        setStatusMessage("Session active");
        await validateStoredBusiness();
        return;
      }

      setSession(null);
      if (readStoredBusiness() === null) {
        setBusiness(null);
        setStatusMessage("Sign in to continue");
        return;
      }

      setStatusMessage("Saved workspace loaded");
    } catch {
      setStatusMessage(
        readStoredBusiness() === null ? "API unavailable" : "Saved workspace loaded"
      );
    }
  }

  async function validateStoredBusiness() {
    const storedBusiness = readStoredBusiness();

    if (storedBusiness === null) {
      return;
    }

    try {
      const roleCheck = await postJson<RoleCheckResponse>("/roles/check", {
        businessId: storedBusiness.id,
        role: "owner"
      });

      if (roleCheck.allowed) {
        setBusiness(storedBusiness);
        setStatusMessage("Owner shell active");
        return;
      }
    } catch {
      // Local development uses an in-memory API store; stale cached business views are expected after restarts.
    }

    setBusiness(storedBusiness);
    setStatusMessage("Saved workspace loaded");
  }

  async function requestOtp() {
    const contactValue = composeSignupContact(channel, countryCode, destination);

    if (!isSignupContactValid(channel, countryCode, destination)) {
      setStatusMessage(
        channel === "email" ? "Enter a valid email address" : "Enter a valid phone number"
      );
      return;
    }

    try {
      const response = await postJson<OtpRequestResponse>("/auth/otp/request", {
        method: channel,
        contact: contactValue
      });
      setChallenge(response);
      setOtp(response.devOtp ?? "");
      setIsOtpVerified(false);
      setStatusMessage(`OTP sent to ${response.destination}`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function verifyOtp() {
    if (challenge === null) {
      setStatusMessage("Request an OTP first");
      return;
    }

    const contactValue = composeSignupContact(channel, countryCode, destination);

    if (!isSignupContactValid(channel, countryCode, destination)) {
      setStatusMessage(
        channel === "email" ? "Enter a valid email address" : "Enter a valid phone number"
      );
      return;
    }

    try {
      const response = await postJson<SessionResponse>("/auth/otp/verify", {
        method: channel,
        contact: contactValue,
        otp
      });
      setSession(response);
      setIsOtpVerified(true);
      const pinStatus = await getJson<PinStatusResponse>("/auth/pin/status");
      setHasLoginPin(pinStatus.hasPin);

      if (pinStatus.hasPin) {
        const nextOwnerAuth: OwnerAuthRecord = {
          contact: contactValue,
          countryCode,
          pinSet: true
        };
        setOwnerAuth(nextOwnerAuth);
        setIsWorkspaceUnlocked(true);
        setMode("marketplace");
        setView("chat");
        localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
        localStorage.removeItem(setupDraftStorageKey);
        setStatusMessage(
          "Login complete. Browse the marketplace or tap Sell to set up a business."
        );
        return;
      }

      setStatusMessage("OTP verified. Create your login PIN to finish signup.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function authenticateSocialProfile(provider: SocialSignupProvider) {
    const selectedProvider = socialSignupProviders.find((item) => item.id === provider);
    const providerConfig = oauthProviders.find((item) => item.id === provider);

    if (!oauthProvidersLoaded) {
      setStatusMessage("Social sign-in is still loading. Try again in a moment.");
      return;
    }

    if (providerConfig?.implemented === false || providerConfig?.configured !== true) {
      setStatusMessage("This login provider is not configured yet.");
      return;
    }

    try {
      const response = await postJson<OAuthStartResponse>("/auth/oauth/start", {
        provider,
        redirectUri: `${window.location.origin}/auth/oauth/callback`
      });
      const pendingOAuth: PendingOAuthLogin = {
        csrfToken: response.csrfToken,
        provider: response.provider,
        state: response.state
      };
      sessionStorage.setItem(pendingOAuthStorageKey, JSON.stringify(pendingOAuth));
      setIsOtherSocialOpen(false);
      setStatusMessage(
        `Redirecting to ${selectedProvider?.label ?? "social"} to continue with your account.`
      );
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function updateOwnerPinSet(pinSet: boolean) {
    setHasLoginPin(pinSet);
    setOwnerAuth((current) => {
      if (current === null) {
        return current;
      }

      const next = {
        ...current,
        pinSet
      };
      localStorage.setItem(ownerAuthStorageKey, JSON.stringify(next));
      return next;
    });
  }

  async function requestLoginOtp() {
    const contactValue = composeSignupContact(channel, countryCode, destination);

    if (!isSignupContactValid(channel, countryCode, destination)) {
      setStatusMessage(
        channel === "email" ? "Enter a valid email address" : "Enter a valid phone number"
      );
      return;
    }

    try {
      const response = await postJson<OtpRequestResponse>("/auth/otp/request", {
        method: channel,
        contact: contactValue
      });
      setChallenge(response);
      setOtp(response.devOtp ?? "");
      setIsOtpVerified(false);
      setStatusMessage(`OTP sent to ${response.destination}`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function verifyLoginOtp() {
    if (challenge === null) {
      setStatusMessage("Request an OTP first");
      return;
    }

    const contactValue = composeSignupContact(channel, countryCode, destination);

    if (!isSignupContactValid(channel, countryCode, destination)) {
      setStatusMessage(
        channel === "email" ? "Enter a valid email address" : "Enter a valid phone number"
      );
      return;
    }

    try {
      const response = await postJson<SessionResponse>("/auth/otp/verify", {
        method: channel,
        contact: contactValue,
        otp
      });
      setSession(response);
      const pinStatus = await getJson<PinStatusResponse>("/auth/pin/status");
      updateOwnerPinSet(pinStatus.hasPin);
      if (!pinStatus.hasPin) {
        setIsRecoveringPin(false);
      }
      setIsOtpVerified(true);
      setStatusMessage(
        pinStatus.hasPin
          ? isRecoveringPin
            ? "OTP verified. Reset your login PIN."
            : "OTP verified. Enter your login PIN."
          : "OTP verified. Set your login PIN once."
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function startPinRecovery() {
    setIsRecoveringPin(true);
    setChallenge(null);
    setOtp("");
    setIsOtpVerified(false);
    setLoginPin("");
    setRecoveryPin("");
    setRecoveryPinConfirm("");
    setStatusMessage("Verify your account with OTP, then set a new PIN.");
  }

  function cancelPinRecovery() {
    setIsRecoveringPin(false);
    setChallenge(null);
    setOtp("");
    setIsOtpVerified(false);
    setRecoveryPin("");
    setRecoveryPinConfirm("");
    setStatusMessage("Enter your login contact and PIN.");
  }

  async function loginWithPin() {
    if (ownerAuth === null) {
      setStatusMessage("No saved owner PIN found");
      return;
    }

    const contactValue = composeSignupContact(channel, countryCode, destination);

    if (contactValue !== ownerAuth.contact) {
      setStatusMessage("Contact does not match this account");
      return;
    }

    if (!isValidPin(loginPin)) {
      setStatusMessage("Enter your 4-digit PIN");
      return;
    }

    try {
      const response = await postJson<SessionResponse>("/auth/pin/login", {
        method: channel,
        contact: contactValue,
        pin: loginPin
      });
      setSession(response);
      updateOwnerPinSet(true);
      setIsWorkspaceUnlocked(true);
      setIsOtpVerified(false);
      setLoginPin("");
      setView("chat");
      setStatusMessage("Login complete");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function recoverLoginPin() {
    if (ownerAuth === null) {
      setStatusMessage("No saved owner account found");
      return;
    }

    const contactValue = composeSignupContact(channel, countryCode, destination);

    if (contactValue !== ownerAuth.contact) {
      setStatusMessage("Contact does not match this account");
      return;
    }

    if (!isOtpVerified) {
      setStatusMessage("Verify OTP before resetting your PIN");
      return;
    }

    if (!isValidPin(recoveryPin) || recoveryPin !== recoveryPinConfirm) {
      setStatusMessage("Enter and confirm a new 4-digit PIN");
      return;
    }

    try {
      await postJson<SessionResponse>("/auth/pin/recover", {
        pin: recoveryPin
      });
      setIsWorkspaceUnlocked(true);
      setIsRecoveringPin(false);
      setLoginPin("");
      setRecoveryPin("");
      setRecoveryPinConfirm("");
      setView("chat");
      setStatusMessage("PIN reset. Login complete");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function setMissingLoginPin() {
    if (!isOtpVerified) {
      setStatusMessage("Verify OTP before setting your PIN");
      return;
    }

    if (!isValidPin(recoveryPin) || recoveryPin !== recoveryPinConfirm) {
      setStatusMessage("Enter and confirm a 4-digit PIN");
      return;
    }

    try {
      await postJson<SessionResponse>("/auth/pin/setup", {
        pin: recoveryPin
      });
      updateOwnerPinSet(true);
      setIsWorkspaceUnlocked(true);
      setIsRecoveringPin(false);
      setLoginPin("");
      setRecoveryPin("");
      setRecoveryPinConfirm("");
      setView("chat");
      setStatusMessage("PIN set. Login complete");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function completeSignup() {
    if (session === null || !isOtpVerified) {
      setStatusMessage("Verify your account before finishing signup");
      return;
    }

    if (!isValidPin(signupPin) || signupPin !== signupPinConfirm) {
      setStatusMessage("Enter and confirm a 4-digit PIN");
      return;
    }

    try {
      await postJson<SessionResponse>("/auth/pin/setup", {
        pin: signupPin
      });
      const contactValue =
        channel === "email"
          ? destination.trim().toLowerCase()
          : composeSignupContact(channel, countryCode, destination);
      const nextOwnerAuth: OwnerAuthRecord = {
        contact: contactValue,
        countryCode,
        pinSet: true
      };
      setOwnerAuth(nextOwnerAuth);
      setHasLoginPin(true);
      setIsWorkspaceUnlocked(true);
      setSignupPin("");
      setSignupPinConfirm("");
      setMode("marketplace");
      setView("chat");
      localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
      localStorage.removeItem(setupDraftStorageKey);
      setStatusMessage("Signup complete. Browse the marketplace or tap Sell to set up a business.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createBusiness() {
    if (businessName.trim().length === 0) {
      setStatusMessage("Business name is required");
      return;
    }

    if (session === null) {
      setStatusMessage("Sign up or log in before setting up a business");
      return;
    }

    try {
      const response = await postJson<BusinessResponse>("/businesses", {
        name: businessName.trim(),
        language
      });
      const nextBusiness = {
        ...response.business,
        role: response.membership.role
      };
      const nextAgent = createDefaultAgent(nextBusiness);
      setBusiness(nextBusiness);
      setAgentSettings(nextAgent);
      setIsWorkspaceUnlocked(true);
      setIsBusinessSetupOpen(false);
      setMode("seller");
      localStorage.setItem(activeBusinessStorageKey, JSON.stringify(nextBusiness));
      localStorage.removeItem(legacyActiveBusinessStorageKey);
      localStorage.setItem(activeAgentStorageKey, JSON.stringify(nextAgent));
      localStorage.removeItem(setupDraftStorageKey);
      await refreshSession();
      setView("chat");
      setStatusMessage("Business ready. Seller controls are now active.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadProducts(businessId: string) {
    try {
      const response = await getJson<ProductSummary[]>(`/businesses/${businessId}/products`);
      setProducts(response);
      if (stockProductId.length === 0 && response[0] !== undefined) {
        setStockProductId(response[0].id);
        setStockQuantityAfter(String(response[0].quantity));
      }
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveProduct() {
    if (business === null) {
      return;
    }

    try {
      const payload = {
        name: productForm.name,
        sku: productForm.sku,
        unit: productForm.unit,
        quantity: Number(productForm.quantity),
        buyingPrice:
          productForm.buyingPrice.trim().length === 0 ? null : Number(productForm.buyingPrice),
        sellingPrice:
          productForm.sellingPrice.trim().length === 0 ? null : Number(productForm.sellingPrice)
      };
      const product =
        productForm.id === null
          ? await postJson<ProductSummary>(`/businesses/${business.id}/products`, payload)
          : await patchJson<ProductSummary>(
              `/businesses/${business.id}/products/${productForm.id}`,
              payload
            );

      setProductForm(emptyProductForm);
      setStockProductId(product.id);
      setStockQuantityAfter(String(product.quantity));
      await loadProducts(business.id);
      setStatusMessage(productForm.id === null ? "Product created" : "Product updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function deleteProduct(productId: string) {
    if (business === null) {
      return;
    }

    try {
      const product = await deleteJson<ProductSummary>(
        `/businesses/${business.id}/products/${productId}`
      );

      if (productForm.id === product.id) {
        setProductForm(emptyProductForm);
      }

      if (stockProductId === product.id) {
        setStockProductId("");
        setStockQuantityAfter("");
      }

      await loadProducts(business.id);
      setStatusMessage("Product removed");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function adjustStock() {
    if (business === null || stockProductId.length === 0) {
      return;
    }

    try {
      const response = await postJson<StockAdjustmentResponse>(
        `/businesses/${business.id}/products/${stockProductId}/stock-adjustments`,
        {
          quantityAfter: Number(stockQuantityAfter),
          reason: stockReason
        }
      );
      await loadProducts(business.id);
      setStockQuantityAfter(String(response.product.quantity));
      setStatusMessage("Stock adjusted");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveProductFieldStructure(fields: ProductFieldDraft[]) {
    if (business === null) {
      return;
    }

    try {
      await postJson<{ code: string; message: string }>(
        `/businesses/${business.id}/products/fields`,
        {
          fields
        }
      );
      setStatusMessage("Product field structure saved");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadCustomers(businessId: string) {
    try {
      setCustomers(await getJson<CustomerSummary[]>(`/businesses/${businessId}/customers`));
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadSuppliers(businessId: string) {
    try {
      setSuppliers(
        await getJson<SupplierBusinessCardSummary[]>(`/businesses/${businessId}/suppliers`)
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveSupplier() {
    if (business === null) {
      return;
    }

    try {
      const payload = {
        name: supplierForm.name,
        phone: supplierForm.phone,
        email: supplierForm.email,
        notes: supplierForm.notes
      };

      if (supplierForm.id === null) {
        await postJson<SupplierSummary>(`/businesses/${business.id}/suppliers`, payload);
      } else {
        await patchJson<SupplierSummary>(
          `/businesses/${business.id}/suppliers/${supplierForm.id}`,
          payload
        );
      }

      setSupplierForm(emptySupplierForm);
      await loadSuppliers(business.id);
      await loadReports(business.id);
      setStatusMessage(supplierForm.id === null ? "Supplier created" : "Supplier updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function deleteSupplierCard(supplierId: string) {
    if (business === null) {
      return;
    }

    try {
      await deleteJson<{ deleted: true; supplierId: string }>(
        `/businesses/${business.id}/suppliers/${supplierId}`
      );
      await loadSuppliers(business.id);
      await loadReports(business.id);
      setStatusMessage("Supplier deleted");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveSalesAgent(supplierId: string, agent: SupplierFormState) {
    if (business === null) {
      return;
    }

    try {
      const payload = {
        name: agent.name,
        phone: agent.phone,
        email: agent.email,
        notes: agent.notes
      };

      if (agent.id === null) {
        await postJson<SalesAgentSummary>(
          `/businesses/${business.id}/suppliers/${supplierId}/sales-agents`,
          payload
        );
      } else {
        await patchJson<SalesAgentSummary>(
          `/businesses/${business.id}/suppliers/${supplierId}/sales-agents/${agent.id}`,
          payload
        );
      }

      await loadSuppliers(business.id);
      setStatusMessage(agent.id === null ? "Sales agent added" : "Sales agent updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function deleteSalesAgentCard(supplierId: string, salesAgentId: string) {
    if (business === null) {
      return;
    }

    try {
      await deleteJson<{ deleted: true; salesAgentId: string }>(
        `/businesses/${business.id}/suppliers/${supplierId}/sales-agents/${salesAgentId}`
      );
      await loadSuppliers(business.id);
      setStatusMessage("Sales agent deleted");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function searchSupplierContacts(query: string): Promise<NetworkNodeSummary[]> {
    if (business === null) {
      return [];
    }

    try {
      return await getJson<NetworkNodeSummary[]>(
        `/businesses/${business.id}/suppliers/phonebook/search?q=${encodeURIComponent(query)}`
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
      return [];
    }
  }

  async function linkSupplierPhoneContact(supplierId: string, networkNodeId: string) {
    if (business === null) {
      return;
    }

    try {
      await postJson<SupplierBusinessCardSummary>(
        `/businesses/${business.id}/suppliers/${supplierId}/link-contact`,
        { networkNodeId }
      );
      await loadSuppliers(business.id);
      setStatusMessage("Supplier phone contact linked");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createSupplierFromPhoneContact(networkNodeId: string) {
    if (business === null) {
      return;
    }

    try {
      await postJson<SupplierBusinessCardSummary>(
        `/businesses/${business.id}/suppliers/from-phonebook`,
        { networkNodeId }
      );
      await loadSuppliers(business.id);
      setStatusMessage("Supplier created from phone contact");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function linkSalesAgentPhoneContact(salesAgentId: string, networkNodeId: string) {
    if (business === null) {
      return;
    }

    try {
      await postJson<SalesAgentSummary>(
        `/businesses/${business.id}/sales-agents/${salesAgentId}/link-contact`,
        { networkNodeId }
      );
      await loadSuppliers(business.id);
      setStatusMessage("Sales agent phone contact linked");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createSalesAgentFromPhoneContact(supplierId: string, networkNodeId: string) {
    if (business === null) {
      return;
    }

    try {
      await postJson<SalesAgentSummary>(
        `/businesses/${business.id}/suppliers/${supplierId}/sales-agents/from-phonebook`,
        { networkNodeId }
      );
      await loadSuppliers(business.id);
      setStatusMessage("Sales agent created from phone contact");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function readFileSignature(file: File): Promise<string> {
    const buffer = await file.slice(0, 16).arrayBuffer();
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function uploadSupplierReceipt(file: File): Promise<ReceiptOCRJobSummary | null> {
    if (business === null) {
      return null;
    }

    try {
      const extractedText = file.type.startsWith("image/") ? "" : await file.text();
      const job = await postJson<ReceiptOCRJobSummary>(
        `/businesses/${business.id}/receipt-ocr/jobs`,
        {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          extractedText,
          fileSizeBytes: file.size,
          fileSignature: await readFileSignature(file)
        }
      );
      setStatusMessage(
        job.status === "failed" || job.status === "FAILED"
          ? "Receipt OCR failed. Retry or enter the receipt manually."
          : "Receipt OCR complete. Confirm matched supplier and agent."
      );
      return job;
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
      return null;
    }
  }

  async function confirmSupplierReceipt(job: ReceiptOCRJobSummary) {
    if (business === null) {
      return;
    }

    try {
      await postJson<PurchaseReceiptSummary>(
        `/businesses/${business.id}/receipt-ocr/jobs/${job.id}/confirm`,
        {
          supplierId: job.matchedSupplierId,
          salesAgentId: job.matchedSalesAgentId,
          createSupplier: job.matchedSupplierId === null,
          createSalesAgent: job.matchedSalesAgentId === null && job.salesAgentName !== null
        }
      );
      await loadSuppliers(business.id);
      await loadReports(business.id);
      setStatusMessage("Receipt saved. Uploaded image was deleted after processing.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveCustomer() {
    if (business === null) {
      return;
    }

    try {
      const payload = {
        name: customerForm.name,
        phone: customerForm.phone,
        email: customerForm.email,
        notes: customerForm.notes
      };

      if (customerForm.id === null) {
        await postJson<CustomerSummary>(`/businesses/${business.id}/customers`, payload);
      } else {
        await patchJson<CustomerSummary>(
          `/businesses/${business.id}/customers/${customerForm.id}`,
          payload
        );
      }

      setCustomerForm(emptyCustomerForm);
      await loadCustomers(business.id);
      setStatusMessage(customerForm.id === null ? "Customer created" : "Customer updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadInvoices(businessId: string) {
    try {
      setInvoices(await getJson<InvoiceSummary[]>(`/businesses/${businessId}/invoices`));
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadSyncQueue(businessId: string) {
    try {
      const response = await getJson<SyncQueueResponse>(`/businesses/${businessId}/sync-queue`);
      setSyncSummary(response.summary);
      setSyncQueue(response.items);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadOfflineCache(businessId: string) {
    try {
      setOfflineCache(
        await getJson<OfflineCacheSnapshot>(`/businesses/${businessId}/offline-cache`)
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadRuntimeSessions(businessId: string) {
    try {
      const sessions = await getJson<RuntimeSessionSummary[]>(
        `/businesses/${businessId}/runtime/sessions`
      );
      setRuntimeSessions(sessions);
      const nextSessionId = selectedRuntimeHistorySessionId ?? sessions.at(-1)?.id ?? null;
      setSelectedRuntimeHistorySessionId(nextSessionId);
      if (nextSessionId !== null) {
        await loadRuntimeTurns(businessId, nextSessionId);
      } else {
        setRuntimeTurns([]);
      }
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createRuntimeHistorySession() {
    if (business === null) {
      return;
    }

    try {
      const session = await postJson<RuntimeSessionSummary>(
        `/businesses/${business.id}/runtime/sessions`,
        {}
      );
      setRuntimeSessions((sessions) => [...sessions, session]);
      setSelectedRuntimeHistorySessionId(session.id);
      setRuntimeTurns([]);
      setRuntimeSessionId(session.id);
      setStatusMessage("Runtime session created");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadRuntimeTurns(businessId: string, sessionId: string) {
    try {
      setRuntimeTurns(
        await getJson<RuntimeTurnSummary[]>(
          `/businesses/${businessId}/runtime/sessions/${sessionId}/turns`
        )
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadNetworkGraph() {
    try {
      setNetworkGraph(await getJson<NetworkGraphSummary>("/network"));
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function syncPhoneNetwork() {
    const contacts = createPhoneNetworkSeed(customers);

    if (contacts.length === 0) {
      setStatusMessage("Use Network Sync to grant phone contact access before importing contacts.");
      return;
    }

    try {
      const graph = await postJson<NetworkGraphSummary>("/network/sync/contacts", {
        sourceName: "Phone contacts",
        contacts
      });
      setNetworkGraph(graph);
      setStatusMessage("Phone commerce network synced");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function syncSelectedNetworkPhoneContacts(
    selectedContacts: ContactPickerContact[]
  ): Promise<NetworkGraphSummary | null> {
    const contacts = selectedContacts.map(contactPickerContactToNetworkContact).filter(
      (
        contact
      ): contact is {
        name: string;
        phone: string | null;
        email: string | null;
      } => contact !== null
    );

    if (contacts.length === 0) {
      setStatusMessage("No contacts with a usable name were selected.");
      return null;
    }

    try {
      const graph = await postJson<NetworkGraphSummary>("/network/sync/contacts", {
        sourceName: "Phone Contacts",
        contacts
      });
      setNetworkGraph(graph);
      setStatusMessage(
        `Imported ${contacts.length} contact${contacts.length === 1 ? "" : "s"} into Network Sync.`
      );
      return graph;
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
      return null;
    }
  }

  async function syncSocialNetwork(provider: "instagram" | "whatsapp" | "tiktok" | "x") {
    if (provider === "x") {
      await authenticateSocialProfile("x");
      return;
    }

    setStatusMessage("This login provider is not configured yet.");
  }

  async function requestNetworkRoute(targetNodeId?: string) {
    try {
      const route = await postJson<AgentRouteSummary>("/network/routes", {
        requestText: "Find suppliers through my network",
        ...(targetNodeId === undefined ? {} : { targetNodeId })
      });
      setNetworkGraph((graph) =>
        graph === null
          ? graph
          : {
              ...graph,
              routes: [...graph.routes.filter((item) => item.id !== route.id), route]
            }
      );
      setStatusMessage("Agent route requested");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function approveNetworkRoute(routeId: string) {
    try {
      const route = await postJson<AgentRouteSummary>(`/network/routes/${routeId}/approve`, {});
      setNetworkGraph((graph) =>
        graph === null
          ? graph
          : {
              ...graph,
              routes: graph.routes.map((item) => (item.id === route.id ? route : item))
            }
      );
      setStatusMessage("Agent route approved");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function rejectNetworkRoute(routeId: string) {
    try {
      const route = await postJson<AgentRouteSummary>(`/network/routes/${routeId}/reject`, {});
      setNetworkGraph((graph) =>
        graph === null
          ? graph
          : {
              ...graph,
              routes: graph.routes.map((item) => (item.id === route.id ? route : item))
            }
      );
      setStatusMessage("Agent route rejected");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function disconnectNetworkSource(sourceId: string) {
    try {
      setNetworkGraph(await deleteJson<NetworkGraphSummary>(`/network/sources/${sourceId}`));
      setStatusMessage("Network source disconnected");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadPaymentData(businessId: string) {
    try {
      const [nextPayments, nextSummaries, nextDebts] = await Promise.all([
        getJson<PaymentSummary[]>(`/businesses/${businessId}/payments`),
        getJson<InvoicePaymentSummary[]>(`/businesses/${businessId}/payment-summaries`),
        getJson<CustomerDebtSummary[]>(`/businesses/${businessId}/customer-debts`)
      ]);
      setPayments(nextPayments);
      setInvoicePayments(nextSummaries);
      setCustomerDebts(nextDebts);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadLogistics(businessId: string) {
    try {
      const nextLogistics = await getJson<LogisticsSummary[]>(
        `/businesses/${businessId}/logistics`
      );
      setLogistics(nextLogistics);
      if (logisticsForm.invoiceId.length === 0) {
        const existingInvoiceIds = new Set(nextLogistics.map((item) => item.invoiceId));
        const invoice = invoices.find(
          (item) => item.status === "confirmed" && !existingInvoiceIds.has(item.id)
        );
        if (invoice !== undefined) {
          setLogisticsForm((form) => ({ ...form, invoiceId: invoice.id }));
        }
      }
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadReports(businessId: string) {
    try {
      const [report, knowledge] = await Promise.all([
        getJson<BusinessReportSummary>(`/businesses/${businessId}/reports/summary`),
        getJson<BusinessKnowledgeSummary>(`/businesses/${businessId}/knowledge`)
      ]);
      setReportSummary(report);
      setKnowledgeSummary(knowledge);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadNotifications(businessId: string) {
    try {
      setNotificationInbox(
        await getJson<NotificationInbox>(`/businesses/${businessId}/notifications`)
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadCompliance(businessId: string) {
    try {
      const [review, verification, tax, trust] = await Promise.all([
        getJson<SecurityReviewSummary>(`/businesses/${businessId}/compliance/security-review`),
        getJson<VerificationTierSummary>(`/businesses/${businessId}/compliance/verification`),
        getJson<CountryTaxConfigSummary>(`/businesses/${businessId}/compliance/tax-config`),
        getJson<DeviceTrustSummary>(`/businesses/${businessId}/compliance/device-trust`)
      ]);
      setSecurityReview(review);
      setVerificationTier(verification);
      setTaxConfig(tax);
      setDeviceTrust(trust);
      setComplianceForm((form) => ({
        ...form,
        verificationTier: verification.tier,
        verificationNote: verification.note ?? "",
        defaultTaxRate: String(tax.defaultTaxRate),
        taxId: tax.taxId ?? "",
        pricesIncludeTax: tax.pricesIncludeTax,
        deviceId: trust.deviceId,
        deviceTrustLevel: trust.level,
        deviceTrustReason: trust.reason ?? ""
      }));
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createDataExport() {
    if (business === null) {
      return;
    }

    try {
      const exportBundle = await postJson<DataExportBundle>(
        `/businesses/${business.id}/compliance/export`,
        {}
      );
      setDataExport(exportBundle);
      await loadCompliance(business.id);
      await loadReports(business.id);
      setStatusMessage("Data export ready");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveVerificationTier() {
    if (business === null) {
      return;
    }

    try {
      const verification = await patchJson<VerificationTierSummary>(
        `/businesses/${business.id}/compliance/verification`,
        {
          tier: complianceForm.verificationTier,
          evidenceType:
            complianceForm.verificationTier === "unverified" ? "none" : "owner_attestation",
          note: complianceForm.verificationNote
        }
      );
      setVerificationTier(verification);
      await loadCompliance(business.id);
      await loadReports(business.id);
      setStatusMessage("Verification tier updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveTaxConfig() {
    if (business === null) {
      return;
    }

    try {
      const tax = await patchJson<CountryTaxConfigSummary>(
        `/businesses/${business.id}/compliance/tax-config`,
        {
          countryCode: "KE",
          defaultTaxRate: Number(complianceForm.defaultTaxRate),
          taxId: complianceForm.taxId,
          pricesIncludeTax: complianceForm.pricesIncludeTax
        }
      );
      setTaxConfig(tax);
      await loadReports(business.id);
      setStatusMessage("Tax configuration updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveDeviceTrust() {
    if (business === null) {
      return;
    }

    try {
      const trust = await patchJson<DeviceTrustSummary>(
        `/businesses/${business.id}/compliance/device-trust`,
        {
          deviceId: complianceForm.deviceId,
          level: complianceForm.deviceTrustLevel,
          reason: complianceForm.deviceTrustReason
        }
      );
      setDeviceTrust(trust);
      await loadCompliance(business.id);
      await loadReports(business.id);
      setStatusMessage("Device trust updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function scheduleAccountDeletion() {
    if (business === null) {
      return;
    }

    try {
      const deletion = await postJson<AccountDeletionRequestSummary>(
        `/businesses/${business.id}/compliance/account-deletion`,
        {
          confirmation: complianceForm.deletionConfirmation,
          reason: complianceForm.deletionReason
        }
      );
      setAccountDeletion(deletion);
      setSession(null);
      setBusiness(null);
      setOwnerAuth(null);
      setIsWorkspaceUnlocked(false);
      localStorage.removeItem(activeBusinessStorageKey);
      localStorage.removeItem(legacyActiveBusinessStorageKey);
      localStorage.removeItem(activeAgentStorageKey);
      localStorage.removeItem(ownerAuthStorageKey);
      setStatusMessage("Account deactivated and anonymization scheduled");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadBetaReadiness(businessId: string) {
    try {
      const [readiness, tickets] = await Promise.all([
        getJson<BetaReadinessReportSummary>(`/businesses/${businessId}/beta/readiness`),
        getJson<BetaSupportTicketSummary[]>(`/businesses/${businessId}/beta/support-tickets`)
      ]);
      setBetaReadiness(readiness);
      setBetaSupportTickets(tickets);
      setBetaForm((form) => ({
        ...form,
        accessStatus: readiness.access.status,
        invitedMerchantCount: String(readiness.access.invitedMerchantCount),
        pauseReason: readiness.access.pauseReason ?? ""
      }));
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateBetaAccess() {
    if (business === null) {
      return;
    }

    try {
      await patchJson<BetaAccessSummary>(`/businesses/${business.id}/beta/access`, {
        status: betaForm.accessStatus,
        invitedMerchantCount: Number(betaForm.invitedMerchantCount),
        pauseReason: betaForm.pauseReason
      });
      await loadBetaReadiness(business.id);
      setStatusMessage("Beta access updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function enableBetaFlags() {
    if (business === null || betaReadiness === null) {
      return;
    }

    try {
      await Promise.all(
        betaReadiness.featureFlags.map((flag) =>
          patchJson<BetaFeatureFlagSummary>(
            `/businesses/${business.id}/beta/feature-flags/${flag.key}`,
            {
              enabled: true,
              reason: "Enabled for closed beta readiness."
            }
          )
        )
      );
      await loadBetaReadiness(business.id);
      setStatusMessage("Beta feature flags enabled");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function recordBetaDeviceTest() {
    if (business === null) {
      return;
    }

    try {
      await postJson(`/businesses/${business.id}/beta/device-tests`, {
        deviceClass: betaForm.deviceClass,
        workflow: betaForm.deviceWorkflow,
        status: betaForm.deviceStatus,
        durationMs: Number(betaForm.deviceDurationMs),
        notes: "Recorded from owner shell"
      });
      await loadBetaReadiness(business.id);
      setStatusMessage("Beta device test recorded");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createBetaSupportTicket() {
    if (business === null) {
      return;
    }

    try {
      await postJson<BetaSupportTicketSummary>(`/businesses/${business.id}/beta/support-tickets`, {
        severity: betaForm.supportSeverity,
        title: betaForm.supportTitle,
        body: betaForm.supportBody,
        source: "operator"
      });
      await loadBetaReadiness(business.id);
      setStatusMessage("Beta support ticket created");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateBetaSupportTicketStatus(
    supportTicketId: string,
    status: BetaSupportTicketStatus
  ) {
    if (business === null) {
      return;
    }

    try {
      await patchJson<BetaSupportTicketSummary>(
        `/businesses/${business.id}/beta/support-tickets/${supportTicketId}`,
        { status }
      );
      await loadBetaReadiness(business.id);
      setStatusMessage("Beta support ticket updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function recordBetaTelemetry() {
    if (business === null) {
      return;
    }

    try {
      await postJson(`/businesses/${business.id}/beta/telemetry`, {
        kind: betaForm.telemetryKind,
        message: betaForm.telemetryMessage,
        metadata: {
          surface: "web",
          online: isOnline
        }
      });
      await loadBetaReadiness(business.id);
      setStatusMessage("Beta telemetry recorded");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadLaunchReadiness(businessId: string) {
    try {
      const [readiness, incidents] = await Promise.all([
        getJson<LaunchReadinessReportSummary>(`/businesses/${businessId}/launch/readiness`),
        getJson<LaunchIncidentSummary[]>(`/businesses/${businessId}/launch/incidents`)
      ]);
      setLaunchReadiness(readiness);
      setLaunchIncidents(incidents);
      setLaunchForm((form) => ({
        ...form,
        status: readiness.settings.status,
        publicOnboardingEnabled: readiness.settings.publicOnboardingEnabled,
        rollbackArmed: readiness.settings.rollbackArmed,
        freezeActive: readiness.settings.freezeActive,
        allowedSignupCount: String(readiness.settings.allowedSignupCount),
        pauseReason: readiness.settings.pauseReason ?? ""
      }));
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateLaunchSettings() {
    if (business === null) {
      return;
    }

    try {
      await patchJson<LaunchSettingsSummary>(`/businesses/${business.id}/launch/settings`, {
        status: launchForm.status,
        publicOnboardingEnabled: launchForm.publicOnboardingEnabled,
        rollbackArmed: launchForm.rollbackArmed,
        freezeActive: launchForm.freezeActive,
        allowedSignupCount: Number(launchForm.allowedSignupCount),
        pauseReason: launchForm.pauseReason
      });
      await loadLaunchReadiness(business.id);
      setStatusMessage("Launch settings updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateLaunchChecklist() {
    if (business === null) {
      return;
    }

    try {
      await patchJson<LaunchChecklistItemSummary>(
        `/businesses/${business.id}/launch/checklist/${launchForm.checklistKey}`,
        {
          status: launchForm.checklistStatus,
          evidence: launchForm.checklistEvidence
        }
      );
      await loadLaunchReadiness(business.id);
      setStatusMessage("Launch checklist updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createLaunchIncident() {
    if (business === null) {
      return;
    }

    try {
      await postJson<LaunchIncidentSummary>(`/businesses/${business.id}/launch/incidents`, {
        severity: launchForm.incidentSeverity,
        category: launchForm.incidentCategory,
        title: launchForm.incidentTitle,
        body: launchForm.incidentBody
      });
      await loadLaunchReadiness(business.id);
      setStatusMessage("Launch incident created");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateLaunchIncidentStatus(incidentId: string, status: LaunchIncidentStatus) {
    if (business === null) {
      return;
    }

    try {
      await patchJson<LaunchIncidentSummary>(
        `/businesses/${business.id}/launch/incidents/${incidentId}`,
        { status }
      );
      await loadLaunchReadiness(business.id);
      setStatusMessage("Launch incident updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateNotification(
    notificationId: string,
    status: BusinessNotificationSummary["status"]
  ) {
    if (business === null) {
      return;
    }

    try {
      await patchJson<BusinessNotificationSummary>(
        `/businesses/${business.id}/notifications/${notificationId}`,
        { status }
      );
      await loadNotifications(business.id);
      setStatusMessage("Notification updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadDocumentImports(businessId: string) {
    try {
      const jobs = await getJson<DocumentImportJobSummary[]>(`/businesses/${businessId}/imports`);
      setImportJobs(jobs);
      if (selectedImportJobId === null && jobs[0] !== undefined) {
        setSelectedImportJobId(jobs[0].id);
      }
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createDocumentImport() {
    if (business === null) {
      return;
    }

    try {
      const endpoint = importForm.target === "product" ? "product-catalogue" : "supplier-csv";
      const job = await postJson<DocumentImportJobSummary>(
        `/businesses/${business.id}/imports/${endpoint}`,
        {
          fileName: importForm.fileName,
          contentType: importForm.contentType,
          content: importForm.content
        }
      );
      setImportJobs((jobs) => [job, ...jobs.filter((item) => item.id !== job.id)]);
      setSelectedImportJobId(job.id);
      setStatusMessage(job.status === "failed" ? "Import failed" : "Import preview ready");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function updateImportRowLocal(input: {
    importJobId: string;
    rowNumber: number;
    mapped: DocumentImportDraft;
    selected: boolean;
  }) {
    setImportJobs((jobs) =>
      jobs.map((job) =>
        job.id === input.importJobId
          ? {
              ...job,
              rows: job.rows.map((row) =>
                row.rowNumber === input.rowNumber
                  ? {
                      ...row,
                      mapped: input.mapped,
                      selected: input.selected
                    }
                  : row
              )
            }
          : job
      )
    );
  }

  async function saveImportRow(job: DocumentImportJobSummary, row: DocumentImportPreviewRow) {
    if (business === null) {
      return;
    }

    try {
      const rowEndpoint = job.target === "product" ? "product-rows" : "rows";
      const updated = await patchJson<DocumentImportJobSummary>(
        `/businesses/${business.id}/imports/${job.id}/${rowEndpoint}/${row.rowNumber}`,
        {
          mapped: row.mapped,
          selected: row.selected
        }
      );
      setImportJobs((jobs) => jobs.map((item) => (item.id === updated.id ? updated : item)));
      setStatusMessage(`Import row ${row.rowNumber} saved`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function confirmImport(job: DocumentImportJobSummary) {
    if (business === null) {
      return;
    }

    try {
      const confirmEndpoint = job.target === "product" ? "confirm-products" : "confirm";
      const response = await postJson<DocumentImportConfirmResult>(
        `/businesses/${business.id}/imports/${job.id}/${confirmEndpoint}`,
        {
          selectedRowNumbers: job.rows.filter((row) => row.selected).map((row) => row.rowNumber)
        }
      );
      setImportJobs((jobs) =>
        jobs.map((item) => (item.id === response.job.id ? response.job : item))
      );
      await loadDocumentImports(business.id);
      if (response.job.target === "product") {
        await loadProducts(business.id);
      } else {
        await loadSuppliers(business.id);
      }
      await loadReports(business.id);
      setStatusMessage(
        `${response.job.confirmedCount} ${
          response.job.target === "product" ? "product" : "supplier"
        } row${response.job.confirmedCount === 1 ? "" : "s"} imported`
      );
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function recordPayment() {
    if (business === null || paymentForm.invoiceId.length === 0) {
      return;
    }

    try {
      const response = await postJson<RecordPaymentResponse>(
        `/businesses/${business.id}/payments`,
        {
          invoiceId: paymentForm.invoiceId,
          amount: Number(paymentForm.amount),
          method: paymentForm.method,
          reference: paymentForm.reference,
          note: paymentForm.note
        }
      );
      setPaymentForm({
        ...emptyPaymentForm,
        invoiceId:
          response.invoicePayment.status === "paid" ? "" : response.invoicePayment.invoiceId,
        amount:
          response.invoicePayment.status === "paid"
            ? ""
            : String(response.invoicePayment.balanceDue)
      });
      await loadPaymentData(business.id);
      setStatusMessage("Payment recorded");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createLogistics() {
    if (business === null || logisticsForm.invoiceId.length === 0) {
      return;
    }

    try {
      await postJson<LogisticsSummary>(`/businesses/${business.id}/logistics`, {
        invoiceId: logisticsForm.invoiceId,
        method: logisticsForm.method,
        destination: logisticsForm.destination,
        note: logisticsForm.note
      });
      setLogisticsForm(emptyLogisticsForm);
      await loadLogistics(business.id);
      await loadReports(business.id);
      setStatusMessage("Logistics record created");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function updateLogisticsStatus(logisticsId: string, status: FulfillmentStatus) {
    if (business === null) {
      return;
    }

    try {
      await patchJson<LogisticsSummary>(`/businesses/${business.id}/logistics/${logisticsId}`, {
        status,
        note: ""
      });
      await loadLogistics(business.id);
      await loadReports(business.id);
      setStatusMessage("Logistics status updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function switchMode(nextMode: SokoMode) {
    if (nextMode === "seller" && business === null) {
      setIsBusinessSetupOpen(true);
      setStatusMessage("Set up your business to start selling.");
      return;
    }

    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    setView("chat");
    setIsWorkspacePanelOpen(false);
    setChatMessages((messages) => [
      ...messages,
      {
        id: `mode-${nextMode}-${Date.now()}`,
        author: "sokoclaw",
        body:
          nextMode === "seller"
            ? `Seller controls are ready for ${business?.name ?? "your shop"}. You can use a card below or tell me what to change.`
            : "Marketplace mode restored. Tell me what you want to find, or explore a storefront below."
      }
    ]);
  }

  function updateShopPresenceStatus(nextStatus: ShopPresenceStatus) {
    setShopPresenceStatus(nextStatus);
    setStatusMessage(`Shop status set to ${nextStatus}`);
  }

  async function shareOwnerStorefrontInvite() {
    if (business === null) {
      return;
    }

    const shareData = {
      title: `${business.name} on Soko.market`,
      text: `Open ${business.name} with Soko Shop ID ${business.sokoId}.`,
      url: publicStorefrontUrl
    };

    try {
      if (navigator.share !== undefined) {
        await navigator.share(shareData);
      } else {
        await copyTextToClipboard(`${shareData.text} ${publicStorefrontUrl}`);
      }
      setStatusMessage("Storefront invite ready to share");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setStatusMessage("Invite sharing is not available on this device");
    }
  }

  async function importContactRecords(
    records: Array<Pick<CustomerFormState, "name" | "phone" | "email" | "notes">>
  ) {
    if (business === null || records.length === 0) {
      return;
    }

    try {
      for (const record of records) {
        await postJson<CustomerSummary>(`/businesses/${business.id}/customers`, {
          name: record.name,
          phone: record.phone,
          email: record.email,
          notes: record.notes
        });
      }
      await loadCustomers(business.id);
      setStatusMessage(`Imported ${records.length} contact${records.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function syncOwnerPhoneContacts() {
    const contactNavigator = navigator as ContactPickerNavigator;

    if (contactNavigator.contacts?.select === undefined) {
      setStatusMessage("Contact sync is available on supported mobile browsers");
      await shareOwnerStorefrontInvite();
      return;
    }

    try {
      const selectedContacts = await contactNavigator.contacts.select(["name", "tel", "email"], {
        multiple: true
      });

      if (selectedContacts.length === 0) {
        return;
      }

      const labels = selectedContacts
        .map((contact) => contact.name?.[0] ?? contact.tel?.[0] ?? contact.email?.[0])
        .filter((label): label is string => label !== undefined && label.trim().length > 0);
      const records = selectedContacts
        .map(contactPickerContactToCustomer)
        .filter(
          (record): record is Pick<CustomerFormState, "name" | "phone" | "email" | "notes"> =>
            record !== null
        );
      await importContactRecords(records);
      setChatMessages((messages) => [
        ...messages,
        {
          id: `sokoclaw-contacts-${Date.now()}`,
          author: "sokoclaw",
          body: `I found ${selectedContacts.length} contact${
            selectedContacts.length === 1 ? "" : "s"
          }: ${labels.slice(0, 5).join(", ") || "selected contacts"}. Use Invite to share your storefront link.`
        }
      ]);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setStatusMessage("I could not access contacts on this device");
    }
  }

  async function importContactsFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file === undefined) {
      return;
    }

    const content = await file.text();
    await importContactRecords(parseContactImportContent(content));
  }

  function exportOwnerContacts() {
    const csv = createContactsCsv(customers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${business?.name ?? "soko"}-contacts.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported ${customers.length} contact${customers.length === 1 ? "" : "s"}`);
  }

  async function replaySyncQueue() {
    if (business === null) {
      return;
    }

    try {
      await postJson(`/businesses/${business.id}/sync-queue/replay`, {});
      await loadSyncQueue(business.id);
      await loadOfflineCache(business.id);
      await loadProducts(business.id);
      await loadCustomers(business.id);
      await loadInvoices(business.id);
      await loadPaymentData(business.id);
      await loadLogistics(business.id);
      setStatusMessage("Sync queue replayed");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function replaySyncQueueItem(syncItemId: string) {
    if (business === null) {
      return;
    }

    try {
      await postJson(`/businesses/${business.id}/sync-queue/${syncItemId}/replay`, {});
      await loadSyncQueue(business.id);
      await loadOfflineCache(business.id);
      await loadProducts(business.id);
      await loadCustomers(business.id);
      await loadInvoices(business.id);
      await loadPaymentData(business.id);
      await loadLogistics(business.id);
      setStatusMessage("Sync item replayed");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function createInvoicePayload() {
    return {
      customerId: invoiceForm.customerId || null,
      customerName: invoiceForm.customerName,
      taxRate: Number(invoiceForm.taxRate),
      items: [
        {
          productId: invoiceForm.productId,
          quantity: Number(invoiceForm.quantity),
          unitPrice: Number(invoiceForm.unitPrice)
        }
      ]
    };
  }

  async function previewInvoice() {
    if (business === null) {
      return;
    }

    try {
      const preview = await postJson<InvoicePreview>(
        `/businesses/${business.id}/invoices/preview`,
        createInvoicePayload()
      );
      setInvoicePreview(preview);
      setStatusMessage("Invoice preview ready");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function saveInvoice() {
    if (business === null) {
      return;
    }

    try {
      const payload = createInvoicePayload();
      const invoice =
        invoiceForm.id === null
          ? await postJson<InvoiceSummary>(`/businesses/${business.id}/invoices`, payload)
          : await patchJson<InvoiceSummary>(
              `/businesses/${business.id}/invoices/${invoiceForm.id}`,
              payload
            );

      setInvoiceForm({
        ...invoiceForm,
        id: invoice.id
      });
      setInvoicePreview(invoice);
      await loadInvoices(business.id);
      setStatusMessage(invoiceForm.id === null ? "Invoice draft saved" : "Invoice draft updated");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function confirmInvoice(invoiceId: string) {
    if (business === null) {
      return;
    }

    try {
      const response = await postJson<ConfirmInvoiceResponse>(
        `/businesses/${business.id}/invoices/${invoiceId}/confirm`,
        {}
      );
      setInvoicePreview(response.invoice);
      setInvoiceForm(emptyInvoiceForm);
      await loadInvoices(business.id);
      await loadProducts(business.id);
      setStatusMessage("Invoice confirmed and stock moved");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function printInvoice(invoice: InvoiceSummary | InvoicePreview) {
    setInvoicePreview(invoice);
    window.setTimeout(() => window.print(), 0);
  }

  async function logout() {
    try {
      await postJson<{ revoked: boolean }>("/auth/logout", {});
    } catch {
      // Local state still needs to lock immediately if the API is unavailable.
    }

    setSession(null);
    setProducts([]);
    setSuppliers([]);
    setCustomers([]);
    setInvoices([]);
    setPayments([]);
    setLogistics([]);
    setInvoicePayments([]);
    setCustomerDebts([]);
    setImportJobs([]);
    setSelectedImportJobId(null);
    setSecurityReview(null);
    setOfflineCache(null);
    setRuntimeSessions([]);
    setSelectedRuntimeHistorySessionId(null);
    setRuntimeTurns([]);
    setDataExport(null);
    setAccountDeletion(null);
    setVerificationTier(null);
    setTaxConfig(null);
    setDeviceTrust(null);
    setBetaReadiness(null);
    setBetaSupportTickets([]);
    setLaunchReadiness(null);
    setLaunchIncidents([]);
    setRuntimeSessionId(null);
    setProductForm(emptyProductForm);
    setSupplierForm(emptySupplierForm);
    setCustomerForm(emptyCustomerForm);
    setInvoiceForm(emptyInvoiceForm);
    setPaymentForm(emptyPaymentForm);
    setImportForm(emptyImportForm);
    setLogisticsForm(emptyLogisticsForm);
    setComplianceForm(emptyComplianceForm);
    setBetaForm(emptyBetaForm);
    setLaunchForm(emptyLaunchForm);
    setInvoicePreview(null);
    setPendingAttachments([]);
    setChallenge(null);
    setOtp("");
    setIsOtpVerified(false);
    setSignupPin("");
    setSignupPinConfirm("");
    setLoginPin("");
    setIsRecoveringPin(false);
    setRecoveryPin("");
    setRecoveryPinConfirm("");
    setView("chat");
    setMode("marketplace");
    setIsBusinessSetupOpen(false);
    setStatusMessage(ownerAuth === null ? "Signed out" : "Signed out. Enter PIN to continue.");
    setIsWorkspaceUnlocked(ownerAuth === null);
  }

  async function sendChatDraft() {
    const attachments = pendingAttachments;
    const message =
      chatDraft.trim().length > 0 ? chatDraft.trim() : createAttachmentOnlyMessage(attachments);
    const runtimeMessage = appendAttachmentSummary(message, attachments);

    if (message.length === 0 && attachments.length === 0) {
      return;
    }

    if (business === null) {
      sendLocalParserChat(message, attachments);
      return;
    }

    const supplierReply = createSupplierChatReply(message, suppliers);

    if (supplierReply !== null) {
      const merchantMessage: ChatMessage = {
        id: `merchant-${Date.now()}`,
        author: "merchant",
        body: message,
        ...(attachments.length > 0 ? { attachments } : {})
      };
      setChatMessages((messages) => [
        ...messages,
        merchantMessage,
        {
          id: `sokoclaw-${Date.now()}`,
          author: "sokoclaw",
          body: supplierReply.body
        }
      ]);
      setChatDraft("");
      setPendingAttachments([]);
      setView(supplierReply.view);
      return;
    }

    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: message,
      ...(attachments.length > 0 ? { attachments } : {})
    };

    setChatMessages((messages) => [...messages, merchantMessage]);
    setChatDraft("");
    setPendingAttachments([]);

    try {
      const result = await postJson<RuntimeTurnResult>(`/businesses/${business.id}/runtime/turns`, {
        runtimeSessionId,
        message: runtimeMessage,
        agentProfile: createAgentRuntimeProfile(agentSettings)
      });
      setRuntimeSessionId(result.session.id);
      setClarificationCount(result.turn.status === "clarifying" ? clarificationCount + 1 : 0);
      const confirmationToken = result.turn.plan.confirmationToken;
      setChatMessages((messages) => [
        ...messages,
        confirmationToken === null
          ? {
              id: `sokoclaw-${Date.now()}`,
              author: "sokoclaw",
              body: result.turn.response
            }
          : {
              id: `sokoclaw-${Date.now()}`,
              author: "sokoclaw",
              body: result.turn.response,
              confirmationToken
            }
      ]);

      if (result.turn.plan.toolName === "products.list") {
        await loadProducts(business.id);
        setView("products");
      }

      if (result.turn.plan.toolName === "invoices.list") {
        await loadInvoices(business.id);
        setView("invoices");
      }

      if (isNetworkDiscoveryRequest(message)) {
        await loadNetworkGraph();
        await requestNetworkRoute();
        setView("network");
      }

      await loadRuntimeSessions(business.id);
      setStatusMessage(`Runtime ${result.turn.status.replace("_", " ")}`);
    } catch (error) {
      const parserReply = createLocalParserReply(message);
      setChatMessages((messages) => [...messages, parserReply]);
      if (isNetworkDiscoveryRequest(message)) {
        await loadNetworkGraph();
        setView("network");
      }
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function confirmRuntimeAction(confirmationToken: string) {
    if (business === null || runtimeSessionId === null) {
      return;
    }

    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: "Confirm"
    };

    setChatMessages((messages) => [...messages, merchantMessage]);

    try {
      const result = await postJson<RuntimeTurnResult>(`/businesses/${business.id}/runtime/turns`, {
        runtimeSessionId,
        message: "confirm",
        confirmationToken
      });
      setRuntimeSessionId(result.session.id);
      setChatMessages((messages) => [
        ...messages,
        {
          id: `sokoclaw-${Date.now()}`,
          author: "sokoclaw",
          body: result.turn.response
        }
      ]);

      if (result.turn.plan.toolName === "product.create") {
        await loadProducts(business.id);
        setView("products");
      }

      if (result.turn.plan.toolName === "customer.create") {
        await loadCustomers(business.id);
        setView("customers");
      }

      await loadRuntimeSessions(business.id);
      setStatusMessage(`Runtime ${result.turn.status.replace("_", " ")}`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function handleChatAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setPendingAttachments((attachments) => [
      ...attachments,
      ...files.map((file) => createChatAttachment(file))
    ]);
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId: string) {
    setPendingAttachments((attachments) =>
      attachments.filter((attachment) => attachment.id !== attachmentId)
    );
  }

  function createLocalParserReply(message: string): ChatMessage {
    const supplierReply = createSupplierChatReply(message, suppliers);

    if (supplierReply !== null) {
      setView(supplierReply.view);
      return {
        id: `sokoclaw-${Date.now()}`,
        author: "sokoclaw",
        body: supplierReply.body
      };
    }

    const decision = createAgentRuntimeDecision({
      agent: agentSettings,
      clarificationCount,
      customers,
      customerDebts,
      invoices,
      message,
      products
    });
    const reply: ChatMessage = {
      id: `sokoclaw-${Date.now()}`,
      author: "sokoclaw",
      body: decision.response
    };

    if (decision.kind === "act" && decision.result.nextAction.type === "navigate") {
      setView(decision.result.nextAction.view);
    }

    if (
      decision.kind === "act" &&
      decision.result.intent === "add_product" &&
      decision.result.nextAction.type === "draft"
    ) {
      setProductForm((form) => ({
        ...form,
        name: decision.result.slots.productName ?? form.name,
        quantity:
          decision.result.slots.quantity === undefined
            ? form.quantity
            : String(decision.result.slots.quantity),
        unit: decision.result.slots.unit ?? form.unit
      }));
      setView("products");
    }

    if (
      decision.kind === "act" &&
      decision.result.intent === "add_customer" &&
      decision.result.nextAction.type === "draft"
    ) {
      setCustomerForm((form) => ({
        ...form,
        name: decision.result.slots.customerName ?? form.name
      }));
      setView("customers");
    }

    if (
      decision.kind === "act" &&
      decision.result.intent === "create_invoice" &&
      decision.result.nextAction.type === "draft"
    ) {
      setInvoiceForm((form) => ({
        ...form,
        customerId: decision.matchedCustomer?.id ?? form.customerId,
        customerName:
          decision.matchedCustomer === null
            ? (decision.result.slots.customerName ?? form.customerName)
            : "",
        productId: decision.matchedProduct?.id ?? form.productId,
        quantity:
          decision.result.slots.quantity === undefined
            ? form.quantity
            : String(decision.result.slots.quantity)
      }));
      setInvoicePreview(null);
      setView("invoices");
    }

    if (
      decision.kind === "act" &&
      decision.result.intent === "record_payment" &&
      decision.result.nextAction.type === "draft"
    ) {
      const invoice = findInvoiceForPayment(invoices, decision.matchedCustomer);
      setPaymentForm((form) => ({
        ...form,
        invoiceId: invoice?.id ?? form.invoiceId,
        amount:
          decision.result.slots.amount === undefined
            ? form.amount
            : String(decision.result.slots.amount)
      }));
      setView("payments");
    }

    if (decision.kind === "act" && decision.result.intent === "check_debt") {
      setView("payments");
    }

    setClarificationCount(decision.kind === "act" ? 0 : clarificationCount + 1);
    return reply;
  }

  function sendLocalParserChat(message: string, attachments: ChatAttachment[] = []) {
    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: message,
      ...(attachments.length > 0 ? { attachments } : {})
    };
    const reply = createLocalParserReply(message);

    setChatMessages((messages) => [...messages, merchantMessage, reply]);
    setChatDraft("");
    setPendingAttachments([]);
  }

  function renderActiveWorkspace() {
    if (business === null) {
      return null;
    }

    switch (view) {
      case "products":
        return (
          <ProductSurface
            products={products}
            form={productForm}
            stockProductId={stockProductId}
            stockQuantityAfter={stockQuantityAfter}
            stockReason={stockReason}
            onFormChange={setProductForm}
            onSave={() => void saveProduct()}
            onReset={() => setProductForm(emptyProductForm)}
            onAdd={() => setProductForm(emptyProductForm)}
            onEdit={(product) => {
              setProductForm({
                id: product.id,
                name: product.name,
                sku: product.sku ?? "",
                unit: product.unit,
                quantity: String(product.quantity),
                buyingPrice: product.buyingPrice === null ? "" : String(product.buyingPrice),
                sellingPrice: product.sellingPrice === null ? "" : String(product.sellingPrice)
              });
              setStockProductId(product.id);
              setStockQuantityAfter(String(product.quantity));
            }}
            onStockProductChange={(productId) => {
              const product = products.find((item) => item.id === productId);
              setStockProductId(productId);
              setStockQuantityAfter(String(product?.quantity ?? 0));
            }}
            onStockQuantityAfterChange={setStockQuantityAfter}
            onStockReasonChange={setStockReason}
            onAdjustStock={() => void adjustStock()}
            onRemove={(productId) => void deleteProduct(productId)}
          />
        );
      case "suppliers":
        return (
          <SupplierSurface
            suppliers={suppliers}
            form={supplierForm}
            onFormChange={setSupplierForm}
            onSave={() => void saveSupplier()}
            onReset={() => setSupplierForm(emptySupplierForm)}
            onEdit={(supplier) =>
              setSupplierForm({
                id: supplier.id,
                name: supplier.name,
                phone: supplier.phone ?? "",
                email: supplier.email ?? "",
                notes: supplier.notes ?? ""
              })
            }
            onDelete={(supplierId) => void deleteSupplierCard(supplierId)}
            onSaveSalesAgent={(supplierId, agent) => void saveSalesAgent(supplierId, agent)}
            onDeleteSalesAgent={(supplierId, salesAgentId) =>
              void deleteSalesAgentCard(supplierId, salesAgentId)
            }
            onSearchContacts={searchSupplierContacts}
            onLinkSupplierContact={(supplierId, networkNodeId) =>
              void linkSupplierPhoneContact(supplierId, networkNodeId)
            }
            onCreateSupplierFromContact={(networkNodeId) =>
              void createSupplierFromPhoneContact(networkNodeId)
            }
            onLinkSalesAgentContact={(salesAgentId, networkNodeId) =>
              void linkSalesAgentPhoneContact(salesAgentId, networkNodeId)
            }
            onCreateSalesAgentFromContact={(supplierId, networkNodeId) =>
              void createSalesAgentFromPhoneContact(supplierId, networkNodeId)
            }
            onUploadReceipt={uploadSupplierReceipt}
            onConfirmReceipt={(job) => void confirmSupplierReceipt(job)}
            onImport={() => setView("imports")}
          />
        );
      case "customers":
        return (
          <CustomerSurface
            customers={customers}
            form={customerForm}
            onFormChange={setCustomerForm}
            onSave={() => void saveCustomer()}
            onReset={() => setCustomerForm(emptyCustomerForm)}
            onEdit={(customer) =>
              setCustomerForm({
                id: customer.id,
                name: customer.name,
                phone: customer.phone ?? "",
                email: customer.email ?? "",
                notes: customer.notes ?? ""
              })
            }
          />
        );
      case "invoices":
        return (
          <InvoiceSurface
            products={products}
            customers={customers}
            invoices={invoices}
            form={invoiceForm}
            preview={invoicePreview}
            onFormChange={setInvoiceForm}
            onPreview={() => void previewInvoice()}
            onSave={() => void saveInvoice()}
            onReset={() => {
              setInvoiceForm(emptyInvoiceForm);
              setInvoicePreview(null);
            }}
            onEdit={(invoice) => {
              const firstItem = invoice.items[0];
              setInvoiceForm({
                id: invoice.id,
                customerId: invoice.customerId ?? "",
                customerName: invoice.customerName ?? "",
                productId: firstItem?.productId ?? "",
                quantity: String(firstItem?.quantity ?? 1),
                unitPrice: String(firstItem?.unitPrice ?? 0),
                taxRate: String(invoice.taxRate)
              });
              setInvoicePreview(invoice);
            }}
            onConfirm={(invoiceId) => void confirmInvoice(invoiceId)}
            onPrint={printInvoice}
          />
        );
      case "network":
        return (
          <NetworkSurface
            graph={networkGraph}
            onRefresh={() => void loadNetworkGraph()}
            onSyncContacts={() => void syncPhoneNetwork()}
            onSyncSocial={(provider) => void syncSocialNetwork(provider)}
            onRoute={(targetNodeId) => void requestNetworkRoute(targetNodeId)}
            onApproveRoute={(routeId) => void approveNetworkRoute(routeId)}
            onRejectRoute={(routeId) => void rejectNetworkRoute(routeId)}
            onDisconnectSource={(sourceId) => void disconnectNetworkSource(sourceId)}
          />
        );
      case "sync":
        return (
          <SyncSurface
            summary={syncSummary}
            items={syncQueue}
            offlineCache={offlineCache}
            storefrontUrl={publicStorefrontUrl}
            onInvite={() => void shareOwnerStorefrontInvite()}
            onSyncContacts={() => void syncOwnerPhoneContacts()}
            onImportContacts={(event) => void importContactsFile(event)}
            onExportContacts={exportOwnerContacts}
            onRefresh={() => {
              void loadSyncQueue(business.id);
              void loadOfflineCache(business.id);
            }}
            onReplay={() => void replaySyncQueue()}
            onReplayItem={(syncItemId) => void replaySyncQueueItem(syncItemId)}
          />
        );
      case "runtime":
        return (
          <RuntimeSurface
            sessions={runtimeSessions}
            selectedSessionId={selectedRuntimeHistorySessionId}
            turns={runtimeTurns}
            onCreateSession={() => void createRuntimeHistorySession()}
            onRefresh={() => void loadRuntimeSessions(business.id)}
            onSelectSession={(sessionId) => {
              setSelectedRuntimeHistorySessionId(sessionId);
              void loadRuntimeTurns(business.id, sessionId);
            }}
          />
        );
      case "payments":
        return (
          <PaymentSurface
            invoices={invoices}
            payments={payments}
            invoicePayments={invoicePayments}
            customerDebts={customerDebts}
            form={paymentForm}
            onFormChange={setPaymentForm}
            onRecord={() => void recordPayment()}
            onRefresh={() => void loadPaymentData(business.id)}
          />
        );
      case "imports":
        return (
          <ImportSurface
            form={importForm}
            importJobs={importJobs}
            activeImportJob={activeImportJob}
            selectedImportJobId={selectedImportJobId}
            onFormChange={setImportForm}
            onCreate={() => void createDocumentImport()}
            onSelectJob={setSelectedImportJobId}
            onRowChange={updateImportRowLocal}
            onSaveRow={(job, row) => void saveImportRow(job, row)}
            onConfirm={(job) => void confirmImport(job)}
            onRefresh={() => void loadDocumentImports(business.id)}
          />
        );
      case "logistics":
        return (
          <LogisticsSurface
            invoices={invoices}
            logistics={logistics}
            form={logisticsForm}
            onFormChange={setLogisticsForm}
            onCreate={() => void createLogistics()}
            onStatusChange={(logisticsId, status) =>
              void updateLogisticsStatus(logisticsId, status)
            }
            onRefresh={() => void loadLogistics(business.id)}
          />
        );
      case "compliance":
        return (
          <ComplianceSurface
            form={complianceForm}
            securityReview={securityReview}
            dataExport={dataExport}
            accountDeletion={accountDeletion}
            verification={verificationTier}
            taxConfig={taxConfig}
            deviceTrust={deviceTrust}
            onFormChange={setComplianceForm}
            onExport={() => void createDataExport()}
            onSaveVerification={() => void saveVerificationTier()}
            onSaveTax={() => void saveTaxConfig()}
            onSaveDeviceTrust={() => void saveDeviceTrust()}
            onScheduleDeletion={() => void scheduleAccountDeletion()}
            onRefresh={() => void loadCompliance(business.id)}
          />
        );
      case "beta":
        return (
          <BetaSurface
            form={betaForm}
            readiness={betaReadiness}
            supportTickets={betaSupportTickets}
            onFormChange={setBetaForm}
            onUpdateAccess={() => void updateBetaAccess()}
            onEnableFlags={() => void enableBetaFlags()}
            onRecordDeviceTest={() => void recordBetaDeviceTest()}
            onCreateSupportTicket={() => void createBetaSupportTicket()}
            onUpdateSupportTicket={(supportTicketId, status) =>
              void updateBetaSupportTicketStatus(supportTicketId, status)
            }
            onRecordTelemetry={() => void recordBetaTelemetry()}
            onRefresh={() => void loadBetaReadiness(business.id)}
          />
        );
      case "launch":
        return (
          <LaunchSurface
            form={launchForm}
            readiness={launchReadiness}
            incidents={launchIncidents}
            onFormChange={setLaunchForm}
            onUpdateSettings={() => void updateLaunchSettings()}
            onUpdateChecklist={() => void updateLaunchChecklist()}
            onCreateIncident={() => void createLaunchIncident()}
            onUpdateIncident={(incidentId, status) =>
              void updateLaunchIncidentStatus(incidentId, status)
            }
            onRefresh={() => void loadLaunchReadiness(business.id)}
          />
        );
      case "reports":
        return (
          <ReportsSurface
            report={reportSummary}
            knowledge={knowledgeSummary}
            onRefresh={() => void loadReports(business.id)}
          />
        );
      case "notifications":
        return (
          <NotificationsSurface
            inbox={notificationInbox}
            onRefresh={() => void loadNotifications(business.id)}
            onUpdate={(notificationId, status) => void updateNotification(notificationId, status)}
          />
        );
      default:
        return null;
    }
  }

  return (
    <Surface title="Soko.market">
      <div className={isAuthScreen ? "app-frame auth-frame" : "app-frame"}>
        <header className={isAuthScreen ? "top-bar auth-top-bar" : "top-bar"}>
          {business === null ? (
            <div className="auth-brand-title">soko.market</div>
          ) : (
            <button
              className="brand-lockup"
              type="button"
              onClick={() => setupComplete && setView("agent")}
            >
              <span className="logo-mark">S</span>
              <span>
                <strong>Soko.market</strong>
                <span>{business.name}</span>
                <small>{shouldShowLogin ? "Saved workspace loaded" : agentSettings.name}</small>
                <small>{business.sokoId}</small>
              </span>
            </button>
          )}
          {!isAuthScreen ? (
            <div className="header-actions">
              <button
                className={
                  mode === "seller"
                    ? "header-action-button mode-active"
                    : "header-action-button sell"
                }
                type="button"
                onClick={() => switchMode(mode === "seller" ? "marketplace" : "seller")}
                aria-pressed={mode === "seller"}
              >
                {mode === "seller" ? "Shop" : "Sell"}
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => (business === null ? void logout() : setView("agent"))}
                aria-label={business === null ? "Sign out" : "Account and agent settings"}
              >
                <span aria-hidden="true">{userLabel.slice(0, 1).toUpperCase()}</span>
              </button>
            </div>
          ) : null}
        </header>

        {shouldShowSignup ? (
          <SetupPanel
            channel={channel}
            countryCode={countryCode}
            destination={destination}
            challenge={challenge}
            otp={otp}
            isOtpVerified={isOtpVerified}
            signupPin={signupPin}
            signupPinConfirm={signupPinConfirm}
            session={session}
            oauthProviders={oauthProviders}
            oauthProvidersLoaded={oauthProvidersLoaded}
            isOtherSocialOpen={isOtherSocialOpen}
            statusMessage={statusMessage}
            onChannelChange={setChannel}
            onCountryCodeChange={setCountryCode}
            onDestinationChange={setDestination}
            onOtpChange={setOtp}
            onRequestOtp={() => void requestOtp()}
            onVerifyOtp={() => void verifyOtp()}
            onCompleteSignup={() => void completeSignup()}
            onSignupPinChange={setSignupPin}
            onSignupPinConfirmChange={setSignupPinConfirm}
            onSocialSignup={(provider) => void authenticateSocialProfile(provider)}
            onOpenOtherSocial={() => setIsOtherSocialOpen(true)}
            onCloseOtherSocial={() => setIsOtherSocialOpen(false)}
          />
        ) : shouldShowLogin ? (
          <LoginPanel
            channel={channel}
            countryCode={countryCode}
            destination={destination}
            challenge={challenge}
            otp={otp}
            isOtpVerified={isOtpVerified}
            loginPin={loginPin}
            isRecoveringPin={isRecoveringPin}
            hasLoginPin={hasLoginPin}
            recoveryPin={recoveryPin}
            recoveryPinConfirm={recoveryPinConfirm}
            oauthProviders={oauthProviders}
            oauthProvidersLoaded={oauthProvidersLoaded}
            isOtherSocialOpen={isOtherSocialOpen}
            statusMessage={statusMessage}
            onChannelChange={setChannel}
            onCountryCodeChange={setCountryCode}
            onDestinationChange={setDestination}
            onOtpChange={setOtp}
            onRequestOtp={() => void requestLoginOtp()}
            onVerifyOtp={() => void verifyLoginOtp()}
            onLoginPinChange={setLoginPin}
            onRecoveryPinChange={setRecoveryPin}
            onRecoveryPinConfirmChange={setRecoveryPinConfirm}
            onStartPinRecovery={startPinRecovery}
            onCancelPinRecovery={cancelPinRecovery}
            onRecoverPin={() => void recoverLoginPin()}
            onSetMissingPin={() => void setMissingLoginPin()}
            onSocialLogin={(provider) => void authenticateSocialProfile(provider)}
            onOpenOtherSocial={() => setIsOtherSocialOpen(true)}
            onCloseOtherSocial={() => setIsOtherSocialOpen(false)}
            onLogin={() => void loginWithPin()}
          />
        ) : isBusinessSetupOpen && business === null ? (
          <BusinessSetupPanel
            businessName={businessName}
            language={language}
            statusMessage={statusMessage}
            onBusinessNameChange={setBusinessName}
            onLanguageChange={setLanguage}
            onCancel={() => {
              setIsBusinessSetupOpen(false);
              setStatusMessage("Business setup cancelled. You can keep browsing the marketplace.");
            }}
            onCreateBusiness={() => void createBusiness()}
          />
        ) : view === "agent" && business !== null ? (
          <AgentProfileSurface
            agent={agentSettings}
            business={business}
            oauthProviders={oauthProviders}
            ownerLabel={userLabel}
            storefrontUrl={publicStorefrontUrl}
            onAgentChange={setAgentSettings}
            onBack={() => setView("chat")}
            onLogout={() => void logout()}
          />
        ) : (
          <main className="chat-workspace-shell">
            <ChatSurface
              activeView={view}
              agent={agentSettings}
              businessName={business?.name ?? "Your shop"}
              hasBusiness={business !== null}
              chatDraft={chatDraft}
              customerCount={customers.length}
              invoiceCount={invoices.length}
              messages={chatMessages}
              mode={mode}
              networkGraph={networkGraph}
              notificationCount={notificationInbox.summary.unread}
              oauthProviders={oauthProviders}
              oauthProvidersLoaded={oauthProvidersLoaded}
              pendingAttachments={pendingAttachments}
              productForm={productForm}
              productCount={products.length}
              products={products}
              sokoId={business?.sokoId ?? "Not set up yet"}
              report={reportSummary}
              shopPresenceStatus={shopPresenceStatus}
              workspaceOpen={isWorkspacePanelOpen}
              syncSummary={syncSummary}
              onAttachmentChange={handleChatAttachmentChange}
              onAddWorkspaceCard={() => setStatusMessage("Custom workspace cards are coming soon")}
              onBackToChat={() => setView("chat")}
              onConfirm={(token) => void confirmRuntimeAction(token)}
              onDraftChange={setChatDraft}
              onCloseWorkspace={() => setIsWorkspacePanelOpen(false)}
              onNavigate={setView}
              onModeChange={switchMode}
              onProductEdit={(product) => {
                setProductForm({
                  id: product.id,
                  name: product.name,
                  sku: product.sku ?? "",
                  unit: product.unit,
                  quantity: String(product.quantity),
                  buyingPrice: product.buyingPrice === null ? "" : String(product.buyingPrice),
                  sellingPrice: product.sellingPrice === null ? "" : String(product.sellingPrice)
                });
                setStockProductId(product.id);
                setStockQuantityAfter(String(product.quantity));
              }}
              onProductFieldsSave={(fields) => void saveProductFieldStructure(fields)}
              onProductFormChange={setProductForm}
              onProductRemove={(productId) => void deleteProduct(productId)}
              onProductReset={() => setProductForm(emptyProductForm)}
              onProductSave={() => saveProduct()}
              onNetworkDisconnectSource={(sourceId) => void disconnectNetworkSource(sourceId)}
              onNetworkPhoneContactsSync={syncSelectedNetworkPhoneContacts}
              onNetworkProviderOAuth={authenticateSocialProfile}
              onNetworkRefresh={() => void loadNetworkGraph()}
              onRemoveAttachment={removePendingAttachment}
              onStatusChange={updateShopPresenceStatus}
              onSend={() => void sendChatDraft()}
            >
              {renderActiveWorkspace()}
            </ChatSurface>
          </main>
        )}
        <footer className="app-credits">
          <span>Karibu Soko</span>
          <BuildIdentity />
        </footer>
      </div>
    </Surface>
  );
}

interface SetupPanelProps {
  channel: AuthChannel;
  countryCode: CountryDialCode;
  destination: string;
  challenge: OtpRequestResponse | null;
  otp: string;
  isOtpVerified: boolean;
  signupPin: string;
  signupPinConfirm: string;
  session: SessionResponse | null;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  isOtherSocialOpen: boolean;
  statusMessage: string;
  onChannelChange: (channel: AuthChannel) => void;
  onCountryCodeChange: (countryCode: CountryDialCode) => void;
  onDestinationChange: (destination: string) => void;
  onOtpChange: (otp: string) => void;
  onRequestOtp: () => void;
  onVerifyOtp: () => void;
  onCompleteSignup: () => void;
  onSignupPinChange: (pin: string) => void;
  onSignupPinConfirmChange: (pin: string) => void;
  onSocialSignup: (provider: SocialSignupProvider) => void;
  onOpenOtherSocial: () => void;
  onCloseOtherSocial: () => void;
}

interface SocialLoginOptionsProps {
  mode: "signup" | "login";
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  isOtherSocialOpen: boolean;
  onSelectPhone: () => void;
  onSelectEmail: () => void;
  onSelectProvider: (provider: SocialSignupProvider) => void;
  onOpenOther: () => void;
  onCloseOther: () => void;
}

function SocialLoginOptions(props: SocialLoginOptionsProps) {
  const primaryProviders = socialSignupProviders.filter((provider) => provider.primary);
  const secondaryProviders = socialSignupProviders.filter(
    (provider) => provider.id === "x" || provider.id === "linkedin"
  );
  const otherProviders = socialSignupProviders.filter(
    (provider) => !provider.primary && provider.id !== "x" && provider.id !== "linkedin"
  );
  const actionText = props.mode === "signup" ? "sign up or sign in" : "log in or sign in";

  return (
    <>
      <AuthBrand />
      <div className="auth-provider-stack" aria-label={`${props.mode} options`}>
        <button
          className="social-signup-button whatsapp"
          type="button"
          onClick={props.onSelectPhone}
        >
          <span aria-hidden="true">WA</span>
          Continue with WhatsApp
        </button>
        {primaryProviders.map((provider) => {
          const config = getAuthProviderConfig(
            provider,
            props.oauthProviders,
            props.oauthProvidersLoaded
          );

          return (
            <button
              className={`social-signup-button ${provider.id} ${config.enabled ? "" : "unconfigured"}`}
              key={provider.id}
              title={
                config.enabled
                  ? `Redirect to ${provider.label} to ${actionText}`
                  : "This login provider is not configured yet."
              }
              type="button"
              aria-disabled={!config.enabled}
              onClick={() => props.onSelectProvider(provider.id)}
            >
              <span>{provider.icon}</span>
              Continue with {provider.label}
            </button>
          );
        })}
      </div>

      <div className="signup-divider auth-divider">
        <span>Or</span>
      </div>

      <div className="auth-provider-stack" aria-label="Direct login options">
        <button className="social-signup-button phone" type="button" onClick={props.onSelectPhone}>
          <span aria-hidden="true">☎</span>
          Continue with phone
        </button>
        <button className="social-signup-button email" type="button" onClick={props.onSelectEmail}>
          <span aria-hidden="true">@</span>
          Continue with email
        </button>
      </div>

      <div className="secondary-provider-row" aria-label="Secondary login providers">
        {secondaryProviders.map((provider) => {
          const config = getAuthProviderConfig(
            provider,
            props.oauthProviders,
            props.oauthProvidersLoaded
          );

          return (
            <button
              className={`secondary-provider-button ${provider.id} ${
                config.enabled ? "" : "unconfigured"
              }`}
              key={provider.id}
              title={
                config.enabled
                  ? `Redirect to ${provider.label} to ${actionText}`
                  : "This login provider is not configured yet."
              }
              type="button"
              aria-disabled={!config.enabled}
              aria-label={`Continue with ${provider.label}`}
              onClick={() => props.onSelectProvider(provider.id)}
            >
              {provider.icon}
            </button>
          );
        })}
        <button
          className="secondary-provider-button other"
          type="button"
          title="Other social account"
          aria-label="Other social account"
          onClick={props.onOpenOther}
        >
          +
        </button>
      </div>

      <AuthLegalFooter />

      {props.isOtherSocialOpen ? (
        <div className="auth-modal-backdrop" role="presentation">
          <div
            aria-label="Choose another social login provider"
            aria-modal="true"
            className="auth-provider-modal"
            role="dialog"
          >
            <div className="auth-modal-heading">
              <h3>Other social account</h3>
              <button type="button" onClick={props.onCloseOther} aria-label="Close">
                x
              </button>
            </div>
            <div className="social-signup-grid">
              {otherProviders.map((provider) => {
                const config = getAuthProviderConfig(
                  provider,
                  props.oauthProviders,
                  props.oauthProvidersLoaded
                );

                return (
                  <button
                    className={`social-signup-button ${provider.id} ${
                      config.enabled ? "" : "unconfigured"
                    }`}
                    key={provider.id}
                    title={
                      config.enabled
                        ? `Redirect to ${provider.label} to ${actionText}`
                        : "This login provider is not configured yet."
                    }
                    type="button"
                    aria-disabled={!config.enabled}
                    onClick={() => props.onSelectProvider(provider.id)}
                  >
                    <span>{provider.icon}</span>
                    Continue with {provider.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AuthBrand() {
  return (
    <div className="auth-brand">
      <h1>soko.market</h1>
      <p>Karibu Soko</p>
    </div>
  );
}

function AuthLegalFooter() {
  return (
    <p className="auth-legal">
      By continuing, you agree to the <a href="/terms">Terms of Service</a> and{" "}
      <a href="/privacy">Privacy Policy</a>.
    </p>
  );
}

function SetupPanel(props: SetupPanelProps) {
  const [authView, setAuthView] = useState<"options" | AuthChannel>("options");
  const contactIsValid = isSignupContactValid(props.channel, props.countryCode, props.destination);
  const selectedCountryCode = getCountryDialCode(props.countryCode);
  const phoneSuffix = sanitizePhoneSuffix(props.destination, selectedCountryCode.suffixLength);
  const showPhoneAuth = authView === "phone" || props.challenge !== null || props.isOtpVerified;

  return (
    <main className="setup-grid auth-landing-grid">
      <section className="panel auth-card">
        {!showPhoneAuth ? (
          <SocialLoginOptions
            mode="signup"
            oauthProviders={props.oauthProviders}
            oauthProvidersLoaded={props.oauthProvidersLoaded}
            isOtherSocialOpen={props.isOtherSocialOpen}
            onSelectPhone={() => {
              props.onChannelChange("phone");
              setAuthView("phone");
            }}
            onSelectEmail={() => {
              props.onChannelChange("email");
              setAuthView("email");
            }}
            onSelectProvider={props.onSocialSignup}
            onOpenOther={props.onOpenOtherSocial}
            onCloseOther={props.onCloseOtherSocial}
          />
        ) : (
          <>
            <div className="auth-heading-row">
              <div className="section-heading">
                <p className="eyebrow">Continue with {props.channel}</p>
                <h2>Signup or login</h2>
              </div>
            </div>
            <div className="segmented" aria-label="Auth channel">
              <button
                className={props.channel === "phone" ? "active" : ""}
                type="button"
                onClick={() => props.onChannelChange("phone")}
              >
                Phone
              </button>
              <button
                className={props.channel === "email" ? "active" : ""}
                type="button"
                onClick={() => props.onChannelChange("email")}
              >
                Email
              </button>
            </div>
            {props.channel === "phone" ? (
              <div className="phone-contact-row">
                <label>
                  Country code
                  <select
                    value={props.countryCode}
                    onChange={(event) =>
                      props.onCountryCodeChange(event.target.value as CountryDialCode)
                    }
                  >
                    {countryDialCodes.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.flag} {item.code} {item.country}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Phone number
                  <input
                    value={phoneSuffix}
                    onChange={(event) =>
                      props.onDestinationChange(
                        sanitizePhoneSuffix(event.target.value, selectedCountryCode.suffixLength)
                      )
                    }
                    inputMode="numeric"
                    maxLength={selectedCountryCode.suffixLength}
                    pattern="[0-9]*"
                    type="tel"
                    placeholder={"0".repeat(selectedCountryCode.suffixLength)}
                  />
                </label>
              </div>
            ) : (
              <label>
                Email address
                <input
                  value={props.destination}
                  onChange={(event) => props.onDestinationChange(event.target.value)}
                  inputMode="email"
                  type="email"
                  placeholder="owner@example.com"
                />
              </label>
            )}
            <button type="button" onClick={props.onRequestOtp} disabled={!contactIsValid}>
              Continue
            </button>
            <label>
              OTP
              <input
                value={props.otp}
                onChange={(event) => props.onOtpChange(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <button type="button" onClick={props.onVerifyOtp} disabled={props.challenge === null}>
              Verify OTP
            </button>
            {!props.isOtpVerified ? (
              <button className="secondary" type="button" onClick={() => setAuthView("options")}>
                Back to login options
              </button>
            ) : null}
          </>
        )}
        <p className="setup-status" role="status" aria-live="polite">
          {props.statusMessage}
        </p>
      </section>

      {props.isOtpVerified ? (
        <section className="panel">
          <div className="section-heading">
            <p className="eyebrow">Step 2</p>
            <h2>Create login PIN</h2>
          </div>
          <label>
            PIN
            <input
              value={props.signupPin}
              onChange={(event) => props.onSignupPinChange(sanitizePin(event.target.value))}
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]*"
              type="password"
              placeholder="4-digit PIN"
            />
          </label>
          <label>
            Confirm PIN
            <input
              value={props.signupPinConfirm}
              onChange={(event) => props.onSignupPinConfirmChange(sanitizePin(event.target.value))}
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]*"
              type="password"
              placeholder="Re-enter PIN"
            />
          </label>
          <button
            type="button"
            onClick={props.onCompleteSignup}
            disabled={
              props.session === null ||
              !props.isOtpVerified ||
              !isValidPin(props.signupPin) ||
              props.signupPin !== props.signupPinConfirm
            }
          >
            Finish signup
          </button>
        </section>
      ) : null}
    </main>
  );
}

interface BusinessSetupPanelProps {
  businessName: string;
  language: SupportedLanguage;
  statusMessage: string;
  onBusinessNameChange: (businessName: string) => void;
  onLanguageChange: (language: SupportedLanguage) => void;
  onCancel: () => void;
  onCreateBusiness: () => void;
}

function BusinessSetupPanel(props: BusinessSetupPanelProps) {
  return (
    <main className="setup-grid business-setup-grid">
      <section className="panel auth-card">
        <div className="section-heading">
          <p className="eyebrow">Start selling</p>
          <h2>Set up your business</h2>
          <p>Create your shop once. You can update its details later.</p>
        </div>
        <label>
          Business name
          <input
            autoFocus
            value={props.businessName}
            onChange={(event) => props.onBusinessNameChange(event.target.value)}
            placeholder="Your business name"
          />
        </label>
        <label>
          Language
          <select
            value={props.language}
            onChange={(event) => props.onLanguageChange(event.target.value as SupportedLanguage)}
          >
            <option value="en">English</option>
            <option value="sw">Swahili</option>
          </select>
        </label>
        <div className="compact-actions">
          <button
            type="button"
            onClick={props.onCreateBusiness}
            disabled={!props.businessName.trim()}
          >
            Create business
          </button>
          <button className="secondary" type="button" onClick={props.onCancel}>
            Not now
          </button>
        </div>
        <p className="setup-status" role="status" aria-live="polite">
          {props.statusMessage}
        </p>
      </section>
    </main>
  );
}

interface LoginPanelProps {
  channel: AuthChannel;
  countryCode: CountryDialCode;
  destination: string;
  challenge: OtpRequestResponse | null;
  otp: string;
  isOtpVerified: boolean;
  loginPin: string;
  isRecoveringPin: boolean;
  hasLoginPin: boolean;
  recoveryPin: string;
  recoveryPinConfirm: string;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  isOtherSocialOpen: boolean;
  statusMessage: string;
  onChannelChange: (channel: AuthChannel) => void;
  onCountryCodeChange: (countryCode: CountryDialCode) => void;
  onDestinationChange: (destination: string) => void;
  onOtpChange: (otp: string) => void;
  onRequestOtp: () => void;
  onVerifyOtp: () => void;
  onLoginPinChange: (pin: string) => void;
  onRecoveryPinChange: (pin: string) => void;
  onRecoveryPinConfirmChange: (pin: string) => void;
  onStartPinRecovery: () => void;
  onCancelPinRecovery: () => void;
  onRecoverPin: () => void;
  onSetMissingPin: () => void;
  onSocialLogin: (provider: SocialSignupProvider) => void;
  onOpenOtherSocial: () => void;
  onCloseOtherSocial: () => void;
  onLogin: () => void;
}

function LoginPanel(props: LoginPanelProps) {
  const [authView, setAuthView] = useState<"options" | AuthChannel>("options");
  const selectedCountryCode = getCountryDialCode(props.countryCode);
  const phoneSuffix = sanitizePhoneSuffix(props.destination, selectedCountryCode.suffixLength);
  const contactIsValid = isSignupContactValid(props.channel, props.countryCode, props.destination);
  const isSettingPin = !props.hasLoginPin;
  const needsOtp = props.isRecoveringPin || isSettingPin;
  const showPhoneAuth =
    authView === "phone" || props.challenge !== null || props.isRecoveringPin || !props.hasLoginPin;

  return (
    <main className="setup-grid auth-landing-grid login-grid">
      <section className="panel auth-card">
        {!showPhoneAuth ? (
          <SocialLoginOptions
            mode="login"
            oauthProviders={props.oauthProviders}
            oauthProvidersLoaded={props.oauthProvidersLoaded}
            isOtherSocialOpen={props.isOtherSocialOpen}
            onSelectPhone={() => {
              props.onChannelChange("phone");
              setAuthView("phone");
            }}
            onSelectEmail={() => {
              props.onChannelChange("email");
              setAuthView("email");
            }}
            onSelectProvider={props.onSocialLogin}
            onOpenOther={props.onOpenOtherSocial}
            onCloseOther={props.onCloseOtherSocial}
          />
        ) : (
          <>
            <div className="auth-heading-row">
              <div className="section-heading">
                <p className="eyebrow">Continue with {props.channel}</p>
                <h2>Signup or login</h2>
              </div>
            </div>
            <div className="segmented" aria-label="Login channel">
              <button
                className={props.channel === "phone" ? "active" : ""}
                type="button"
                onClick={() => props.onChannelChange("phone")}
              >
                Phone
              </button>
              <button
                className={props.channel === "email" ? "active" : ""}
                type="button"
                onClick={() => props.onChannelChange("email")}
              >
                Email
              </button>
            </div>
            {props.channel === "phone" ? (
              <div className="phone-contact-row">
                <label>
                  Country code
                  <select
                    value={props.countryCode}
                    onChange={(event) =>
                      props.onCountryCodeChange(event.target.value as CountryDialCode)
                    }
                  >
                    {countryDialCodes.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.flag} {item.code} {item.country}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Phone number
                  <input
                    value={phoneSuffix}
                    onChange={(event) =>
                      props.onDestinationChange(
                        sanitizePhoneSuffix(event.target.value, selectedCountryCode.suffixLength)
                      )
                    }
                    inputMode="numeric"
                    maxLength={selectedCountryCode.suffixLength}
                    pattern="[0-9]*"
                    type="tel"
                    placeholder={"0".repeat(selectedCountryCode.suffixLength)}
                  />
                </label>
              </div>
            ) : (
              <label>
                Email address
                <input
                  value={props.destination}
                  onChange={(event) => props.onDestinationChange(event.target.value)}
                  inputMode="email"
                  type="email"
                  placeholder="owner@example.com"
                />
              </label>
            )}
            {needsOtp ? (
              <>
                <button type="button" onClick={props.onRequestOtp} disabled={!contactIsValid}>
                  Continue
                </button>
                <label>
                  OTP
                  <input
                    value={props.otp}
                    onChange={(event) => props.onOtpChange(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
                <button
                  type="button"
                  onClick={props.onVerifyOtp}
                  disabled={props.challenge === null}
                >
                  Verify OTP
                </button>
              </>
            ) : (
              <p className="shell-note">
                Use your saved phone number and PIN to unlock this device.
              </p>
            )}
          </>
        )}
      </section>

      {showPhoneAuth ? (
        <section className="panel auth-card">
          <div className="section-heading">
            <p className="eyebrow">
              {isSettingPin ? "PIN setup" : props.isRecoveringPin ? "PIN recovery" : "Login PIN"}
            </p>
            <h2>{isSettingPin ? "Set PIN" : props.isRecoveringPin ? "Reset PIN" : "Enter PIN"}</h2>
          </div>
          {props.isRecoveringPin || isSettingPin ? (
            <>
              <label>
                {isSettingPin ? "PIN" : "New PIN"}
                <input
                  value={props.recoveryPin}
                  onChange={(event) => props.onRecoveryPinChange(sanitizePin(event.target.value))}
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]*"
                  type="password"
                  placeholder="4-digit PIN"
                />
              </label>
              <label>
                {isSettingPin ? "Confirm PIN" : "Confirm new PIN"}
                <input
                  value={props.recoveryPinConfirm}
                  onChange={(event) =>
                    props.onRecoveryPinConfirmChange(sanitizePin(event.target.value))
                  }
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]*"
                  type="password"
                  placeholder="Confirm PIN"
                />
              </label>
              <button
                type="button"
                onClick={isSettingPin ? props.onSetMissingPin : props.onRecoverPin}
                disabled={
                  !props.isOtpVerified ||
                  !isValidPin(props.recoveryPin) ||
                  props.recoveryPin !== props.recoveryPinConfirm
                }
              >
                {isSettingPin ? "Set PIN" : "Reset PIN"}
              </button>
              {!isSettingPin ? (
                <button className="secondary" type="button" onClick={props.onCancelPinRecovery}>
                  Back to PIN login
                </button>
              ) : null}
            </>
          ) : (
            <>
              <label>
                PIN
                <input
                  value={props.loginPin}
                  onChange={(event) => props.onLoginPinChange(sanitizePin(event.target.value))}
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]*"
                  type="password"
                  placeholder="4-digit PIN"
                />
              </label>
              <button
                type="button"
                onClick={props.onLogin}
                disabled={!contactIsValid || !isValidPin(props.loginPin)}
              >
                Login
              </button>
              {props.hasLoginPin ? (
                <button className="secondary" type="button" onClick={props.onStartPinRecovery}>
                  Forgot PIN?
                </button>
              ) : null}
              <button className="secondary" type="button" onClick={() => setAuthView("options")}>
                Back to login options
              </button>
            </>
          )}
          <p className="setup-status" role="status" aria-live="polite">
            {props.statusMessage}
          </p>
        </section>
      ) : (
        <p className="setup-status auth-status" role="status" aria-live="polite">
          {props.statusMessage}
        </p>
      )}
    </main>
  );
}

interface SyncSurfaceProps {
  summary: SyncQueueSummary;
  items: SyncQueueItem[];
  offlineCache: OfflineCacheSnapshot | null;
  storefrontUrl: string;
  onInvite: () => void;
  onExportContacts: () => void;
  onImportContacts: (event: ChangeEvent<HTMLInputElement>) => void;
  onRefresh: () => void;
  onReplay: () => void;
  onReplayItem: (syncItemId: string) => void;
  onSyncContacts: () => void;
}

interface NetworkSurfaceProps {
  graph: NetworkGraphSummary | null;
  onRefresh: () => void;
  onSyncContacts: () => void;
  onSyncSocial: (provider: "instagram" | "whatsapp" | "tiktok" | "x") => void;
  onRoute: (targetNodeId?: string) => void;
  onApproveRoute: (routeId: string) => void;
  onRejectRoute: (routeId: string) => void;
  onDisconnectSource: (sourceId: string) => void;
}

function NetworkSurface(props: NetworkSurfaceProps) {
  const directNodes = props.graph?.nodes.filter((node) => node.degree === 1) ?? [];
  const directPhoneNodes = directNodes.filter((node) => node.sourceType === "phone_contact");
  const directSocialNodes = directNodes.filter((node) => node.sourceType === "social");
  const extendedNodes = props.graph?.nodes.filter((node) => node.degree === 2) ?? [];
  const activeSources = props.graph?.sources.filter((source) => source.status === "active") ?? [];

  return (
    <section className="record-list network-card">
      <div className="surface-header-row">
        <div>
          <p className="eyebrow">Commerce graph</p>
          <h3>Network</h3>
          <p className="shell-note">
            Your contacts help Soko build your first commerce network. Social connections expand it;
            friends-of-friends are reached through friends' agents.
          </p>
        </div>
        <button className="secondary" type="button" onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      <div className="network-actions">
        <button type="button" onClick={props.onSyncContacts}>
          Sync contacts
        </button>
        {(["instagram", "whatsapp", "tiktok", "x"] as const).map((provider) => (
          <button
            className="secondary"
            key={provider}
            type="button"
            onClick={() => props.onSyncSocial(provider)}
          >
            Connect {provider}
          </button>
        ))}
      </div>

      <div className="network-metrics">
        <span>
          <strong>{directPhoneNodes.length}</strong>
          Phone contacts
        </span>
        <span>
          <strong>{directSocialNodes.length}</strong>
          Social connections
        </span>
        <span>
          <strong>{extendedNodes.length}</strong>
          Agent-routed
        </span>
      </div>

      <div className="network-columns">
        <NetworkNodeList title="Direct contacts" nodes={directPhoneNodes} />
        <NetworkNodeList title="Direct social" nodes={directSocialNodes} />
        <div className="network-list">
          <h4>Reachable through agents</h4>
          {extendedNodes.length === 0 ? (
            <p className="shell-note">Second-degree people appear here after sync.</p>
          ) : (
            extendedNodes.map((node) => (
              <article key={node.id}>
                <span>{node.displayName}</span>
                <small>{node.visibilityStatus.replace("_", " ")}</small>
                <button className="secondary" type="button" onClick={() => props.onRoute(node.id)}>
                  Route through agent
                </button>
              </article>
            ))
          )}
        </div>
      </div>

      {activeSources.length > 0 ? (
        <div className="network-source-list">
          <h4>Connected sources</h4>
          {activeSources.map((source) => (
            <article key={source.id}>
              <span>{source.displayName}</span>
              <small>
                {source.directCount} direct · {source.extendedCount} extended
              </small>
              <button
                className="secondary"
                type="button"
                onClick={() => props.onDisconnectSource(source.id)}
              >
                Disconnect
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {props.graph !== null && props.graph.routes.length > 0 ? (
        <div className="network-route-list">
          <h4>Agent routes</h4>
          {props.graph.routes.map((route) => (
            <article key={route.id}>
              <span>{route.status.replace("_", " ")}</span>
              <strong>{route.path.join(" -> ")}</strong>
              <small>{route.requestText}</small>
              {route.status === "pending_permission" ? (
                <div className="row-actions compact-actions">
                  <button type="button" onClick={() => props.onApproveRoute(route.id)}>
                    Approve
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => props.onRejectRoute(route.id)}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NetworkNodeList({ nodes, title }: { nodes: NetworkNodeSummary[]; title: string }) {
  return (
    <div className="network-list">
      <h4>{title}</h4>
      {nodes.length === 0 ? (
        <p className="shell-note">No entries yet.</p>
      ) : (
        nodes.map((node) => (
          <article key={node.id}>
            <span>{node.displayName}</span>
            <small>{node.sourcePlatform ?? node.sourceType}</small>
          </article>
        ))
      )}
    </div>
  );
}

function SyncSurface(props: SyncSurfaceProps) {
  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Sync queue actions">
        <div className="section-heading">
          <p className="eyebrow">Sync</p>
          <h3>Offline queue</h3>
        </div>
        <div className="metric-grid compact">
          <div className="metric">
            <span>Pending</span>
            <strong>{props.summary.pending}</strong>
          </div>
          <div className="metric">
            <span>Conflicts</span>
            <strong>{props.summary.conflict}</strong>
          </div>
          <div className="metric">
            <span>Failed</span>
            <strong>{props.summary.failed}</strong>
          </div>
          <div className="metric">
            <span>Synced</span>
            <strong>{props.summary.synced}</strong>
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={props.onReplay} disabled={props.summary.total === 0}>
            Retry queue
          </button>
          <button className="secondary" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
        <div className="sync-share-panel">
          <div>
            <span>Network Sync</span>
            <strong>Contacts and invites</strong>
            <p>{props.storefrontUrl}</p>
          </div>
          <div className="sync-share-actions">
            <button type="button" onClick={props.onSyncContacts}>
              Sync contacts
            </button>
            <button className="secondary" type="button" onClick={props.onInvite}>
              Invite link
            </button>
            <label className="secondary file-action">
              Import contacts
              <input accept=".csv,.vcf,.txt,text/*" type="file" onChange={props.onImportContacts} />
            </label>
            <button className="secondary" type="button" onClick={props.onExportContacts}>
              Export contacts
            </button>
          </div>
        </div>
      </section>

      <section className="record-list" aria-label="Offline cache">
        <div className="surface-header-row">
          <div className="section-heading">
            <p className="eyebrow">Offline cache</p>
            <h3>Server snapshot available on device</h3>
          </div>
          <button className="secondary" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
        {props.offlineCache === null ? (
          <div className="empty-record">
            <h3>No cache snapshot loaded</h3>
            <p>Refresh sync to load the current offline-readable business snapshot.</p>
          </div>
        ) : (
          <>
            <p className="shell-note">
              Captured {new Date(props.offlineCache.capturedAt).toLocaleString()}
            </p>
            <div className="metric-grid compact">
              <div className="metric">
                <span>Products</span>
                <strong>{props.offlineCache.products.length}</strong>
              </div>
              <div className="metric">
                <span>Customers</span>
                <strong>{props.offlineCache.customers.length}</strong>
              </div>
              <div className="metric">
                <span>Suppliers</span>
                <strong>{props.offlineCache.suppliers.length}</strong>
              </div>
              <div className="metric">
                <span>Invoices</span>
                <strong>{props.offlineCache.invoices.length}</strong>
              </div>
              <div className="metric">
                <span>Payments</span>
                <strong>{props.offlineCache.payments.length}</strong>
              </div>
              <div className="metric">
                <span>Movements</span>
                <strong>{props.offlineCache.inventoryMovements.length}</strong>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="record-list" aria-label="Sync queue list">
        {props.items.length === 0 ? (
          <EmptyStateSurface
            title="No queued work"
            body="Offline mutations will appear here until server replay confirms or rejects them."
            onChat={props.onRefresh}
            actionLabel="Refresh"
          />
        ) : (
          props.items.map((item) => (
            <article className="record-row" key={item.id}>
              <div>
                <p className="eyebrow">{item.status}</p>
                <h4>{item.mutationType}</h4>
                <p>{new Date(item.clientCreatedAt).toLocaleString()}</p>
                {item.conflict !== null ? <p>{item.conflict.message}</p> : null}
              </div>
              <div className="row-actions compact-actions">
                <strong>{item.attempts}</strong>
                {item.status === "failed" || item.status === "conflict" ? (
                  <button type="button" onClick={() => props.onReplayItem(item.id)}>
                    Retry
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface RuntimeSurfaceProps {
  sessions: RuntimeSessionSummary[];
  selectedSessionId: string | null;
  turns: RuntimeTurnSummary[];
  onCreateSession: () => void;
  onRefresh: () => void;
  onSelectSession: (sessionId: string) => void;
}

function RuntimeSurface(props: RuntimeSurfaceProps) {
  const selectedSession = props.sessions.find((session) => session.id === props.selectedSessionId);

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Runtime controls">
        <div className="surface-header-row">
          <div className="section-heading">
            <p className="eyebrow">Agent runtime</p>
            <h3>Sessions and turns</h3>
          </div>
          <button type="button" onClick={props.onCreateSession}>
            New session
          </button>
        </div>
        <div className="actions">
          <button className="secondary" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
          {selectedSession === undefined ? null : (
            <button
              className="secondary"
              type="button"
              onClick={() => props.onSelectSession(selectedSession.id)}
            >
              Reload turns
            </button>
          )}
        </div>
        <p className="shell-note">
          Review what the agent understood, which tool it planned, and the response returned for
          each owner task.
        </p>
      </section>

      <section className="record-list" aria-label="Runtime sessions">
        <div className="section-heading">
          <p className="eyebrow">Sessions</p>
          <h3>Conversation runs</h3>
        </div>
        {props.sessions.length === 0 ? (
          <EmptyStateSurface
            title="No runtime sessions yet"
            body="Send an owner chat task or create a session to start tracking turns."
            onChat={props.onCreateSession}
            actionLabel="Create session"
          />
        ) : (
          props.sessions.map((session) => (
            <article className="record-row" key={session.id}>
              <div>
                <p className="eyebrow">{session.status}</p>
                <h4>{session.turnCount} turn runtime session</h4>
                <p>{new Date(session.createdAt).toLocaleString()}</p>
              </div>
              <button
                className={props.selectedSessionId === session.id ? "active" : ""}
                type="button"
                onClick={() => props.onSelectSession(session.id)}
              >
                View
              </button>
            </article>
          ))
        )}
      </section>

      <section className="record-list" aria-label="Runtime turns">
        <div className="section-heading">
          <p className="eyebrow">Turns</p>
          <h3>{selectedSession === undefined ? "Select a session" : "Runtime history"}</h3>
        </div>
        {selectedSession === undefined ? (
          <div className="empty-record">
            <h3>No session selected</h3>
            <p>Select a runtime session to inspect its turns.</p>
          </div>
        ) : props.turns.length === 0 ? (
          <div className="empty-record">
            <h3>No turns in this session</h3>
            <p>Use the chat composer to send a task through this runtime session.</p>
          </div>
        ) : (
          props.turns.map((turn) => (
            <article className="record-row runtime-turn-row" key={turn.id}>
              <div>
                <p className="eyebrow">{turn.status}</p>
                <h4>{turn.plan.toolName}</h4>
                <p>{turn.message}</p>
                <small>{turn.response}</small>
              </div>
              <span>{new Date(turn.createdAt).toLocaleTimeString()}</span>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface PaymentSurfaceProps {
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  invoicePayments: InvoicePaymentSummary[];
  customerDebts: CustomerDebtSummary[];
  form: PaymentFormState;
  onFormChange: (form: PaymentFormState) => void;
  onRecord: () => void;
  onRefresh: () => void;
}

function PaymentSurface(props: PaymentSurfaceProps) {
  const confirmedInvoices = props.invoices.filter((invoice) => invoice.status === "confirmed");
  const selectedSummary = props.invoicePayments.find(
    (summary) => summary.invoiceId === props.form.invoiceId
  );
  const unpaidInvoices = props.invoicePayments.filter((summary) => summary.status !== "paid");

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Payment form">
        <div className="section-heading">
          <p className="eyebrow">Payment</p>
          <h3>Record invoice payment</h3>
        </div>
        <label>
          Invoice
          <select
            value={props.form.invoiceId}
            onChange={(event) => {
              const summary = props.invoicePayments.find(
                (item) => item.invoiceId === event.target.value
              );
              props.onFormChange({
                ...props.form,
                invoiceId: event.target.value,
                amount: summary === undefined ? props.form.amount : String(summary.balanceDue)
              });
            }}
          >
            <option value="">Select confirmed invoice</option>
            {confirmedInvoices.map((invoice) => {
              const summary = props.invoicePayments.find((item) => item.invoiceId === invoice.id);

              return (
                <option key={invoice.id} value={invoice.id} disabled={summary?.status === "paid"}>
                  {invoice.invoiceNumber} - {invoice.customerName ?? "Walk-in"} -{" "}
                  {formatMoney(summary?.balanceDue ?? invoice.total)}
                </option>
              );
            })}
          </select>
        </label>
        <div className="form-row">
          <label>
            Amount
            <input
              value={props.form.amount}
              onChange={(event) =>
                props.onFormChange({ ...props.form, amount: event.target.value })
              }
              inputMode="decimal"
            />
          </label>
          <label>
            Method
            <select
              value={props.form.method}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  method: event.target.value as PaymentMethod
                })
              }
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_money_manual">Manual mobile money</option>
              <option value="card_manual">Manual card</option>
              <option value="other_manual">Other manual</option>
            </select>
          </label>
        </div>
        <label>
          Reference
          <input
            value={props.form.reference}
            onChange={(event) =>
              props.onFormChange({ ...props.form, reference: event.target.value })
            }
          />
        </label>
        <label>
          Note
          <textarea
            value={props.form.note}
            onChange={(event) => props.onFormChange({ ...props.form, note: event.target.value })}
            rows={3}
          />
        </label>
        {selectedSummary !== undefined ? (
          <div className="metric-grid compact">
            <div className="metric">
              <span>Total</span>
              <strong>{formatMoney(selectedSummary.invoiceTotal)}</strong>
            </div>
            <div className="metric">
              <span>Paid</span>
              <strong>{formatMoney(selectedSummary.paidTotal)}</strong>
            </div>
            <div className="metric">
              <span>Due</span>
              <strong>{formatMoney(selectedSummary.balanceDue)}</strong>
            </div>
          </div>
        ) : null}
        <div className="actions">
          <button
            type="button"
            onClick={props.onRecord}
            disabled={props.form.invoiceId === "" || Number(props.form.amount) <= 0}
          >
            Record
          </button>
          <button className="secondary" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
      </section>

      <section className="record-list" aria-label="Invoice settlement">
        <div className="section-heading">
          <p className="eyebrow">Settlement</p>
          <h3>Open invoice balances</h3>
        </div>
        {unpaidInvoices.length === 0 ? (
          <div className="empty-record">
            <h3>No open balances</h3>
            <p>Confirmed unpaid invoices will appear here.</p>
          </div>
        ) : (
          unpaidInvoices.map((summary) => (
            <article className="record-row" key={summary.invoiceId}>
              <div>
                <strong>
                  {summary.invoiceNumber} - {summary.status.replace("_", " ")}
                </strong>
                <span>
                  {summary.customerName ?? "Walk-in customer"} - due{" "}
                  {formatMoney(summary.balanceDue)}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  props.onFormChange({
                    ...props.form,
                    invoiceId: summary.invoiceId,
                    amount: String(summary.balanceDue)
                  })
                }
              >
                Pay
              </button>
            </article>
          ))
        )}
      </section>

      <section className="record-list" aria-label="Customer debt">
        <div className="section-heading">
          <p className="eyebrow">Debt</p>
          <h3>Customer balances</h3>
        </div>
        {props.customerDebts.length === 0 ? (
          <div className="empty-record">
            <h3>No customer debt</h3>
            <p>Customer-linked invoice balances are clear.</p>
          </div>
        ) : (
          props.customerDebts.map((debt) => (
            <article className="record-row" key={debt.customerId}>
              <div>
                <strong>{debt.customerName}</strong>
                <span>
                  {debt.invoiceCount} invoice{debt.invoiceCount === 1 ? "" : "s"} - paid{" "}
                  {formatMoney(debt.totalPaid)}
                </span>
              </div>
              <strong>{formatMoney(debt.balanceDue)}</strong>
            </article>
          ))
        )}
      </section>

      <section className="record-list" aria-label="Recent payments">
        <div className="section-heading">
          <p className="eyebrow">Ledger</p>
          <h3>Recent payments</h3>
        </div>
        {props.payments.length === 0 ? (
          <div className="empty-record">
            <h3>No payments yet</h3>
            <p>Record a payment against a confirmed invoice.</p>
          </div>
        ) : (
          props.payments.map((payment) => (
            <article className="record-row" key={payment.id}>
              <div>
                <strong>
                  {payment.invoiceNumber} - {formatMoney(payment.amount)}
                </strong>
                <span>
                  {payment.customerName ?? "Walk-in customer"} -{" "}
                  {payment.method.replaceAll("_", " ")}
                </span>
              </div>
              <span>{new Date(payment.createdAt).toLocaleDateString()}</span>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface ImportSurfaceProps {
  form: ImportFormState;
  importJobs: DocumentImportJobSummary[];
  activeImportJob: DocumentImportJobSummary | null;
  selectedImportJobId: string | null;
  onFormChange: (form: ImportFormState) => void;
  onCreate: () => void;
  onSelectJob: (jobId: string) => void;
  onRowChange: (input: {
    importJobId: string;
    rowNumber: number;
    mapped: DocumentImportDraft;
    selected: boolean;
  }) => void;
  onSaveRow: (job: DocumentImportJobSummary, row: DocumentImportPreviewRow) => void;
  onConfirm: (job: DocumentImportJobSummary) => void;
  onRefresh: () => void;
}

interface ImportSourceTemplate {
  id: string;
  label: string;
  summary: string;
  sourceType: ImportFormState["sourceType"];
  sourceLocator: string;
  fileName: string;
  contentType: string;
  content: string;
}

function ImportSurface(props: ImportSurfaceProps) {
  const selectedRows = props.activeImportJob?.rows.filter((row) => row.selected) ?? [];
  const invalidSelectedRows = selectedRows.filter((row) => row.errors.length > 0);
  const sourceTemplates = createImportSourceTemplates(props.form.target);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file === undefined) {
      return;
    }

    const content = await file.text();
    props.onFormChange({
      ...props.form,
      fileName: file.name,
      contentType: file.type || inferImportContentType(file.name),
      content
    });
    event.target.value = "";
  }

  function applySourceTemplate(template: ImportSourceTemplate) {
    props.onFormChange({
      ...props.form,
      sourceType: template.sourceType,
      sourceLocator: template.sourceLocator,
      fileName: template.fileName,
      contentType: template.contentType,
      content: template.content
    });
  }

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Catalogue document import">
        <div className="section-heading">
          <p className="eyebrow">Purchase receipts</p>
          <h3>Upload receipt or supplier records</h3>
        </div>
        <label>
          Import target
          <select
            value={props.form.target}
            onChange={(event) => {
              const target = event.target.value as DocumentImportTarget;
              props.onFormChange({
                ...props.form,
                target,
                sourceType: target === "product" ? props.form.sourceType : "upload",
                sourceLocator: "",
                fileName: target === "product" ? "products.csv" : "suppliers.csv",
                contentType: "text/csv",
                content:
                  target === "product"
                    ? "name,sku,unit,quantity,buyingPrice,sellingPrice\nTomatoes,TOM-001,kg,20,60,90"
                    : "name,phone,email,notes\nWholesale Depot,+254700000010,supply@example.com,Main supplier"
              });
            }}
          >
            <option value="product">Product catalogue</option>
            <option value="supplier">Supplier contacts</option>
          </select>
        </label>
        <label>
          Source
          <select
            value={props.form.sourceType}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                sourceType: event.target.value as ImportFormState["sourceType"]
              })
            }
          >
            <option value="upload">Upload document</option>
            <option value="paste">Paste document/export</option>
            <option value="database">Existing database link or export</option>
          </select>
        </label>
        <label>
          Source reference
          <input
            value={props.form.sourceLocator}
            onChange={(event) =>
              props.onFormChange({ ...props.form, sourceLocator: event.target.value })
            }
            placeholder="Sheet URL, database export name, table, or connection reference"
          />
        </label>
        <div className="import-source-grid" aria-label="Import source options">
          {sourceTemplates.map((template) => (
            <button
              key={template.id}
              className={props.form.fileName === template.fileName ? "active" : ""}
              type="button"
              onClick={() => applySourceTemplate(template)}
            >
              <span>{template.label}</span>
              <small>{template.summary}</small>
            </button>
          ))}
        </div>
        <label>
          Upload document, sheet, PDF/Word export, or database export
          <input
            accept={[
              ".csv",
              ".tsv",
              ".txt",
              ".json",
              ".sql",
              ".pdf",
              ".doc",
              ".docx",
              ".odt",
              ".ods",
              ".xls",
              ".xlsx",
              "text/*",
              "application/json",
              "application/pdf"
            ].join(",")}
            type="file"
            onChange={(event) => void handleFileChange(event)}
          />
        </label>
        <label>
          File name
          <input
            value={props.form.fileName}
            onChange={(event) =>
              props.onFormChange({ ...props.form, fileName: event.target.value })
            }
          />
        </label>
        <label>
          Content type
          <input
            value={props.form.contentType}
            onChange={(event) =>
              props.onFormChange({ ...props.form, contentType: event.target.value })
            }
          />
        </label>
        <label>
          Document or export content
          <textarea
            value={props.form.content}
            onChange={(event) => props.onFormChange({ ...props.form, content: event.target.value })}
            rows={7}
          />
        </label>
        <p className="form-hint">
          Supports CSV/TSV sheets, JSON or SQL database exports, text copied from PDF or Word
          documents, and database export references. Paste exported content here; do not paste
          passwords or private keys.
        </p>
        <div className="actions">
          <button
            type="button"
            onClick={props.onCreate}
            disabled={props.form.fileName.trim() === "" || props.form.content.trim() === ""}
          >
            Preview
          </button>
          <button className="secondary" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
      </section>

      <section className="record-list" aria-label="Import jobs">
        <div className="section-heading">
          <p className="eyebrow">Supplier records</p>
          <h3>Purchase receipts</h3>
        </div>
        {props.importJobs.length === 0 ? (
          <div className="empty-record">
            <h3>No purchase receipts yet</h3>
            <p>Preview a catalogue document before confirming new records.</p>
          </div>
        ) : (
          props.importJobs.map((job) => (
            <article className="record-row" key={job.id}>
              <div>
                <strong>
                  {job.source.fileName} - {job.target} - {job.status}
                </strong>
                <span>
                  {job.rows.length} row{job.rows.length === 1 ? "" : "s"} - {job.confirmedCount}{" "}
                  confirmed
                </span>
              </div>
              <button
                type="button"
                className={props.selectedImportJobId === job.id ? "active" : ""}
                onClick={() => props.onSelectJob(job.id)}
              >
                View
              </button>
            </article>
          ))
        )}
      </section>

      {props.activeImportJob !== null ? (
        <section className="record-list" aria-label="Import preview rows">
          <div className="section-heading">
            <p className="eyebrow">Supplier records</p>
            <h3>Review rows</h3>
          </div>
          <div className="metric-grid compact">
            <div className="metric">
              <span>Rows</span>
              <strong>{props.activeImportJob.rows.length}</strong>
            </div>
            <div className="metric">
              <span>Selected</span>
              <strong>{selectedRows.length}</strong>
            </div>
            <div className="metric">
              <span>Invalid</span>
              <strong>{invalidSelectedRows.length}</strong>
            </div>
          </div>
          {props.activeImportJob.errorMessage !== null ? (
            <div className="empty-record">
              <h3>Import failed</h3>
              <p>{props.activeImportJob.errorMessage}</p>
            </div>
          ) : null}
          {props.activeImportJob.rows.map((row) =>
            props.activeImportJob?.target === "product" ? (
              <ProductImportRowEditor
                importJobId={props.activeImportJob.id}
                key={row.rowNumber}
                row={row}
                disabled={props.activeImportJob.status !== "previewed"}
                onRowChange={props.onRowChange}
                onSave={() =>
                  props.activeImportJob !== null && props.onSaveRow(props.activeImportJob, row)
                }
              />
            ) : (
              <SupplierImportRowEditor
                importJobId={props.activeImportJob?.id ?? ""}
                key={row.rowNumber}
                row={row}
                disabled={props.activeImportJob?.status !== "previewed"}
                onRowChange={props.onRowChange}
                onSave={() =>
                  props.activeImportJob !== null && props.onSaveRow(props.activeImportJob, row)
                }
              />
            )
          )}
          <button
            type="button"
            onClick={() => props.activeImportJob !== null && props.onConfirm(props.activeImportJob)}
            disabled={
              props.activeImportJob.status !== "previewed" ||
              selectedRows.length === 0 ||
              invalidSelectedRows.length > 0
            }
          >
            Confirm selected
          </button>
        </section>
      ) : null}
    </div>
  );
}

interface ImportRowEditorProps {
  importJobId: string;
  row: DocumentImportPreviewRow;
  disabled: boolean;
  onRowChange: (input: {
    importJobId: string;
    rowNumber: number;
    mapped: DocumentImportDraft;
    selected: boolean;
  }) => void;
  onSave: () => void;
}

function SupplierImportRowEditor(props: ImportRowEditorProps) {
  const mapped = asSupplierImportDraft(props.row.mapped);

  function updateMapped(mapped: SupplierImportDraft, selected = props.row.selected) {
    props.onRowChange({
      importJobId: props.importJobId,
      rowNumber: props.row.rowNumber,
      mapped,
      selected
    });
  }

  return (
    <article className="import-row">
      <div className="import-row-header">
        <label className="inline-check">
          <input
            checked={props.row.selected}
            disabled={props.disabled}
            type="checkbox"
            onChange={(event) =>
              props.onRowChange({
                importJobId: props.importJobId,
                rowNumber: props.row.rowNumber,
                mapped,
                selected: event.target.checked
              })
            }
          />
          Row {props.row.rowNumber}
        </label>
        <span>{props.row.errors.length === 0 ? "Valid" : "Needs correction"}</span>
      </div>
      <div className="form-row">
        <label>
          Name
          <input
            value={mapped.name}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, name: event.target.value })}
          />
        </label>
        <label>
          Phone
          <input
            value={mapped.phone ?? ""}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, phone: event.target.value || null })}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Email
          <input
            value={mapped.email ?? ""}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, email: event.target.value || null })}
          />
        </label>
        <label>
          Notes
          <input
            value={mapped.notes ?? ""}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, notes: event.target.value || null })}
          />
        </label>
      </div>
      {props.row.errors.length > 0 ? <p>{props.row.errors.join(" ")}</p> : null}
      <button type="button" onClick={props.onSave} disabled={props.disabled}>
        Save row
      </button>
    </article>
  );
}

function ProductImportRowEditor(props: ImportRowEditorProps) {
  const mapped = asProductImportDraft(props.row.mapped);

  function updateMapped(mapped: ProductImportDraft, selected = props.row.selected) {
    props.onRowChange({
      importJobId: props.importJobId,
      rowNumber: props.row.rowNumber,
      mapped,
      selected
    });
  }

  return (
    <article className="import-row">
      <div className="import-row-header">
        <label className="inline-check">
          <input
            checked={props.row.selected}
            disabled={props.disabled}
            type="checkbox"
            onChange={(event) =>
              props.onRowChange({
                importJobId: props.importJobId,
                rowNumber: props.row.rowNumber,
                mapped,
                selected: event.target.checked
              })
            }
          />
          Row {props.row.rowNumber}
        </label>
        <span>{props.row.errors.length === 0 ? "Valid" : "Needs correction"}</span>
      </div>
      <div className="form-row">
        <label>
          Name
          <input
            value={mapped.name}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, name: event.target.value })}
          />
        </label>
        <label>
          SKU
          <input
            value={mapped.sku ?? ""}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, sku: event.target.value || null })}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Unit
          <input
            value={mapped.unit}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...mapped, unit: event.target.value || "unit" })}
          />
        </label>
        <label>
          Quantity
          <input
            min="0"
            type="number"
            value={mapped.quantity}
            disabled={props.disabled}
            onChange={(event) =>
              updateMapped({ ...mapped, quantity: Number.parseFloat(event.target.value) || 0 })
            }
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Buying price
          <input
            min="0"
            type="number"
            value={mapped.buyingPrice ?? ""}
            disabled={props.disabled}
            onChange={(event) =>
              updateMapped({
                ...mapped,
                buyingPrice:
                  event.target.value === "" ? null : Number.parseFloat(event.target.value)
              })
            }
          />
        </label>
        <label>
          Selling price
          <input
            min="0"
            type="number"
            value={mapped.sellingPrice ?? ""}
            disabled={props.disabled}
            onChange={(event) =>
              updateMapped({
                ...mapped,
                sellingPrice:
                  event.target.value === "" ? null : Number.parseFloat(event.target.value)
              })
            }
          />
        </label>
      </div>
      {props.row.errors.length > 0 ? <p>{props.row.errors.join(" ")}</p> : null}
      <button type="button" onClick={props.onSave} disabled={props.disabled}>
        Save row
      </button>
    </article>
  );
}

interface LogisticsSurfaceProps {
  invoices: InvoiceSummary[];
  logistics: LogisticsSummary[];
  form: LogisticsFormState;
  onFormChange: (form: LogisticsFormState) => void;
  onCreate: () => void;
  onStatusChange: (logisticsId: string, status: FulfillmentStatus) => void;
  onRefresh: () => void;
}

function LogisticsSurface(props: LogisticsSurfaceProps) {
  const linkedInvoiceIds = new Set(props.logistics.map((item) => item.invoiceId));
  const availableInvoices = props.invoices.filter(
    (invoice) => invoice.status === "confirmed" && !linkedInvoiceIds.has(invoice.id)
  );
  const activeCount = props.logistics.filter(
    (item) => item.status !== "completed" && item.status !== "cancelled"
  ).length;

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Logistics form">
        <div className="section-heading">
          <p className="eyebrow">Logistics</p>
          <h3>Create fulfillment</h3>
        </div>
        <label>
          Confirmed invoice
          <select
            value={props.form.invoiceId}
            onChange={(event) =>
              props.onFormChange({ ...props.form, invoiceId: event.target.value })
            }
          >
            <option value="">Select invoice</option>
            {availableInvoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoiceNumber} - {invoice.customerName ?? "Walk-in customer"}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" aria-label="Fulfillment method">
          <button
            className={props.form.method === "delivery" ? "active" : ""}
            type="button"
            onClick={() => props.onFormChange({ ...props.form, method: "delivery" })}
          >
            Delivery
          </button>
          <button
            className={props.form.method === "pickup" ? "active" : ""}
            type="button"
            onClick={() => props.onFormChange({ ...props.form, method: "pickup" })}
          >
            Pickup
          </button>
        </div>
        <label>
          Destination
          <input
            value={props.form.destination}
            onChange={(event) =>
              props.onFormChange({ ...props.form, destination: event.target.value })
            }
          />
        </label>
        <label>
          Note
          <input
            value={props.form.note}
            onChange={(event) => props.onFormChange({ ...props.form, note: event.target.value })}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={props.onCreate} disabled={props.form.invoiceId === ""}>
            Create
          </button>
          <button className="secondary" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
      </section>

      <section className="record-list" aria-label="Logistics records">
        <div className="section-heading">
          <p className="eyebrow">{activeCount} active</p>
          <h3>Fulfillment work</h3>
        </div>
        {props.logistics.length === 0 ? (
          <div className="empty-record">
            <h3>No logistics yet</h3>
            <p>Create fulfillment work from a confirmed invoice.</p>
          </div>
        ) : (
          props.logistics.map((item) => (
            <article className="record-row logistics-row" key={item.id}>
              <div>
                <strong>
                  {item.invoiceNumber} - {item.status.replaceAll("_", " ")}
                </strong>
                <span>
                  {item.method} - {item.customerName ?? "Walk-in customer"}
                  {item.destination === null ? "" : ` - ${item.destination}`}
                </span>
              </div>
              <div className="compact-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onStatusChange(item.id, "ready")}
                  disabled={item.status !== "pending"}
                >
                  Ready
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onStatusChange(item.id, "out_for_delivery")}
                  disabled={item.method !== "delivery" || item.status !== "ready"}
                >
                  Dispatch
                </button>
                <button
                  type="button"
                  onClick={() => props.onStatusChange(item.id, "completed")}
                  disabled={
                    item.status === "completed" ||
                    item.status === "cancelled" ||
                    (item.method === "delivery" && item.status !== "out_for_delivery") ||
                    (item.method === "pickup" && item.status !== "ready")
                  }
                >
                  Complete
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onStatusChange(item.id, "cancelled")}
                  disabled={item.status === "completed" || item.status === "cancelled"}
                >
                  Cancel
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface ProductSurfaceProps {
  products: ProductSummary[];
  form: ProductFormState;
  stockProductId: string;
  stockQuantityAfter: string;
  stockReason: string;
  onFormChange: (form: ProductFormState) => void;
  onSave: () => void;
  onReset: () => void;
  onAdd: () => void;
  onEdit: (product: ProductSummary) => void;
  onRemove: (productId: string) => void;
  onStockProductChange: (productId: string) => void;
  onStockQuantityAfterChange: (quantity: string) => void;
  onStockReasonChange: (reason: string) => void;
  onAdjustStock: () => void;
}

function PublicStorefrontChat(props: { agentId: string }) {
  const installPrompt = useInstallPrompt();
  const [storefront, setStorefront] = useState<PublicStorefrontSummary | null>(null);
  const [messages, setMessages] = useState<StorefrontChatMessage[]>([]);
  const [cart, setCart] = useState<StorefrontCartItem[]>([]);
  const [crmNotes, setCrmNotes] = useState<StorefrontCrmNote[]>([]);
  const [draft, setDraft] = useState("");
  const [receiptProductId, setReceiptProductId] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [careNotesOpen, setCareNotesOpen] = useState(true);
  const [checkoutDetails, setCheckoutDetails] = useState<StorefrontCheckoutDetails>({
    name: "",
    phone: "",
    note: ""
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const storefrontFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isActive = true;

    setStatus("loading");
    setError("");
    getJson<PublicStorefrontSummary>(`/public/storefronts/${encodeURIComponent(props.agentId)}`)
      .then((nextStorefront) => {
        if (!isActive) {
          return;
        }

        setStorefront(nextStorefront);
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (!isActive) {
          return;
        }

        setError(caught instanceof Error ? caught.message : "Storefront could not be loaded.");
        setStatus("error");
      });

    return () => {
      isActive = false;
    };
  }, [props.agentId]);

  const products = storefront?.products ?? [];
  const availableProducts = products.filter((product) => product.available);
  const firstAvailableProductId = products.find((product) => product.available)?.id ?? "";
  const receiptProductMissing =
    receiptProductId.length > 0 &&
    products.every((product) => product.id !== receiptProductId || !product.available);
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartProducts = cart
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      return product === undefined ? null : { ...product, quantity: item.quantity };
    })
    .filter((item): item is PublicStorefrontProductSummary & { quantity: number } => item !== null);
  const storefrontCardOpen = receiptOpen || cartProducts.length > 0 || checkoutOpen;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current;

      if (messageList === null) {
        return;
      }

      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    messages.length,
    cartProducts.length,
    checkoutOpen,
    receiptOpen,
    crmNotes.length,
    catalogueOpen,
    careNotesOpen
  ]);

  useEffect(() => {
    if (receiptProductId.length === 0 || receiptProductMissing) {
      setReceiptProductId(firstAvailableProductId);
    }
  }, [firstAvailableProductId, receiptProductId, receiptProductMissing]);

  function appendMessage(author: StorefrontChatMessage["author"], body: string) {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `${author}-${Date.now()}-${currentMessages.length}`,
        author,
        body
      }
    ]);
  }

  function addCrmNote(label: string, body: string) {
    setCareNotesOpen(true);
    setCrmNotes((notes) => [
      ...notes,
      {
        id: `crm-${Date.now()}-${notes.length}`,
        label,
        body
      }
    ]);
  }

  function requestCallback() {
    setCheckoutOpen(true);
    addCrmNote("Callback requested", "Customer asked the storefront agent for follow-up.");
    appendMessage("customer", "I would like a callback.");
    appendMessage(
      "agent",
      "I can help with that. Add your name, phone number, and a note below so the store can follow up."
    );
  }

  function requestVoiceInput() {
    appendMessage("customer", "Voice message");
    appendMessage(
      "agent",
      "Voice input can be connected on supported mobile browsers. Type the message or attach a file here and the store can follow up."
    );
  }

  function handleStorefrontAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const names = files.map((file) => file.name).join(", ");
    addCrmNote("Customer attachment", names);
    appendMessage("customer", `Attached ${names}`);
    appendMessage("agent", "Attachment received. The store can review it with your request.");
  }

  function requestQuote() {
    if (cartCount === 0) {
      appendMessage(
        "agent",
        "Add the products you are interested in first, then I can prepare a quote request."
      );
      return;
    }

    setCheckoutOpen(true);
    addCrmNote("Quote requested", `${cartCount} item${cartCount === 1 ? "" : "s"} selected.`);
    appendMessage("customer", "Please prepare a quote.");
    appendMessage("agent", "I can prepare a quote request. Add your contact details below.");
  }

  function requestSupport() {
    setCheckoutOpen(true);
    addCrmNote("Support requested", "Customer requested help from the storefront chat.");
    appendMessage("customer", "I need customer support.");
    appendMessage(
      "agent",
      "Tell me what you need help with. Add your contact details below if you want the store to follow up."
    );
  }

  function registerNewCustomerByAgent() {
    if (storefront === null) {
      return;
    }

    setCheckoutOpen(true);
    addCrmNote(
      "Assisted registration",
      "Customer asked the storefront agent to help register someone."
    );
    appendMessage("customer", "Help me register someone new.");
    appendMessage(
      "agent",
      `Share ${storefront.sokoId} or the invite link with them. If they are unfamiliar with Soko.market, add their name and phone below and the store can follow up.`
    );
  }

  function addProductToCart(product: PublicStorefrontProductSummary) {
    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.productId === product.id);

      if (existing === undefined) {
        return [...currentCart, { productId: product.id, quantity: 1 }];
      }

      return currentCart.map((item) =>
        item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
      );
    });
    appendMessage("customer", `Add ${product.name} to my order.`);
    appendMessage(
      "agent",
      `${product.name} is in your order. I will ask for your contact details only when you check out.`
    );
  }

  function addReceiptProduct() {
    const product = availableProducts.find((item) => item.id === receiptProductId);

    if (product === undefined) {
      return;
    }

    addProductToCart(product);
    setReceiptOpen(true);
  }

  function updateCartQuantity(productId: string, quantity: number) {
    setCart((currentCart) =>
      quantity <= 0
        ? currentCart.filter((item) => item.productId !== productId)
        : currentCart.map((item) => (item.productId === productId ? { ...item, quantity } : item))
    );
  }

  function removeCartItem(productId: string) {
    setCart((currentCart) => currentCart.filter((item) => item.productId !== productId));
  }

  function handleDraftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (storefrontCardOpen) {
      return;
    }

    const message = draft.trim();

    if (message.length === 0) {
      return;
    }

    setDraft("");
    appendMessage("customer", message);

    const lowerMessage = message.toLowerCase();
    const matchedProduct = findBestPublicProduct(message, availableProducts);

    if (matchedProduct !== null && hasUseVerb(message)) {
      setCart((currentCart) => {
        const existing = currentCart.find((item) => item.productId === matchedProduct.id);

        if (existing === undefined) {
          return [...currentCart, { productId: matchedProduct.id, quantity: 1 }];
        }

        return currentCart.map((item) =>
          item.productId === matchedProduct.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      });
      appendMessage(
        "agent",
        `${matchedProduct.name} is in your order. Resend checkout when you are ready to finish.`
      );
      addCrmNote("Product interest", `Customer added ${matchedProduct.name} from chat.`);
      return;
    }

    if (matchedProduct !== null) {
      appendMessage(
        "agent",
        `I found ${matchedProduct.name}. Resend with an action, for example: add ${matchedProduct.name} to my order.`
      );
      return;
    }

    if (lowerMessage.includes("checkout") || lowerMessage.includes("order")) {
      if (cartCount === 0) {
        appendMessage("agent", "Choose at least one product first, then I can help you check out.");
        return;
      }

      setCheckoutOpen(true);
      appendMessage("agent", "I can prepare checkout now. Please add your details below.");
      return;
    }

    if (
      lowerMessage.includes("quote") ||
      lowerMessage.includes("price") ||
      lowerMessage.includes("estimate")
    ) {
      requestQuote();
      return;
    }

    if (
      lowerMessage.includes("support") ||
      lowerMessage.includes("help") ||
      lowerMessage.includes("complaint") ||
      lowerMessage.includes("return") ||
      lowerMessage.includes("refund") ||
      lowerMessage.includes("delivery")
    ) {
      requestSupport();
      return;
    }

    if (
      lowerMessage.includes("call") ||
      lowerMessage.includes("contact me") ||
      lowerMessage.includes("follow up")
    ) {
      requestCallback();
      return;
    }

    if (
      lowerMessage.includes("product") ||
      lowerMessage.includes("list") ||
      lowerMessage.includes("browse")
    ) {
      setCatalogueOpen(true);
      appendMessage(
        "agent",
        products.length === 0
          ? "There are no available products listed right now."
          : `I found ${products.length} available product${products.length === 1 ? "" : "s"}. Use the product list above to add items.`
      );
      return;
    }

    appendMessage(
      "agent",
      "I can help you browse products and prepare checkout. Pick an item above or ask for the product list."
    );
  }

  function handleCheckoutSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      cartCount === 0 ||
      checkoutDetails.name.trim() === "" ||
      checkoutDetails.phone.trim() === ""
    ) {
      appendMessage(
        "agent",
        "I need your name, phone number, and at least one product to prepare checkout."
      );
      return;
    }

    setCheckoutOpen(false);
    addCrmNote(
      "Contact captured",
      `${checkoutDetails.name.trim()} - ${checkoutDetails.phone.trim()} - ${
        checkoutDetails.note.trim() || "No note"
      }`
    );
    appendMessage(
      "agent",
      `Your checkout request is prepared for ${cartCount} item${cartCount === 1 ? "" : "s"}. The store can use these details to follow up without requiring an account.`
    );
  }

  if (status === "loading") {
    return (
      <Surface title="Soko.market">
        <main className="public-storefront-shell">
          <section className="public-chat-panel">
            <div className="message sokoclaw">
              <span>Agent</span>
              <p>Loading storefront...</p>
            </div>
          </section>
        </main>
      </Surface>
    );
  }

  if (status === "error" || storefront === null) {
    return (
      <Surface title="Soko.market">
        <main className="public-storefront-shell">
          <section className="public-chat-panel">
            <div className="message sokoclaw">
              <span>Agent</span>
              <p>{error || "Storefront was not found."}</p>
            </div>
          </section>
        </main>
      </Surface>
    );
  }

  const storefrontUrl = createStorefrontUrl(storefront.sokoId);

  return (
    <Surface title={`${storefront.businessName} storefront`}>
      <main className="public-storefront-shell">
        <section className="public-chat-panel" aria-label="Storefront chat">
          <div className="public-chat-header">
            <span className="agent-avatar">S</span>
            <div>
              <strong>{storefront.businessName}</strong>
              <span>{storefront.sokoId}</span>
            </div>
            <div className="public-chat-actions">
              {installPrompt.canInstall ? (
                <button
                  className="header-action-button workspace"
                  type="button"
                  onClick={() => void installPrompt.installApp()}
                >
                  Install
                </button>
              ) : null}
              <button
                className="header-action-button"
                type="button"
                onClick={() => setCatalogueOpen((current) => !current)}
              >
                Catalogue
              </button>
              <button
                className="header-action-button"
                type="button"
                onClick={() => setReceiptOpen((current) => !current)}
              >
                Receipt {cartCount > 0 ? cartCount : ""}
              </button>
              <details className="customer-care-menu">
                <summary className="header-signout-button">Customer care</summary>
                <div className="customer-care-dropdown">
                  <button type="button" onClick={requestCallback}>
                    Request callback
                  </button>
                  <button type="button" onClick={requestQuote}>
                    Request quote
                  </button>
                  <button type="button" onClick={requestSupport}>
                    Support
                  </button>
                  <button type="button" onClick={registerNewCustomerByAgent}>
                    Register customer
                  </button>
                </div>
              </details>
            </div>
          </div>

          <div className="public-message-list" ref={messageListRef}>
            <div className="message sokoclaw">
              <span>Agent</span>
              <p>
                Karibu to {storefront.businessName}. I can help you browse products and prepare
                checkout when you are ready. Use {storefront.sokoId} any time you want to return to
                this shop. Open Catalogue to browse without leaving the conversation.
              </p>
            </div>

            {catalogueOpen ? (
              <section className="storefront-product-card" aria-label="Product list">
                <div className="storefront-card-header">
                  <div>
                    <span>Catalogue</span>
                    <strong>
                      {products.length === 0 ? "No products listed" : "Swipe products"}
                    </strong>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setCatalogueOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="storefront-product-grid">
                  {products.length === 0 ? (
                    <p>No products are available right now.</p>
                  ) : (
                    products.map((product) => (
                      <article key={product.id} className="storefront-product-tile">
                        <div>
                          <strong>{product.name}</strong>
                          <span>{product.unit}</span>
                        </div>
                        <button type="button" onClick={() => addProductToCart(product)}>
                          Add
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ) : null}

            {receiptOpen ? (
              <section className="storefront-receipt" aria-label="Receipt">
                <div className="storefront-card-header">
                  <div>
                    <span>Receipt</span>
                    <strong>
                      {cartCount} item{cartCount === 1 ? "" : "s"}
                    </strong>
                  </div>
                  <button className="secondary" type="button" onClick={() => setReceiptOpen(false)}>
                    Close
                  </button>
                </div>
                {cartProducts.length === 0 ? (
                  <p>No purchases selected yet. Add products to build a receipt.</p>
                ) : (
                  <div className="storefront-receipt-lines">
                    {cartProducts.map((product) => (
                      <div key={product.id}>
                        <span>{product.name}</span>
                        <input
                          aria-label={`${product.name} receipt quantity`}
                          min="0"
                          inputMode="numeric"
                          type="number"
                          value={product.quantity}
                          onChange={(event) =>
                            updateCartQuantity(
                              product.id,
                              Number.parseInt(event.target.value, 10) || 0
                            )
                          }
                        />
                        <button type="button" onClick={() => removeCartItem(product.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="storefront-receipt-add">
                  <select
                    aria-label="Add receipt item"
                    value={receiptProductId}
                    onChange={(event) => setReceiptProductId(event.target.value)}
                  >
                    {availableProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addReceiptProduct}
                    disabled={receiptProductId === ""}
                  >
                    Add item
                  </button>
                </div>
                <p>Storefront: {storefrontUrl}</p>
              </section>
            ) : null}

            {cartProducts.length > 0 ? (
              <section className="storefront-cart-summary" aria-label="Cart">
                <div className="storefront-card-header">
                  <div>
                    <span>Order</span>
                    <strong>
                      {cartCount} item{cartCount === 1 ? "" : "s"}
                    </strong>
                  </div>
                  <button className="secondary" type="button" onClick={() => setCart([])}>
                    Close
                  </button>
                </div>
                <div className="storefront-cart-lines">
                  {cartProducts.map((product) => (
                    <div key={product.id}>
                      <span>{product.name}</span>
                      <input
                        aria-label={`${product.name} quantity`}
                        min="0"
                        inputMode="numeric"
                        type="number"
                        value={product.quantity}
                        onChange={(event) =>
                          updateCartQuantity(
                            product.id,
                            Number.parseInt(event.target.value, 10) || 0
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setCheckoutOpen(true)}>
                  Checkout
                </button>
              </section>
            ) : null}

            {crmNotes.length > 0 && careNotesOpen ? (
              <section className="storefront-crm-card" aria-label="Customer care notes">
                <div className="storefront-card-header">
                  <div>
                    <span>Customer care</span>
                    <strong>Conversation and follow-up</strong>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setCareNotesOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="storefront-crm-notes" aria-label="Conversation notes">
                  {crmNotes.slice(-3).map((note) => (
                    <p key={note.id}>
                      <strong>{note.label}</strong>
                      <span>{note.body}</span>
                    </p>
                  ))}
                </div>
              </section>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`message ${message.author === "agent" ? "sokoclaw" : "merchant"}`}
              >
                <span>{message.author === "agent" ? "Agent" : "You"}</span>
                <p>{message.body}</p>
              </div>
            ))}

            {checkoutOpen ? (
              <form className="storefront-checkout" onSubmit={handleCheckoutSubmit}>
                <div className="storefront-card-header">
                  <div className="section-heading">
                    <p className="eyebrow">Checkout</p>
                    <h3>Contact details</h3>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setCheckoutOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <label>
                  Name
                  <input
                    value={checkoutDetails.name}
                    onChange={(event) =>
                      setCheckoutDetails({ ...checkoutDetails, name: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={checkoutDetails.phone}
                    inputMode="tel"
                    onChange={(event) =>
                      setCheckoutDetails({ ...checkoutDetails, phone: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Note
                  <textarea
                    value={checkoutDetails.note}
                    onChange={(event) =>
                      setCheckoutDetails({ ...checkoutDetails, note: event.target.value })
                    }
                    rows={3}
                  />
                </label>
                <button type="submit">Prepare checkout</button>
              </form>
            ) : null}
          </div>

          <form className="storefront-composer" onSubmit={handleDraftSubmit}>
            <button
              className="icon-button composer-icon-button"
              type="button"
              aria-label="Voice input"
              onClick={requestVoiceInput}
              disabled={storefrontCardOpen}
            >
              <span className="mic-icon" aria-hidden="true" />
            </button>
            <button
              className="icon-button composer-icon-button"
              type="button"
              aria-label="Attach file"
              onClick={() => storefrontFileInputRef.current?.click()}
              disabled={storefrontCardOpen}
            >
              <span className="attach-icon" aria-hidden="true" />
            </button>
            <input
              ref={storefrontFileInputRef}
              className="chat-file-input"
              type="file"
              multiple
              accept={chatAttachmentAccept}
              onChange={handleStorefrontAttachmentChange}
            />
            <input
              aria-label="Message the storefront agent"
              disabled={storefrontCardOpen}
              placeholder={
                storefrontCardOpen
                  ? "Close the open card to resume chat"
                  : "Ask about products or type checkout"
              }
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={storefrontCardOpen}>
              <span className="send-icon" aria-hidden="true" />
              <span className="visually-hidden">Send</span>
            </button>
          </form>
          <footer className="app-credits">
            <span>Karibu Soko</span>
            <BuildIdentity />
          </footer>
        </section>
      </main>
    </Surface>
  );
}

function ProductSurface(props: ProductSurfaceProps) {
  return (
    <div className="records-surface product-business-card-surface">
      <section className="record-form business-card-editor" aria-label="Product form">
        <div className="business-card-editor-header">
          <div className="section-heading">
            <p className="eyebrow">{props.form.id === null ? "New product" : "Edit product"}</p>
            <h3>{props.form.id === null ? "Add stock item" : "Update stock item"}</h3>
          </div>
          <div className="business-card-editor-actions">
            <button type="button" onClick={props.onSave}>
              Save
            </button>
            <button className="secondary" type="button" onClick={props.onReset}>
              Clear
            </button>
            {props.form.id === null ? null : (
              <button
                className="danger"
                type="button"
                onClick={() => props.onRemove(props.form.id ?? "")}
              >
                Delete
              </button>
            )}
          </div>
        </div>
        <label>
          Item name
          <input
            value={props.form.name}
            onChange={(event) => props.onFormChange({ ...props.form, name: event.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            SKU
            <input
              value={props.form.sku}
              onChange={(event) => props.onFormChange({ ...props.form, sku: event.target.value })}
            />
          </label>
          <label>
            Unit
            <input
              value={props.form.unit}
              onChange={(event) => props.onFormChange({ ...props.form, unit: event.target.value })}
            />
          </label>
        </div>
        <label>
          Quantity
          <input
            value={props.form.quantity}
            onChange={(event) =>
              props.onFormChange({ ...props.form, quantity: event.target.value })
            }
            inputMode="decimal"
          />
        </label>
        <details className="optional-card-fields">
          <summary>Prices</summary>
          <div className="form-row">
            <label>
              Buying price
              <input
                value={props.form.buyingPrice}
                onChange={(event) =>
                  props.onFormChange({ ...props.form, buyingPrice: event.target.value })
                }
                inputMode="decimal"
                placeholder="Optional"
              />
            </label>
            <label>
              Selling price
              <input
                value={props.form.sellingPrice}
                onChange={(event) =>
                  props.onFormChange({ ...props.form, sellingPrice: event.target.value })
                }
                inputMode="decimal"
                placeholder="Optional"
              />
            </label>
          </div>
        </details>
      </section>

      <section className="record-list product-card-list" aria-label="Product catalogue">
        <div className="surface-header-row">
          <div className="section-heading">
            <p className="eyebrow">Catalogue</p>
            <h3>Existing products</h3>
          </div>
          <button type="button" onClick={props.onAdd}>
            Add
          </button>
        </div>
        {props.products.length === 0 ? (
          <div className="empty-record">
            <h3>No products yet</h3>
            <p>Add the first product to start stock records.</p>
          </div>
        ) : (
          <div className="product-card-list-grid">
            {props.products.map((product) => (
              <article className="product-card-list-item" key={product.id}>
                <div>
                  <strong>{product.name}</strong>
                  <span>
                    {product.quantity} {product.unit}
                    {product.sku === null ? "" : ` · ${product.sku}`}
                  </span>
                  <small>
                    Buy {formatOptionalMoney(product.buyingPrice)} · Sell{" "}
                    {formatOptionalMoney(product.sellingPrice)}
                  </small>
                </div>
                <div className="compact-actions">
                  <button type="button" onClick={() => props.onEdit(product)}>
                    Edit
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => props.onRemove(product.id)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="record-form compact-stock-card" aria-label="Stock adjustment">
        <div className="section-heading">
          <p className="eyebrow">Inventory</p>
          <h3>Adjust stock</h3>
        </div>
        <label>
          Product
          <select
            value={props.stockProductId}
            onChange={(event) => props.onStockProductChange(event.target.value)}
          >
            <option value="">Select product</option>
            {props.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Counted quantity
          <input
            value={props.stockQuantityAfter}
            onChange={(event) => props.onStockQuantityAfterChange(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          Reason
          <input
            value={props.stockReason}
            onChange={(event) => props.onStockReasonChange(event.target.value)}
          />
        </label>
        <button type="button" onClick={props.onAdjustStock} disabled={props.stockProductId === ""}>
          Record movement
        </button>
      </section>
    </div>
  );
}

interface CustomerSurfaceProps {
  customers: CustomerSummary[];
  form: CustomerFormState;
  onFormChange: (form: CustomerFormState) => void;
  onSave: () => void;
  onReset: () => void;
  onEdit: (customer: CustomerSummary) => void;
}

function CustomerSurface(props: CustomerSurfaceProps) {
  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Customer form">
        <div className="section-heading">
          <p className="eyebrow">{props.form.id === null ? "New customer" : "Edit customer"}</p>
          <h3>{props.form.id === null ? "Add customer" : "Update customer"}</h3>
        </div>
        <label>
          Name
          <input
            value={props.form.name}
            onChange={(event) => props.onFormChange({ ...props.form, name: event.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Phone
            <input
              value={props.form.phone}
              onChange={(event) => props.onFormChange({ ...props.form, phone: event.target.value })}
              inputMode="tel"
            />
          </label>
          <label>
            Email
            <input
              value={props.form.email}
              onChange={(event) => props.onFormChange({ ...props.form, email: event.target.value })}
              inputMode="email"
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            value={props.form.notes}
            onChange={(event) => props.onFormChange({ ...props.form, notes: event.target.value })}
            rows={3}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={props.onSave}>
            {props.form.id === null ? "Create" : "Save"}
          </button>
          <button className="secondary" type="button" onClick={props.onReset}>
            Clear
          </button>
        </div>
      </section>

      <section className="record-list" aria-label="Customers">
        {props.customers.length === 0 ? (
          <div className="empty-record">
            <h3>No customers yet</h3>
            <p>Add the first customer to start customer records.</p>
          </div>
        ) : (
          props.customers.map((customer) => (
            <article className="record-row" key={customer.id}>
              <div>
                <strong>{customer.name}</strong>
                <span>{customer.phone ?? customer.email ?? "No contact saved"}</span>
              </div>
              <button type="button" onClick={() => props.onEdit(customer)}>
                Edit
              </button>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface SupplierSurfaceProps {
  suppliers: SupplierBusinessCardSummary[];
  form: SupplierFormState;
  onFormChange: (form: SupplierFormState) => void;
  onSave: () => void;
  onReset: () => void;
  onEdit: (supplier: SupplierSummary) => void;
  onDelete: (supplierId: string) => void;
  onSaveSalesAgent: (supplierId: string, agent: SupplierFormState) => void;
  onDeleteSalesAgent: (supplierId: string, salesAgentId: string) => void;
  onSearchContacts: (query: string) => Promise<NetworkNodeSummary[]>;
  onLinkSupplierContact: (supplierId: string, networkNodeId: string) => void;
  onCreateSupplierFromContact: (networkNodeId: string) => void;
  onLinkSalesAgentContact: (salesAgentId: string, networkNodeId: string) => void;
  onCreateSalesAgentFromContact: (supplierId: string, networkNodeId: string) => void;
  onUploadReceipt: (file: File) => Promise<ReceiptOCRJobSummary | null>;
  onConfirmReceipt: (job: ReceiptOCRJobSummary) => void;
  onImport: () => void;
}

function SupplierSurface(props: SupplierSurfaceProps) {
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(
    props.suppliers[0]?.id ?? null
  );
  const [agentFormBySupplier, setAgentFormBySupplier] = useState<Record<string, SupplierFormState>>(
    {}
  );
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<NetworkNodeSummary[]>([]);
  const [receiptJob, setReceiptJob] = useState<ReceiptOCRJobSummary | null>(null);
  const openSupplier = props.suppliers.find((supplier) => supplier.id === openSupplierId) ?? null;

  async function searchContacts() {
    setContactResults(await props.onSearchContacts(contactQuery));
  }

  async function handleReceiptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file === undefined) {
      return;
    }

    const job = await props.onUploadReceipt(file);
    setReceiptJob(job);
    event.target.value = "";
  }

  function agentForm(supplierId: string): SupplierFormState {
    return agentFormBySupplier[supplierId] ?? emptySupplierForm;
  }

  function updateAgentForm(supplierId: string, next: SupplierFormState) {
    setAgentFormBySupplier((current) => ({
      ...current,
      [supplierId]: next
    }));
  }

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Supplier form">
        <div className="section-heading with-action">
          <div>
            <p className="eyebrow">Suppliers</p>
            <h3>{props.form.id === null ? "Add supplier" : "Update supplier"}</h3>
          </div>
          <button className="secondary" type="button" onClick={props.onImport}>
            Import receipt
          </button>
        </div>
        <label>
          Name
          <input
            value={props.form.name}
            onChange={(event) => props.onFormChange({ ...props.form, name: event.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Phone
            <input
              value={props.form.phone}
              onChange={(event) => props.onFormChange({ ...props.form, phone: event.target.value })}
              inputMode="tel"
            />
          </label>
          <label>
            Email
            <input
              value={props.form.email}
              onChange={(event) => props.onFormChange({ ...props.form, email: event.target.value })}
              inputMode="email"
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            value={props.form.notes}
            onChange={(event) => props.onFormChange({ ...props.form, notes: event.target.value })}
            rows={3}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={props.onSave}>
            {props.form.id === null ? "Create" : "Save"}
          </button>
          <button className="secondary" type="button" onClick={props.onReset}>
            Clear
          </button>
        </div>
      </section>

      <section className="record-list" aria-label="Suppliers">
        <div className="surface-header-row">
          <div className="section-heading">
            <p className="eyebrow">Supplier records</p>
            <h3>Suppliers</h3>
          </div>
          <button type="button" onClick={props.onImport}>
            Upload receipt
          </button>
        </div>
        <div className="supplier-contact-tools">
          <label>
            Search imported contacts
            <input
              value={contactQuery}
              onChange={(event) => setContactQuery(event.target.value)}
              placeholder="Search phonebook contacts"
            />
          </label>
          <button className="secondary" type="button" onClick={() => void searchContacts()}>
            Search
          </button>
        </div>
        {contactResults.length > 0 ? (
          <div className="supplier-contact-results">
            {contactResults.map((contact) => (
              <article className="mini-card" key={contact.id}>
                <strong>{contact.displayName}</strong>
                <span>Phonebook contact</span>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      openSupplier === null
                        ? props.onCreateSupplierFromContact(contact.id)
                        : props.onLinkSupplierContact(openSupplier.id, contact.id)
                    }
                  >
                    {openSupplier === null ? "Create supplier" : "Link supplier"}
                  </button>
                  {openSupplier !== null ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        props.onCreateSalesAgentFromContact(openSupplier.id, contact.id)
                      }
                    >
                      Create sales agent
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {props.suppliers.length === 0 ? (
          <div className="empty-record">
            <h3>No suppliers yet</h3>
            <p>Add a supplier manually, create one from a phone contact, or upload a receipt.</p>
          </div>
        ) : (
          props.suppliers.map((supplier) => (
            <article className="supplier-business-card" key={supplier.id}>
              <div className="supplier-card-header">
                <div>
                  <p className="eyebrow">Supplier</p>
                  <h3>{supplier.name}</h3>
                  <span>{supplier.phone ?? "No phone saved"}</span>
                  <small>
                    {supplier.linkedPhonebookContactName === null
                      ? "Phone contact not linked"
                      : `Linked contact: ${supplier.linkedPhonebookContactName}`}
                  </small>
                  {supplier.email !== null ? <small>{supplier.email}</small> : null}
                  {supplier.notes !== null && supplier.notes.length > 0 ? (
                    <small>{supplier.notes}</small>
                  ) : null}
                </div>
                <div className="supplier-card-metrics">
                  <span>Sales agents: {supplier.salesAgentCount}</span>
                  <span>Receipts matched: {supplier.purchaseReceiptCount}</span>
                  <span>
                    Last purchase:{" "}
                    {supplier.lastPurchaseDate === null
                      ? "None"
                      : new Date(supplier.lastPurchaseDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="actions">
                <button type="button" onClick={() => setOpenSupplierId(supplier.id)}>
                  Open
                </button>
                <button className="secondary" type="button" onClick={() => props.onEdit(supplier)}>
                  Edit
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onDelete(supplier.id)}
                >
                  Delete
                </button>
                <button type="button" onClick={() => setOpenSupplierId(supplier.id)}>
                  Add sales agent
                </button>
                <label className="button-like">
                  Upload receipt
                  <input
                    accept="image/*,.heic,.heif,.pdf,.txt,.csv,text/*,application/pdf"
                    type="file"
                    onChange={(event) => void handleReceiptFile(event)}
                  />
                </label>
              </div>
              {openSupplierId === supplier.id ? (
                <div className="supplier-nested-cards">
                  <section aria-label="Sales agents">
                    <div className="section-heading">
                      <p className="eyebrow">Sales agents</p>
                      <h4>{supplier.name}</h4>
                    </div>
                    <div className="nested-agent-form">
                      <input
                        value={agentForm(supplier.id).name}
                        onChange={(event) =>
                          updateAgentForm(supplier.id, {
                            ...agentForm(supplier.id),
                            name: event.target.value
                          })
                        }
                        placeholder="Sales agent name"
                      />
                      <input
                        value={agentForm(supplier.id).phone}
                        onChange={(event) =>
                          updateAgentForm(supplier.id, {
                            ...agentForm(supplier.id),
                            phone: event.target.value
                          })
                        }
                        placeholder="Phone number"
                      />
                      <input
                        value={agentForm(supplier.id).notes}
                        onChange={(event) =>
                          updateAgentForm(supplier.id, {
                            ...agentForm(supplier.id),
                            notes: event.target.value
                          })
                        }
                        placeholder="Notes"
                      />
                      <button
                        type="button"
                        disabled={agentForm(supplier.id).name.trim() === ""}
                        onClick={() => {
                          props.onSaveSalesAgent(supplier.id, agentForm(supplier.id));
                          updateAgentForm(supplier.id, emptySupplierForm);
                        }}
                      >
                        Save agent
                      </button>
                    </div>
                    {supplier.salesAgents.length === 0 ? (
                      <p className="form-hint">No sales agents yet.</p>
                    ) : (
                      supplier.salesAgents.map((agent) => (
                        <article className="sales-agent-card" key={agent.id}>
                          <strong>{agent.name}</strong>
                          <span>{agent.phone ?? "No phone saved"}</span>
                          <small>
                            {agent.linkedPhonebookContactName === null
                              ? "Phone contact not linked"
                              : `Phone contact linked: ${agent.linkedPhonebookContactName}`}
                          </small>
                          <small>Supplier: {agent.supplierName}</small>
                          {agent.notes !== null ? <small>{agent.notes}</small> : null}
                          <small>Receipts: {agent.receiptsHandled}</small>
                          <small>
                            Last transaction:{" "}
                            {agent.lastTransactionDate === null
                              ? "None"
                              : new Date(agent.lastTransactionDate).toLocaleDateString()}
                          </small>
                          <div className="actions">
                            <button
                              className="secondary"
                              type="button"
                              onClick={() =>
                                updateAgentForm(supplier.id, {
                                  id: agent.id,
                                  name: agent.name,
                                  phone: agent.phone ?? "",
                                  email: "",
                                  notes: agent.notes ?? ""
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              className="secondary"
                              type="button"
                              onClick={() => props.onDeleteSalesAgent(supplier.id, agent.id)}
                            >
                              Delete
                            </button>
                            {contactResults[0] !== undefined ? (
                              <button
                                type="button"
                                onClick={() =>
                                  props.onLinkSalesAgentContact(
                                    agent.id,
                                    contactResults[0]?.id ?? ""
                                  )
                                }
                              >
                                Link to phone contact
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))
                    )}
                  </section>
                  <section aria-label="Purchase receipts">
                    <div className="section-heading">
                      <p className="eyebrow">Purchase receipts</p>
                      <h4>Structured records</h4>
                    </div>
                    {receiptJob !== null ? (
                      <article className="receipt-ocr-card">
                        <strong>OCR status: {receiptJob.status.replace("_", " ")}</strong>
                        {receiptJob.errorMessage !== null ? (
                          <span>{receiptJob.errorMessage}</span>
                        ) : null}
                        <span>
                          Engine: {receiptJob.engine} ({receiptJob.profile})
                        </span>
                        <span>Confidence: {Math.round(receiptJob.averageConfidence * 100)}%</span>
                        <span>Supplier: {receiptJob.supplierName ?? "No match"}</span>
                        <span>Sales agent: {receiptJob.salesAgentName ?? "No match"}</span>
                        <div className="mini-card">
                          <strong>Receipt contact matching</strong>
                          <span>
                            Supplier confidence:{" "}
                            {Math.round(receiptJob.contactMatchingResult.supplier.confidence * 100)}
                            %
                          </span>
                          <small>
                            Matched from:{" "}
                            {receiptJob.contactMatchingResult.supplier.sources.join(", ") ||
                              "No contact match"}
                          </small>
                          <small>
                            Why:{" "}
                            {receiptJob.contactMatchingResult.supplier.matchedBy.join(", ") ||
                              "Needs review"}
                          </small>
                          <span>
                            Sales-agent confidence:{" "}
                            {Math.round(
                              receiptJob.contactMatchingResult.salesAgent.confidence * 100
                            )}
                            %
                          </span>
                          <small>
                            Matched from:{" "}
                            {receiptJob.contactMatchingResult.salesAgent.sources.join(", ") ||
                              "No contact match"}
                          </small>
                          <small>
                            Why:{" "}
                            {receiptJob.contactMatchingResult.salesAgent.matchedBy.join(", ") ||
                              "Needs review"}
                          </small>
                        </div>
                        <span>Items: {receiptJob.items.length}</span>
                        <span>
                          Uploaded image retained temporarily:{" "}
                          {receiptJob.imageRetained ? "Yes" : "No"}
                        </span>
                        {receiptJob.imageDeletedAt !== null ? (
                          <span>Uploaded image deleted after processing.</span>
                        ) : receiptJob.cleanupPending ? (
                          <span>Image cleanup pending after confirmation.</span>
                        ) : null}
                        {receiptJob.warnings.length > 0 ? (
                          <ul>
                            {receiptJob.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            receiptJob.status === "failed" || receiptJob.status === "FAILED"
                          }
                          onClick={() => props.onConfirmReceipt(receiptJob)}
                        >
                          Confirm and save
                        </button>
                      </article>
                    ) : null}
                    {supplier.purchaseReceipts.length === 0 ? (
                      <p className="form-hint">No purchase receipts saved yet.</p>
                    ) : (
                      supplier.purchaseReceipts.map((receipt) => (
                        <article className="mini-card" key={receipt.id}>
                          <strong>{new Date(receipt.receiptDate).toLocaleDateString()}</strong>
                          <span>{formatMoney(receipt.total)}</span>
                          <small>{receipt.salesAgentName ?? "No sales agent"}</small>
                          <small>Image stored: {receipt.imageStored ? "Yes" : "No"}</small>
                        </article>
                      ))
                    )}
                  </section>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface InvoiceSurfaceProps {
  products: ProductSummary[];
  customers: CustomerSummary[];
  invoices: InvoiceSummary[];
  form: InvoiceFormState;
  preview: InvoicePreview | null;
  onFormChange: (form: InvoiceFormState) => void;
  onPreview: () => void;
  onSave: () => void;
  onReset: () => void;
  onEdit: (invoice: InvoiceSummary) => void;
  onConfirm: (invoiceId: string) => void;
  onPrint: (invoice: InvoiceSummary | InvoicePreview) => void;
}

function InvoiceSurface(props: InvoiceSurfaceProps) {
  const selectedCustomer = props.customers.find(
    (customer) => customer.id === props.form.customerId
  );

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Invoice draft form">
        <div className="section-heading">
          <p className="eyebrow">{props.form.id === null ? "New invoice" : "Draft invoice"}</p>
          <h3>{props.form.id === null ? "Create invoice" : "Update invoice draft"}</h3>
        </div>
        <div className="form-row">
          <label>
            Customer
            <select
              value={props.form.customerId}
              onChange={(event) => {
                const customer = props.customers.find((item) => item.id === event.target.value);
                props.onFormChange({
                  ...props.form,
                  customerId: event.target.value,
                  customerName: customer === undefined ? props.form.customerName : ""
                });
              }}
            >
              <option value="">Walk-in or typed customer</option>
              {props.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer name
            <input
              value={selectedCustomer?.name ?? props.form.customerName}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  customerId: "",
                  customerName: event.target.value
                })
              }
              disabled={props.form.customerId !== ""}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Product
            <select
              value={props.form.productId}
              onChange={(event) =>
                props.onFormChange({ ...props.form, productId: event.target.value })
              }
            >
              <option value="">Select product</option>
              {props.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.quantity} {product.unit})
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              value={props.form.quantity}
              onChange={(event) =>
                props.onFormChange({ ...props.form, quantity: event.target.value })
              }
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Unit price
            <input
              value={props.form.unitPrice}
              onChange={(event) =>
                props.onFormChange({ ...props.form, unitPrice: event.target.value })
              }
              inputMode="decimal"
            />
          </label>
          <label>
            Tax rate
            <input
              value={props.form.taxRate}
              onChange={(event) =>
                props.onFormChange({ ...props.form, taxRate: event.target.value })
              }
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={props.onPreview} disabled={props.products.length === 0}>
            Preview
          </button>
          <button type="button" onClick={props.onSave} disabled={props.products.length === 0}>
            {props.form.id === null ? "Save draft" : "Update draft"}
          </button>
        </div>
        <button className="secondary" type="button" onClick={props.onReset}>
          Clear
        </button>
      </section>

      <section className="invoice-preview" aria-label="Invoice preview">
        {props.preview === null ? (
          <div className="empty-record">
            <h3>No preview yet</h3>
            <p>Preview calculates totals without changing inventory.</p>
          </div>
        ) : (
          <InvoiceDocument invoice={props.preview} />
        )}
        {props.preview !== null ? (
          <button type="button" onClick={() => props.onPrint(props.preview as InvoicePreview)}>
            Print
          </button>
        ) : null}
      </section>

      <section className="record-list" aria-label="Invoices">
        {props.invoices.length === 0 ? (
          <div className="empty-record">
            <h3>No invoices yet</h3>
            <p>Create the first invoice draft to preview totals and confirm stock movement.</p>
          </div>
        ) : (
          props.invoices.map((invoice) => (
            <article className="record-row invoice-row" key={invoice.id}>
              <div>
                <strong>
                  {invoice.invoiceNumber} · {invoice.status}
                </strong>
                <span>
                  {invoice.customerName ?? "Walk-in customer"} · {formatMoney(invoice.total)}
                </span>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => props.onEdit(invoice)}>
                  View
                </button>
                <button type="button" onClick={() => props.onPrint(invoice)}>
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => props.onConfirm(invoice.id)}
                  disabled={invoice.status === "confirmed"}
                >
                  Confirm
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function InvoiceDocument({ invoice }: { invoice: InvoicePreview | InvoiceSummary }) {
  const invoiceNumber = "invoiceNumber" in invoice ? invoice.invoiceNumber : "Preview";
  const status = "status" in invoice ? invoice.status : "preview";

  return (
    <div className="invoice-document">
      <div className="invoice-document-header">
        <div>
          <p className="eyebrow">{status}</p>
          <h3>{invoiceNumber}</h3>
        </div>
        <strong>{formatMoney(invoice.total)}</strong>
      </div>
      <p>{invoice.customerName ?? "Walk-in customer"}</p>
      <div className="invoice-lines">
        {invoice.items.map((item) => (
          <div className="invoice-line" key={item.productId}>
            <span>{item.productName}</span>
            <span>
              {item.quantity} x {formatMoney(item.unitPrice)}
            </span>
            <strong>{formatMoney(item.lineTotal)}</strong>
          </div>
        ))}
      </div>
      <div className="invoice-totals">
        <span>Subtotal</span>
        <strong>{formatMoney(invoice.subtotal)}</strong>
        <span>Tax ({Math.round(invoice.taxRate * 100)}%)</span>
        <strong>{formatMoney(invoice.taxTotal)}</strong>
        <span>Total</span>
        <strong>{formatMoney(invoice.total)}</strong>
      </div>
    </div>
  );
}

interface ReportsSurfaceProps {
  report: BusinessReportSummary | null;
  knowledge: BusinessKnowledgeSummary | null;
  onRefresh: () => void;
}

interface ComplianceSurfaceProps {
  form: ComplianceFormState;
  securityReview: SecurityReviewSummary | null;
  dataExport: DataExportBundle | null;
  accountDeletion: AccountDeletionRequestSummary | null;
  verification: VerificationTierSummary | null;
  taxConfig: CountryTaxConfigSummary | null;
  deviceTrust: DeviceTrustSummary | null;
  onFormChange: (form: ComplianceFormState) => void;
  onExport: () => void;
  onSaveVerification: () => void;
  onSaveTax: () => void;
  onSaveDeviceTrust: () => void;
  onScheduleDeletion: () => void;
  onRefresh: () => void;
}

function ComplianceSurface(props: ComplianceSurfaceProps) {
  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Compliance controls">
        <div className="section-heading">
          <p className="eyebrow">Compliance</p>
          <h3>Security controls</h3>
        </div>
        <div className="metric-grid compact">
          <div className="metric">
            <span>RBAC</span>
            <strong>{props.securityReview?.rbac.gaps.length ?? 0}</strong>
          </div>
          <div className="metric">
            <span>Audits</span>
            <strong>{props.securityReview?.audit.highRiskActionCount ?? 0}</strong>
          </div>
          <div className="metric">
            <span>Logs</span>
            <strong>{props.securityReview?.sensitiveData.rawSensitiveLogFindings ?? 0}</strong>
          </div>
          <div className="metric">
            <span>TIEL</span>
            <strong>
              {props.securityReview?.tielReadiness.fullTielDeferred ? "defer" : "ready"}
            </strong>
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
          <button type="button" onClick={props.onExport}>
            Export data
          </button>
        </div>
        {props.dataExport === null ? null : (
          <p className="shell-note">
            Export {props.dataExport.id.slice(0, 8)} ready with{" "}
            {Object.values(props.dataExport.recordCounts).reduce(
              (total, count) => total + count,
              0
            )}{" "}
            records.
          </p>
        )}
      </section>

      <section className="record-form" aria-label="Verification and tax controls">
        <div className="section-heading">
          <p className="eyebrow">Trust and tax</p>
          <h3>Verification</h3>
        </div>
        <label>
          Verification tier
          <select
            value={props.form.verificationTier}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                verificationTier: event.target.value as VerificationTier
              })
            }
          >
            <option value="unverified">Unverified</option>
            <option value="owner_verified">Owner verified</option>
            <option value="business_verified">Business verified</option>
          </select>
        </label>
        <label>
          Verification note
          <input
            value={props.form.verificationNote}
            onChange={(event) =>
              props.onFormChange({ ...props.form, verificationNote: event.target.value })
            }
          />
        </label>
        <button type="button" onClick={props.onSaveVerification}>
          Save verification
        </button>
        <div className="form-row">
          <label>
            Default tax rate
            <input
              value={props.form.defaultTaxRate}
              onChange={(event) =>
                props.onFormChange({ ...props.form, defaultTaxRate: event.target.value })
              }
              inputMode="decimal"
            />
          </label>
          <label>
            KRA PIN
            <input
              value={props.form.taxId}
              onChange={(event) => props.onFormChange({ ...props.form, taxId: event.target.value })}
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={props.form.pricesIncludeTax}
            onChange={(event) =>
              props.onFormChange({ ...props.form, pricesIncludeTax: event.target.checked })
            }
          />
          Prices include tax
        </label>
        <button type="button" onClick={props.onSaveTax}>
          Save tax config
        </button>
      </section>

      <section className="record-form" aria-label="Device trust and deletion controls">
        <div className="section-heading">
          <p className="eyebrow">TIEL placeholder</p>
          <h3>Device trust</h3>
        </div>
        <label>
          Device id
          <input
            value={props.form.deviceId}
            onChange={(event) =>
              props.onFormChange({ ...props.form, deviceId: event.target.value })
            }
          />
        </label>
        <label>
          Trust level
          <select
            value={props.form.deviceTrustLevel}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                deviceTrustLevel: event.target.value as DeviceTrustLevel
              })
            }
          >
            <option value="unknown">Unknown</option>
            <option value="trusted">Trusted</option>
            <option value="restricted">Restricted</option>
          </select>
        </label>
        <label>
          Trust reason
          <input
            value={props.form.deviceTrustReason}
            onChange={(event) =>
              props.onFormChange({ ...props.form, deviceTrustReason: event.target.value })
            }
          />
        </label>
        <button type="button" onClick={props.onSaveDeviceTrust}>
          Save device trust
        </button>
        <label>
          Delete confirmation
          <input
            value={props.form.deletionConfirmation}
            onChange={(event) =>
              props.onFormChange({ ...props.form, deletionConfirmation: event.target.value })
            }
          />
        </label>
        <label>
          Deletion reason
          <input
            value={props.form.deletionReason}
            onChange={(event) =>
              props.onFormChange({ ...props.form, deletionReason: event.target.value })
            }
          />
        </label>
        <button
          className="danger"
          type="button"
          onClick={props.onScheduleDeletion}
          disabled={props.form.deletionConfirmation !== "DELETE"}
        >
          Deactivate account
        </button>
      </section>

      <section className="record-list" aria-label="Compliance status">
        <ReportRow
          title="Verification"
          eyebrow={props.verification?.tier ?? "unverified"}
          body={props.verification?.note ?? "No verification evidence recorded."}
          value={props.verification?.evidenceType ?? "none"}
        />
        <ReportRow
          title="Tax"
          eyebrow={props.taxConfig?.countryCode ?? "KE"}
          body={`${props.taxConfig?.taxIdLabel ?? "KRA PIN"}: ${props.taxConfig?.taxId ?? "not set"}`}
          value={`${Math.round((props.taxConfig?.defaultTaxRate ?? 0.16) * 100)}%`}
        />
        <ReportRow
          title="Device"
          eyebrow={props.deviceTrust?.deviceId ?? props.form.deviceId}
          body={props.deviceTrust?.reason ?? "Device trust is ready for review."}
          value={props.deviceTrust?.level ?? "unknown"}
        />
        {props.accountDeletion === null ? null : (
          <ReportRow
            title="Deletion scheduled"
            eyebrow={props.accountDeletion.status}
            body={`Anonymization after ${formatDate(props.accountDeletion.anonymizeAfter)}.`}
            value={`${props.accountDeletion.retention.directIdentifierFieldsRemoved} fields`}
          />
        )}
      </section>
    </div>
  );
}

interface BetaSurfaceProps {
  form: BetaFormState;
  readiness: BetaReadinessReportSummary | null;
  supportTickets: BetaSupportTicketSummary[];
  onFormChange: (form: BetaFormState) => void;
  onUpdateAccess: () => void;
  onEnableFlags: () => void;
  onRecordDeviceTest: () => void;
  onCreateSupportTicket: () => void;
  onUpdateSupportTicket: (supportTicketId: string, status: BetaSupportTicketStatus) => void;
  onRecordTelemetry: () => void;
  onRefresh: () => void;
}

function BetaSurface(props: BetaSurfaceProps) {
  const failedGates = props.readiness?.gates.filter((gate) => !gate.passed) ?? [];

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Beta readiness controls">
        <div className="section-heading">
          <p className="eyebrow">Beta</p>
          <h3>Readiness gates</h3>
        </div>
        <div className="metric-grid compact">
          <div className="metric">
            <span>Status</span>
            <strong>{props.readiness?.status ?? "pending"}</strong>
          </div>
          <div className="metric">
            <span>Gates</span>
            <strong>{failedGates.length}</strong>
          </div>
          <div className="metric">
            <span>Crash-free</span>
            <strong>{formatPercent(props.readiness?.telemetry.crashFreeSessionRate ?? 1)}</strong>
          </div>
          <div className="metric">
            <span>Support</span>
            <strong>{props.readiness?.support.openTicketCount ?? 0}</strong>
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
          <button type="button" onClick={props.onEnableFlags}>
            Enable flags
          </button>
        </div>
      </section>

      <section className="record-form" aria-label="Closed beta access">
        <div className="section-heading">
          <p className="eyebrow">Access gate</p>
          <h3>Closed beta</h3>
        </div>
        <label>
          Access status
          <select
            value={props.form.accessStatus}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                accessStatus: event.target.value as BetaAccessStatus
              })
            }
          >
            <option value="not_invited">Not invited</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>
        <label>
          Invited merchants
          <input
            value={props.form.invitedMerchantCount}
            onChange={(event) =>
              props.onFormChange({ ...props.form, invitedMerchantCount: event.target.value })
            }
            inputMode="numeric"
          />
        </label>
        <label>
          Pause reason
          <input
            value={props.form.pauseReason}
            onChange={(event) =>
              props.onFormChange({ ...props.form, pauseReason: event.target.value })
            }
          />
        </label>
        <button type="button" onClick={props.onUpdateAccess}>
          Save access
        </button>
      </section>

      <section className="record-form" aria-label="Device and telemetry controls">
        <div className="section-heading">
          <p className="eyebrow">Reliability</p>
          <h3>Device and telemetry</h3>
        </div>
        <div className="form-row">
          <label>
            Device class
            <select
              value={props.form.deviceClass}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  deviceClass: event.target.value as BetaDeviceClass
                })
              }
            >
              <option value="android_1gb">Android 1 GB</option>
              <option value="android_2gb">Android 2 GB</option>
            </select>
          </label>
          <label>
            Test status
            <select
              value={props.form.deviceStatus}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  deviceStatus: event.target.value as BetaDeviceTestStatus
                })
              }
            >
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        </div>
        <label>
          Workflow
          <input
            value={props.form.deviceWorkflow}
            onChange={(event) =>
              props.onFormChange({ ...props.form, deviceWorkflow: event.target.value })
            }
          />
        </label>
        <label>
          Duration ms
          <input
            value={props.form.deviceDurationMs}
            onChange={(event) =>
              props.onFormChange({ ...props.form, deviceDurationMs: event.target.value })
            }
            inputMode="numeric"
          />
        </label>
        <button type="button" onClick={props.onRecordDeviceTest}>
          Record device test
        </button>
        <label>
          Telemetry kind
          <select
            value={props.form.telemetryKind}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                telemetryKind: event.target.value as BetaTelemetryKind
              })
            }
          >
            <option value="session">Session</option>
            <option value="error">Error</option>
            <option value="crash">Crash</option>
          </select>
        </label>
        <label>
          Telemetry message
          <input
            value={props.form.telemetryMessage}
            onChange={(event) =>
              props.onFormChange({ ...props.form, telemetryMessage: event.target.value })
            }
          />
        </label>
        <button type="button" onClick={props.onRecordTelemetry}>
          Record telemetry
        </button>
      </section>

      <section className="record-form" aria-label="Support controls">
        <div className="section-heading">
          <p className="eyebrow">Support</p>
          <h3>Issue intake</h3>
        </div>
        <label>
          Severity
          <select
            value={props.form.supportSeverity}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                supportSeverity: event.target.value as BetaSupportSeverity
              })
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Title
          <input
            value={props.form.supportTitle}
            onChange={(event) =>
              props.onFormChange({ ...props.form, supportTitle: event.target.value })
            }
          />
        </label>
        <label>
          Body
          <textarea
            value={props.form.supportBody}
            onChange={(event) =>
              props.onFormChange({ ...props.form, supportBody: event.target.value })
            }
            rows={3}
          />
        </label>
        <button type="button" onClick={props.onCreateSupportTicket}>
          Create ticket
        </button>
      </section>

      <section className="record-list" aria-label="Beta readiness status">
        {props.readiness?.gates.map((gate) => (
          <ReportRow
            key={gate.key}
            title={gate.key.replaceAll("_", " ")}
            eyebrow={gate.passed ? "passed" : "needs review"}
            body={gate.detail}
            value={gate.passed ? "ok" : "fix"}
          />
        )) ?? null}
        {props.supportTickets.map((ticket) => (
          <article className="record-row" key={ticket.id}>
            <div>
              <p className="eyebrow">
                {ticket.severity} - {ticket.status}
              </p>
              <h4>{ticket.title}</h4>
              <p>{ticket.bodySummary}</p>
            </div>
            <div className="row-actions compact-actions">
              {ticket.status === "open" ? (
                <button
                  type="button"
                  onClick={() => props.onUpdateSupportTicket(ticket.id, "triaged")}
                >
                  Triage
                </button>
              ) : null}
              {ticket.status !== "resolved" ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onUpdateSupportTicket(ticket.id, "resolved")}
                >
                  Resolve
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

interface LaunchSurfaceProps {
  form: LaunchFormState;
  readiness: LaunchReadinessReportSummary | null;
  incidents: LaunchIncidentSummary[];
  onFormChange: (form: LaunchFormState) => void;
  onUpdateSettings: () => void;
  onUpdateChecklist: () => void;
  onCreateIncident: () => void;
  onUpdateIncident: (incidentId: string, status: LaunchIncidentStatus) => void;
  onRefresh: () => void;
}

function LaunchSurface(props: LaunchSurfaceProps) {
  const failedGates = props.readiness?.gates.filter((gate) => !gate.passed) ?? [];

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Public launch readiness controls">
        <div className="section-heading">
          <p className="eyebrow">Launch</p>
          <h3>Readiness gates</h3>
        </div>
        <div className="metric-grid compact">
          <div className="metric">
            <span>Status</span>
            <strong>{props.readiness?.status ?? "pending"}</strong>
          </div>
          <div className="metric">
            <span>Gates</span>
            <strong>{failedGates.length}</strong>
          </div>
          <div className="metric">
            <span>Checklist</span>
            <strong>
              {props.readiness?.checklist.passed ?? 0}/{props.readiness?.checklist.total ?? 0}
            </strong>
          </div>
          <div className="metric">
            <span>Incidents</span>
            <strong>{props.readiness?.support.openIncidentCount ?? 0}</strong>
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
      </section>

      <section className="record-form" aria-label="Launch settings">
        <div className="section-heading">
          <p className="eyebrow">Onboarding gate</p>
          <h3>Public access</h3>
        </div>
        <label>
          Launch status
          <select
            value={props.form.status}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                status: event.target.value as LaunchAccessStatus
              })
            }
          >
            <option value="closed">Closed</option>
            <option value="open">Open</option>
            <option value="paused">Paused</option>
          </select>
        </label>
        <label>
          Allowed signups
          <input
            value={props.form.allowedSignupCount}
            onChange={(event) =>
              props.onFormChange({ ...props.form, allowedSignupCount: event.target.value })
            }
            inputMode="numeric"
          />
        </label>
        <label>
          Pause reason
          <input
            value={props.form.pauseReason}
            onChange={(event) =>
              props.onFormChange({ ...props.form, pauseReason: event.target.value })
            }
          />
        </label>
        <div className="toggle-row">
          <label>
            <input
              type="checkbox"
              checked={props.form.publicOnboardingEnabled}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  publicOnboardingEnabled: event.target.checked
                })
              }
            />
            Public onboarding
          </label>
          <label>
            <input
              type="checkbox"
              checked={props.form.rollbackArmed}
              onChange={(event) =>
                props.onFormChange({ ...props.form, rollbackArmed: event.target.checked })
              }
            />
            Rollback armed
          </label>
          <label>
            <input
              type="checkbox"
              checked={props.form.freezeActive}
              onChange={(event) =>
                props.onFormChange({ ...props.form, freezeActive: event.target.checked })
              }
            />
            Freeze active
          </label>
        </div>
        <button type="button" onClick={props.onUpdateSettings}>
          Save launch settings
        </button>
      </section>

      <section className="record-form" aria-label="Production checklist">
        <div className="section-heading">
          <p className="eyebrow">Production readiness</p>
          <h3>Checklist</h3>
        </div>
        <label>
          Checklist item
          <select
            value={props.form.checklistKey}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                checklistKey: event.target.value as LaunchChecklistKey
              })
            }
          >
            {[
              "environment_config",
              "secrets_ready",
              "backup_verified",
              "monitoring_ready",
              "deploy_verified",
              "rollback_runbook",
              "support_coverage"
            ].map((key) => (
              <option key={key} value={key}>
                {key.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={props.form.checklistStatus}
            onChange={(event) =>
              props.onFormChange({
                ...props.form,
                checklistStatus: event.target.value as LaunchChecklistStatus
              })
            }
          >
            <option value="pending">Pending</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          Evidence
          <input
            value={props.form.checklistEvidence}
            onChange={(event) =>
              props.onFormChange({ ...props.form, checklistEvidence: event.target.value })
            }
          />
        </label>
        <button type="button" onClick={props.onUpdateChecklist}>
          Save checklist
        </button>
      </section>

      <section className="record-form" aria-label="Launch incident controls">
        <div className="section-heading">
          <p className="eyebrow">Support</p>
          <h3>Incidents</h3>
        </div>
        <div className="form-row">
          <label>
            Severity
            <select
              value={props.form.incidentSeverity}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  incidentSeverity: event.target.value as LaunchIncidentSeverity
                })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Category
            <select
              value={props.form.incidentCategory}
              onChange={(event) =>
                props.onFormChange({
                  ...props.form,
                  incidentCategory: event.target.value as LaunchIncidentCategory
                })
              }
            >
              <option value="onboarding">Onboarding</option>
              <option value="payments">Payments</option>
              <option value="sync">Sync</option>
              <option value="support">Support</option>
              <option value="telemetry">Telemetry</option>
              <option value="rollback">Rollback</option>
            </select>
          </label>
        </div>
        <label>
          Title
          <input
            value={props.form.incidentTitle}
            onChange={(event) =>
              props.onFormChange({ ...props.form, incidentTitle: event.target.value })
            }
          />
        </label>
        <label>
          Body
          <textarea
            value={props.form.incidentBody}
            onChange={(event) =>
              props.onFormChange({ ...props.form, incidentBody: event.target.value })
            }
            rows={3}
          />
        </label>
        <button type="button" onClick={props.onCreateIncident}>
          Create incident
        </button>
      </section>

      <section className="record-list" aria-label="Launch readiness status">
        {props.readiness?.gates.map((gate) => (
          <ReportRow
            key={gate.key}
            title={gate.key.replaceAll("_", " ")}
            eyebrow={gate.passed ? "passed" : "needs review"}
            body={gate.detail}
            value={gate.passed ? "ok" : "fix"}
          />
        )) ?? null}
        {props.incidents.map((incident) => (
          <article className="record-row" key={incident.id}>
            <div>
              <p className="eyebrow">
                {incident.category} - {incident.severity} - {incident.status}
              </p>
              <h4>{incident.title}</h4>
              <p>{incident.bodySummary}</p>
            </div>
            <div className="row-actions compact-actions">
              {incident.status === "open" ? (
                <button
                  type="button"
                  onClick={() => props.onUpdateIncident(incident.id, "mitigating")}
                >
                  Mitigate
                </button>
              ) : null}
              {incident.status !== "resolved" ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => props.onUpdateIncident(incident.id, "resolved")}
                >
                  Resolve
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ReportsSurface({ report, knowledge, onRefresh }: ReportsSurfaceProps) {
  if (report === null) {
    return (
      <EmptyStateSurface
        title="Reports not loaded"
        body="Refresh to load deterministic business summaries."
        onChat={onRefresh}
        actionLabel="Refresh"
      />
    );
  }

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Report controls">
        <div className="section-heading">
          <p className="eyebrow">Reports</p>
          <h3>Business summary</h3>
        </div>
        <div className="metric-grid compact">
          <div className="metric">
            <span>Sales</span>
            <strong>{formatMoney(report.sales.grossSales)}</strong>
          </div>
          <div className="metric">
            <span>Collected</span>
            <strong>{formatMoney(report.sales.collectedTotal)}</strong>
          </div>
          <div className="metric">
            <span>Debt</span>
            <strong>{formatMoney(report.debts.totalOutstanding)}</strong>
          </div>
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh reports
        </button>
      </section>

      <section className="record-list" aria-label="Report sections">
        <ReportRow
          title="Inventory"
          eyebrow={`${report.inventory.productCount} products`}
          body={`${report.inventory.lowStockCount} low stock, ${report.inventory.outOfStockCount} out of stock, ${report.inventory.totalUnitsOnHand} units on hand.`}
          value={`${report.inventory.movementCount} movements`}
        />
        <ReportRow
          title="Payments"
          eyebrow={`${report.payments.paymentCount} payments`}
          body={`${report.payments.paidInvoiceCount} paid, ${report.payments.partiallyPaidInvoiceCount} partial, ${report.payments.unpaidInvoiceCount} unpaid invoices.`}
          value={formatMoney(report.payments.totalPaid)}
        />
        <ReportRow
          title="Imports"
          eyebrow={`${report.imports.totalJobs} jobs`}
          body={`${report.imports.confirmedJobs} confirmed, ${report.imports.previewedJobs} previewed, ${report.imports.failedJobs} failed.`}
          value={`${report.imports.confirmedRows} rows`}
        />
        <ReportRow
          title="Logistics"
          eyebrow={`${report.logistics.fulfillmentCount} records`}
          body={`${report.logistics.pendingCount} pending, ${report.logistics.readyCount} ready, ${report.logistics.outForDeliveryCount} dispatched.`}
          value={`${report.logistics.activeCount} active`}
        />
        <ReportRow
          title="Compliance"
          eyebrow={`${report.compliance.exportCount} exports`}
          body={`${report.compliance.scheduledAnonymizationCount} scheduled anonymizations, ${report.compliance.highRiskAuditEventCount} high-risk audit events.`}
          value={report.compliance.verificationTier}
        />
        <ReportRow
          title="Beta"
          eyebrow={report.beta.status}
          body={`${report.beta.gates.filter((gate) => !gate.passed).length} gates need review, ${report.beta.support.openTicketCount} support tickets open.`}
          value={formatPercent(report.beta.telemetry.crashFreeSessionRate)}
        />
        <ReportRow
          title="Launch"
          eyebrow={report.launch.status}
          body={`${report.launch.gates.filter((gate) => !gate.passed).length} gates need review, ${report.launch.support.openIncidentCount} incidents open.`}
          value={`${report.launch.checklist.passed}/${report.launch.checklist.total} checks`}
        />
        <ReportRow
          title="Sync"
          eyebrow={`${report.sync.total} queued records`}
          body={`${report.sync.pending} pending, ${report.sync.failed} failed, ${report.sync.conflict} conflicts.`}
          value={`${report.sync.active} active`}
        />
      </section>

      <section className="record-list" aria-label="Knowledge facts">
        <div className="section-heading">
          <p className="eyebrow">Knowledge</p>
          <h3>Runtime-safe facts</h3>
        </div>
        {knowledge?.facts.map((fact) => (
          <article className="record-row" key={`${fact.topic}-${fact.detail}`}>
            <div>
              <p className="eyebrow">{fact.severity}</p>
              <h4>{fact.topic}</h4>
              <p>{fact.detail}</p>
            </div>
            <strong>{fact.metric}</strong>
          </article>
        )) ?? null}
      </section>
    </div>
  );
}

interface ReportRowProps {
  eyebrow: string;
  title: string;
  body: string;
  value: string;
}

function ReportRow(props: ReportRowProps) {
  return (
    <article className="record-row">
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h4>{props.title}</h4>
        <p>{props.body}</p>
      </div>
      <strong>{props.value}</strong>
    </article>
  );
}

interface NotificationsSurfaceProps {
  inbox: NotificationInbox;
  onRefresh: () => void;
  onUpdate: (notificationId: string, status: BusinessNotificationSummary["status"]) => void;
}

function NotificationsSurface({ inbox, onRefresh, onUpdate }: NotificationsSurfaceProps) {
  const visibleNotifications = inbox.notifications.filter(
    (notification) => notification.status !== "archived"
  );

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Notification controls">
        <div className="section-heading">
          <p className="eyebrow">Alerts</p>
          <h3>In-app notifications</h3>
        </div>
        <div className="metric-grid compact">
          <div className="metric">
            <span>Unread</span>
            <strong>{inbox.summary.unread}</strong>
          </div>
          <div className="metric">
            <span>Read</span>
            <strong>{inbox.summary.read}</strong>
          </div>
          <div className="metric">
            <span>Archived</span>
            <strong>{inbox.summary.archived}</strong>
          </div>
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh alerts
        </button>
      </section>

      <section className="record-list" aria-label="Notifications">
        {visibleNotifications.length === 0 ? (
          <EmptyStateSurface
            title="No active notifications"
            body="Low stock, open debt, sync conflicts, and failed imports create in-app alerts here."
            onChat={onRefresh}
            actionLabel="Refresh"
          />
        ) : (
          visibleNotifications.map((notification) => (
            <article className="record-row notification-row" key={notification.id}>
              <div>
                <p className="eyebrow">
                  {notification.severity} - {notification.status}
                </p>
                <h4>{notification.title}</h4>
                <p>{notification.body}</p>
              </div>
              <div className="row-actions compact-actions">
                {notification.status === "unread" ? (
                  <button type="button" onClick={() => onUpdate(notification.id, "read")}>
                    Read
                  </button>
                ) : null}
                <button
                  className="secondary"
                  type="button"
                  onClick={() => onUpdate(notification.id, "archived")}
                >
                  Archive
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

interface AgentProfileSurfaceProps {
  agent: AgentSettings;
  business: ActiveBusiness;
  oauthProviders: OAuthProviderSummary[];
  ownerLabel: string;
  storefrontUrl: string;
  onAgentChange: (agent: AgentSettings) => void;
  onBack: () => void;
  onLogout: () => void;
}

function AgentProfileSurface({
  agent,
  business,
  oauthProviders,
  ownerLabel,
  storefrontUrl,
  onAgentChange,
  onBack,
  onLogout
}: AgentProfileSurfaceProps) {
  const [draftAgent, setDraftAgent] = useState(agent);
  const [isEditing, setIsEditing] = useState(false);
  const [contextPassword, setContextPassword] = useState("");
  const [contextUnlocked, setContextUnlocked] = useState(false);
  const [contextUnlockError, setContextUnlockError] = useState("");
  const [connectedSocialAccounts, setConnectedSocialAccounts] = useState<
    ConnectedSocialAccountSummary[]
  >([]);
  const [profileMessage, setProfileMessage] = useState("");
  const [deletionStep, setDeletionStep] = useState<"idle" | "confirm" | "verify" | "status">(
    "idle"
  );
  const [deletionPreview, setDeletionPreview] = useState<ShopDeletionPreviewSummary | null>(null);
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequestSummary | null>(
    null
  );
  const [deletionShopId, setDeletionShopId] = useState("");
  const [deletionPin, setDeletionPin] = useState("");
  const [deletionOtp, setDeletionOtp] = useState("");
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false);
  const [deletionOtpDestination, setDeletionOtpDestination] = useState("");

  useEffect(() => {
    if (!isEditing) {
      setDraftAgent(agent);
    }
  }, [agent, isEditing]);

  useEffect(() => {
    void loadConnectedSocialAccounts();
    void loadShopDeletionPreview();
  }, [business.id]);

  async function loadConnectedSocialAccounts() {
    try {
      const response = await getJson<ConnectedSocialAccountsResponse>(
        `/businesses/${business.id}/social-accounts`
      );
      setConnectedSocialAccounts(response.accounts);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function loadShopDeletionPreview() {
    try {
      const preview = await getJson<ShopDeletionPreviewSummary>(
        `/businesses/${business.id}/shop-deletion/preview`
      );
      setDeletionPreview(preview);
    } catch {
      setDeletionPreview(null);
    }
  }

  async function disconnectSocialAccount(identityId: string) {
    try {
      await deleteJson<{ disconnected: true; identityId: string }>(
        `/businesses/${business.id}/social-accounts/${identityId}`
      );
      await loadConnectedSocialAccounts();
      setProfileMessage("Social account disconnected.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function startShopDeletion() {
    try {
      const response = await postJson<ShopDeletionRequestResult>(
        `/businesses/${business.id}/shop-deletion/request`,
        {
          shopId: deletionShopId
        }
      );
      setDeletionRequest(response.request);
      setDeletionPreview(response.preview);
      setDeletionOtpDestination(response.otp.destination);
      setDeletionStep("verify");
      setProfileMessage(
        response.otp.devOtp !== undefined && response.otp.devOtp.length > 0
          ? `Verification code sent. Dev code: ${response.otp.devOtp}`
          : "Verification code sent."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function finalizeShopDeletion() {
    if (deletionRequest === null) {
      return;
    }

    try {
      const result = await postJson<AccountDeletionRequestSummary>(
        `/businesses/${business.id}/shop-deletion/${deletionRequest.id}/finalize`,
        {
          pin: deletionPin,
          otpCode: deletionOtp,
          acknowledgement: deletionAcknowledged,
          idempotencyKey: `web-${business.id}-${deletionRequest.id}`
        }
      );
      setDeletionRequest(result);
      setDeletionStep("status");
      setProfileMessage(
        result.status === "COMPLETED"
          ? "This shop and its removable data have been deleted."
          : "Shop deletion is being processed."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  function updateAgent(patch: Partial<AgentSettings>) {
    setDraftAgent((currentAgent) => ({ ...currentAgent, ...patch }));
  }

  function startEditing() {
    setDraftAgent(agent);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftAgent(agent);
    setIsEditing(false);
    setContextUnlocked(false);
    setContextPassword("");
    setContextUnlockError("");
  }

  function saveAgent() {
    const publicAgentId = createPublicStorefrontAgentId(business);
    onAgentChange({
      ...draftAgent,
      contextScripts: sanitizeContextScripts(draftAgent.contextScripts),
      globalAgentId: publicAgentId,
      storefrontUrl: createStorefrontUrl(publicAgentId)
    });
    setIsEditing(false);
    setContextUnlocked(false);
    setContextPassword("");
    setContextUnlockError("");
  }

  function copyStorefrontValue(value: string, label: string) {
    void copyTextToClipboard(value);
    window.alert(`${label} copied`);
  }

  function unlockContextScripts() {
    const password = contextPassword.trim();
    const savedPassword = localStorage.getItem(contextScriptsPasswordStorageKey);

    if (password.length < 6) {
      setContextUnlockError("Use at least 6 characters.");
      return;
    }

    if (savedPassword === null) {
      localStorage.setItem(contextScriptsPasswordStorageKey, password);
      setContextUnlocked(true);
      setContextUnlockError("");
      return;
    }

    if (savedPassword !== password) {
      setContextUnlockError("Password did not match.");
      return;
    }

    setContextUnlocked(true);
    setContextUnlockError("");
  }

  function updateContextScript(index: number, value: string) {
    updateAgent({
      contextScripts: draftAgent.contextScripts.map((script, scriptIndex) =>
        scriptIndex === index ? value : script
      )
    });
  }

  function addContextScript() {
    updateAgent({
      contextScripts: [
        ...draftAgent.contextScripts,
        "script: local_vocabulary\npriority: required\nallow: read, add, edit, remove\n"
      ]
    });
  }

  function removeContextScript(index: number) {
    updateAgent({
      contextScripts: draftAgent.contextScripts.filter((_, scriptIndex) => scriptIndex !== index)
    });
  }

  return (
    <main className="agent-profile-surface">
      <section className="agent-profile-header">
        <button className="secondary" type="button" onClick={onBack}>
          Back
        </button>
        <div className="agent-avatar" aria-hidden="true">
          {draftAgent.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="eyebrow">{business.name}</p>
          <h2>{draftAgent.name}</h2>
          <p>{draftAgent.description}</p>
        </div>
        <div className="agent-profile-actions">
          {isEditing ? (
            <>
              <button type="button" onClick={saveAgent}>
                Save
              </button>
              <button className="secondary" type="button" onClick={cancelEditing}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={startEditing}>
                Edit
              </button>
              <button className="secondary" type="button" onClick={onLogout}>
                Sign out
              </button>
            </>
          )}
        </div>
      </section>

      <section className="agent-settings-grid">
        <div className="record-form">
          <div className="section-heading">
            <p className="eyebrow">Identity</p>
            <h3>Agent profile</h3>
          </div>
          <label>
            Agent name
            <input
              value={draftAgent.name}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ name: event.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              value={draftAgent.description}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ description: event.target.value })}
              rows={3}
            />
          </label>
          <label>
            AI model
            <select
              value={draftAgent.model}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ model: event.target.value as AgentModel })}
            >
              <option value="qwen2.5-0.5b-android">Qwen2.5 0.5B local Android</option>
              <option value="sokoclaw-local">Sokoclaw local legacy</option>
              <option value="openai-fast">OpenAI fast</option>
              <option value="openai-reasoning">OpenAI reasoning</option>
            </select>
          </label>
          <label>
            Agent role
            <input
              value={draftAgent.role}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ role: event.target.value })}
            />
          </label>
        </div>

        <div className="record-form">
          <div className="section-heading">
            <p className="eyebrow">Soko Global Shop ID</p>
            <h3>Public storefront</h3>
          </div>
          <div className="soko-id-card">
            <span>Permanent shop identity</span>
            <strong>{business.sokoId}</strong>
            <p>Print this on packaging, receipts, QR codes, and storefront material.</p>
            <div className="storefront-share-actions">
              <button type="button" onClick={() => copyStorefrontValue(business.sokoId, "Soko ID")}>
                Copy ID
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => copyStorefrontValue(storefrontUrl, "Storefront URL")}
              >
                Copy URL
              </button>
            </div>
          </div>
          <label>
            Storefront ID
            <input value={business.sokoId} disabled />
          </label>
          <label>
            Storefront URL
            <input value={storefrontUrl} disabled />
          </label>
          <label>
            Language
            <select
              value={draftAgent.language}
              disabled={!isEditing}
              onChange={(event) =>
                updateAgent({ language: event.target.value as SupportedLanguage })
              }
            >
              <option value="en">English</option>
              <option value="sw">Swahili</option>
            </select>
          </label>
          <p className="shell-note">{ownerLabel} owns this public storefront assistant.</p>
        </div>

        <div className="record-form shop-profile-card">
          <div className="section-heading">
            <p className="eyebrow">Account</p>
            <h3>Login accounts</h3>
          </div>
          <div className="connected-social-list">
            {oauthProviders
              .filter((provider) =>
                ["google", "facebook", "tiktok", "x", "linkedin"].includes(provider.id)
              )
              .map((provider) => {
                const connected = connectedSocialAccounts.find(
                  (account) => account.provider === provider.id
                );
                return (
                  <article className="connected-social-card" key={provider.id}>
                    <div>
                      <span>{provider.displayName}</span>
                      <strong>{connected === undefined ? "Disconnected" : "Connected"}</strong>
                      <p>
                        {connected?.displayName ??
                          connected?.email ??
                          (provider.configured
                            ? "Ready to connect"
                            : "Login provider not configured")}
                      </p>
                    </div>
                    <div className="connected-social-meta">
                      <span>
                        Connected:{" "}
                        {connected === undefined ? "—" : formatDate(connected.connectedAt)}
                      </span>
                      <span>
                        Last used:{" "}
                        {connected?.lastUsedAt === null || connected === undefined
                          ? "—"
                          : formatDate(connected.lastUsedAt)}
                      </span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() =>
                          setProfileMessage(
                            provider.configured
                              ? "Use signup/login to reconnect this login account."
                              : "This login provider is not configured yet."
                          )
                        }
                      >
                        Reconnect
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={connected === undefined}
                        onClick={() =>
                          connected === undefined
                            ? undefined
                            : void disconnectSocialAccount(connected.id)
                        }
                      >
                        Disconnect
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
          {profileMessage.length > 0 ? <p className="shell-note">{profileMessage}</p> : null}
        </div>

        <div className="record-form shop-profile-card">
          <div className="section-heading">
            <p className="eyebrow">Business channels</p>
            <h3>Connected customer channels</h3>
          </div>
          <p className="shell-note">
            These are separate from login accounts. Keep storefront, chat and customer-care channel
            settings in their existing workspace areas.
          </p>
        </div>

        <div className="record-form danger-zone-card">
          <div className="section-heading">
            <p className="eyebrow">Danger zone</p>
            <h3>Delete shop account</h3>
          </div>
          <p className="security-warning">
            Deleting this shop permanently removes its business data and disconnects its services.
          </p>
          {deletionStep === "idle" ? (
            <button
              className="destructive-button"
              type="button"
              onClick={() => setDeletionStep("confirm")}
            >
              Delete shop account
            </button>
          ) : null}
          {deletionStep === "confirm" ? (
            <div className="shop-deletion-card">
              <div className="storefront-card-header">
                <div>
                  <span>Delete shop account</span>
                  <strong>Step 1 of 2</strong>
                </div>
                <button className="secondary" type="button" onClick={() => setDeletionStep("idle")}>
                  Cancel
                </button>
              </div>
              <p>This will remove:</p>
              <ul>
                <li>Products and catalogue</li>
                <li>Customers, suppliers and sales agents</li>
                <li>Sales, invoices and payments</li>
                <li>Messages, notifications and context scripts</li>
                <li>Uploaded business files and connected services</li>
              </ul>
              {deletionPreview === null ? null : (
                <div className="supplier-card-metrics">
                  <span>Products: {deletionPreview.counts.products}</span>
                  <span>Customers: {deletionPreview.counts.customers}</span>
                  <span>Suppliers: {deletionPreview.counts.suppliers}</span>
                  <span>Sales records: {deletionPreview.counts.salesRecords}</span>
                  <span>Files: {deletionPreview.counts.uploadedFiles}</span>
                </div>
              )}
              <label>
                Type the shop ID to continue
                <input
                  value={deletionShopId}
                  onChange={(event) => setDeletionShopId(event.target.value)}
                  placeholder={business.sokoId}
                />
              </label>
              <div className="row-actions">
                <button className="secondary" type="button" onClick={() => setDeletionStep("idle")}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletionShopId !== business.sokoId}
                  onClick={() => void startShopDeletion()}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}
          {deletionStep === "verify" ? (
            <div className="shop-deletion-card">
              <div className="storefront-card-header">
                <div>
                  <span>Verify deletion</span>
                  <strong>Step 2 of 2</strong>
                </div>
                <button className="secondary" type="button" onClick={() => setDeletionStep("idle")}>
                  Cancel
                </button>
              </div>
              <p>
                A verification code was sent to{" "}
                {deletionOtpDestination.length > 0 ? deletionOtpDestination : "your verified login"}
                .
              </p>
              <label>
                Login PIN
                <input
                  value={deletionPin}
                  type="password"
                  inputMode="numeric"
                  onChange={(event) => setDeletionPin(event.target.value)}
                />
              </label>
              <label>
                Verification code
                <input
                  value={deletionOtp}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setDeletionOtp(event.target.value)}
                />
              </label>
              <label className="checkbox-row">
                <input
                  checked={deletionAcknowledged}
                  type="checkbox"
                  onChange={(event) => setDeletionAcknowledged(event.target.checked)}
                />
                I understand that this action is permanent.
              </label>
              <div className="row-actions">
                <button className="secondary" type="button" onClick={() => setDeletionStep("idle")}>
                  Cancel
                </button>
                <button
                  className="destructive-button"
                  type="button"
                  disabled={
                    deletionPin.length === 0 || deletionOtp.length !== 6 || !deletionAcknowledged
                  }
                  onClick={() => void finalizeShopDeletion()}
                >
                  Delete everything
                </button>
              </div>
            </div>
          ) : null}
          {deletionStep === "status" ? (
            <div className="shop-deletion-card" role="status">
              <strong>{deletionRequest?.status ?? "Processing"}</strong>
              <p>
                {deletionRequest?.status === "COMPLETED"
                  ? "This shop and its removable data have been deleted."
                  : "Your shop deletion is being processed. You can close this screen."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="record-form">
          <div className="section-heading">
            <p className="eyebrow">Behavior</p>
            <h3>Personality and instructions</h3>
          </div>
          <label>
            Personality
            <input
              value={draftAgent.personality}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ personality: event.target.value })}
            />
          </label>
          <label>
            Instructions
            <textarea
              value={draftAgent.instructions}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ instructions: event.target.value })}
              rows={5}
            />
          </label>
        </div>

        <div className="record-form">
          <div className="section-heading">
            <p className="eyebrow">Capabilities</p>
            <h3>Knowledge, tools, integrations</h3>
          </div>
          <label>
            Knowledge
            <textarea
              value={draftAgent.knowledge}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ knowledge: event.target.value })}
              rows={4}
            />
          </label>
          <label>
            Tools
            <input
              value={draftAgent.tools.join(", ")}
              disabled={!isEditing}
              onChange={(event) => updateAgent({ tools: splitListInput(event.target.value) })}
            />
          </label>
          <label>
            Integrations
            <input
              value={draftAgent.integrations.join(", ")}
              disabled={!isEditing}
              onChange={(event) =>
                updateAgent({ integrations: splitListInput(event.target.value) })
              }
            />
          </label>
        </div>

        <div className="record-form agent-context-window advanced-context-window">
          <div className="section-heading">
            <p className="eyebrow">Advanced features</p>
            <h3>Protected context scripts</h3>
          </div>
          <p className="security-warning">
            Changes made here affect the response of the agent. Edit, write, or delete context
            scripts only with absolute necessity and skill.
          </p>
          {!contextUnlocked ? (
            <div className="context-unlock-panel">
              <label>
                Advanced password
                <input
                  value={contextPassword}
                  disabled={!isEditing}
                  type="password"
                  onChange={(event) => setContextPassword(event.target.value)}
                  placeholder="Enter or set password"
                />
              </label>
              <button type="button" onClick={unlockContextScripts} disabled={!isEditing}>
                Unlock context scripts
              </button>
              {contextUnlockError.length > 0 ? <p>{contextUnlockError}</p> : null}
            </div>
          ) : (
            <div className="context-script-editor">
              <article className="product-vocabulary-card" aria-label="Product Vocabulary">
                <div className="storefront-card-header">
                  <div>
                    <span>Context Scripts</span>
                    <strong>Product Vocabulary</strong>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={!isEditing}
                    onClick={() =>
                      setContextUnlockError("Product vocabulary test script is active.")
                    }
                  >
                    Test script
                  </button>
                </div>
                <div className="supplier-card-metrics">
                  <span>
                    Status: {defaultProductVocabularyContextScript.enabled ? "Active" : "Inactive"}
                  </span>
                  <span>Priority: Required</span>
                  <span>
                    Supported intents:{" "}
                    {
                      Array.from(
                        new Set(
                          defaultProductVocabularyContextScript.entries.map((entry) => entry.intent)
                        )
                      ).length
                    }
                  </span>
                  <span>
                    Configured phrases: {defaultProductVocabularyContextScript.entries.length}
                  </span>
                  <span>
                    Last updated: {formatDate(defaultProductVocabularyContextScript.lastUpdated)}
                  </span>
                </div>
                <div className="context-vocabulary-intents" aria-label="Supported product intents">
                  {Array.from(
                    new Set(
                      defaultProductVocabularyContextScript.entries.map((entry) => entry.intent)
                    )
                  ).map((intent) => (
                    <span key={intent}>{intent}</span>
                  ))}
                </div>
                <div className="row-actions">
                  <button type="button" disabled={!isEditing} onClick={addContextScript}>
                    Add phrase
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing || draftAgent.contextScripts.length === 0}
                  >
                    Edit phrase
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing || draftAgent.contextScripts.length === 0}
                    onClick={() => removeContextScript(draftAgent.contextScripts.length - 1)}
                  >
                    Remove phrase
                  </button>
                  <button type="button" disabled={!isEditing} onClick={addContextScript}>
                    Add language
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing}
                    onClick={() => updateAgent({ contextScripts: defaultAgentContextScripts })}
                  >
                    Restore defaults
                  </button>
                  <button
                    type="button"
                    disabled={!isEditing}
                    onClick={() =>
                      setContextUnlockError("Test phrase matched by Product Vocabulary.")
                    }
                  >
                    Test phrase
                  </button>
                  <button type="button" disabled={!isEditing} onClick={saveAgent}>
                    Save changes
                  </button>
                </div>
              </article>
              {draftAgent.contextScripts.map((script, index) => (
                <label key={`${index}-${script.slice(0, 12)}`}>
                  Script {index + 1}
                  <textarea
                    value={script}
                    disabled={!isEditing}
                    onChange={(event) => updateContextScript(index, event.target.value)}
                    rows={7}
                  />
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => removeContextScript(index)}
                    disabled={!isEditing}
                  >
                    Delete script
                  </button>
                </label>
              ))}
              <button type="button" onClick={addContextScript} disabled={!isEditing}>
                Write new script
              </button>
            </div>
          )}
          <div className="context-script-examples">
            <span>Allowed shape</span>
            <code>script: product_catalogue_commands</code>
            <code>priority: required</code>
            <code>allow: read, add, edit, remove</code>
            <code>sw: ongeza bidhaa =&gt; add product</code>
          </div>
        </div>
      </section>
    </main>
  );
}

interface ChatSurfaceProps {
  activeView: ShellView;
  agent: AgentSettings;
  businessName: string;
  hasBusiness: boolean;
  chatDraft: string;
  children: ReactNode;
  customerCount: number;
  invoiceCount: number;
  messages: ChatMessage[];
  mode: SokoMode;
  networkGraph: NetworkGraphSummary | null;
  notificationCount: number;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  pendingAttachments: ChatAttachment[];
  productForm: ProductFormState;
  productCount: number;
  products: ProductSummary[];
  sokoId: string;
  report: BusinessReportSummary | null;
  shopPresenceStatus: ShopPresenceStatus;
  syncSummary: SyncQueueSummary;
  workspaceOpen: boolean;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddWorkspaceCard: () => void;
  onBackToChat: () => void;
  onCloseWorkspace: () => void;
  onDraftChange: (draft: string) => void;
  onNavigate: (view: ShellView) => void;
  onModeChange: (mode: SokoMode) => void;
  onProductEdit: (product: ProductSummary) => void;
  onProductFieldsSave: (fields: ProductFieldDraft[]) => void;
  onProductFormChange: (form: ProductFormState) => void;
  onProductRemove: (productId: string) => void;
  onProductReset: () => void;
  onProductSave: () => Promise<void>;
  onNetworkDisconnectSource: (sourceId: string) => void;
  onNetworkPhoneContactsSync: (
    selectedContacts: ContactPickerContact[]
  ) => Promise<NetworkGraphSummary | null>;
  onNetworkProviderOAuth: (provider: SocialSignupProvider) => Promise<void>;
  onNetworkRefresh: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onStatusChange: (status: ShopPresenceStatus) => void;
  onConfirm: (confirmationToken: string) => void;
  onSend: () => void;
}

function ChatSurface({
  activeView,
  agent,
  businessName,
  hasBusiness,
  chatDraft,
  children,
  customerCount,
  invoiceCount,
  messages,
  mode,
  networkGraph,
  notificationCount,
  oauthProviders,
  oauthProvidersLoaded,
  pendingAttachments,
  productForm,
  productCount,
  products,
  sokoId,
  report,
  shopPresenceStatus,
  syncSummary,
  workspaceOpen,
  onAttachmentChange,
  onAddWorkspaceCard,
  onBackToChat,
  onCloseWorkspace,
  onDraftChange,
  onNavigate,
  onModeChange,
  onProductEdit,
  onProductFieldsSave,
  onProductFormChange,
  onProductRemove,
  onProductReset,
  onProductSave,
  onNetworkDisconnectSource,
  onNetworkPhoneContactsSync,
  onNetworkProviderOAuth,
  onNetworkRefresh,
  onRemoveAttachment,
  onStatusChange,
  onConfirm,
  onSend
}: ChatSurfaceProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const [workspaceCardView, setWorkspaceCardView] = useState<
    | "cards"
    | "catalogue"
    | "addProduct"
    | "editProduct"
    | "deleteProduct"
    | "manageFields"
    | "networkSync"
    | "storefrontPreview"
  >("cards");

  useEffect(() => {
    if (!workspaceOpen) {
      setWorkspaceCardView("cards");
    }
  }, [workspaceOpen]);

  useEffect(() => {
    setWorkspaceCardView("cards");
  }, [mode]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      messageListRef.current?.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeView, messages.length, mode, workspaceCardView]);

  return (
    <div className="chat-surface">
      <div className="message-list" aria-live="polite" ref={messageListRef}>
        {messages.map((message) => (
          <article className={`message ${message.author}`} key={message.id}>
            <span className="message-author">
              {message.author === "merchant" ? (
                "You"
              ) : (
                <>
                  {agent.name}
                  <ShopPresenceButtons
                    activeStatus={shopPresenceStatus}
                    onStatusChange={onStatusChange}
                  />
                </>
              )}
            </span>
            <p>{message.body}</p>
            {message.attachments !== undefined && message.attachments.length > 0 ? (
              <div className="message-attachments" aria-label="Message attachments">
                {message.attachments.map((attachment) => (
                  <span className="message-attachment" key={attachment.id}>
                    {attachment.name}
                    <small>
                      {formatAttachmentCategory(attachment.category)} ·{" "}
                      {formatFileSize(attachment.size)}
                    </small>
                  </span>
                ))}
              </div>
            ) : null}
            {message.confirmationToken !== undefined ? (
              <button type="button" onClick={() => onConfirm(message.confirmationToken ?? "")}>
                Confirm
              </button>
            ) : null}
          </article>
        ))}
        {activeView !== "chat" && activeView !== "home" ? (
          <section className="generated-card-detail" aria-label={viewLabel(activeView)}>
            <div className="generated-card-header">
              <button className="secondary" type="button" onClick={onBackToChat}>
                Close
              </button>
            </div>
            {children}
          </section>
        ) : null}
        {activeView === "chat" && mode === "marketplace" ? (
          workspaceCardView === "storefrontPreview" ? (
            <StorefrontPreviewCard
              businessName={businessName}
              products={products}
              sokoId={sokoId}
              onBack={() => setWorkspaceCardView("cards")}
              onSell={() => onModeChange("seller")}
              onMessage={() => onDraftChange(`Hello ${businessName}, `)}
            />
          ) : (
            <MarketplaceModeCard
              businessName={businessName}
              hasBusiness={hasBusiness}
              productCount={productCount}
              sokoId={sokoId}
              onOpenStore={() => setWorkspaceCardView("storefrontPreview")}
              onPrompt={onDraftChange}
              onSell={() => onModeChange("seller")}
            />
          )
        ) : null}
        {activeView === "chat" && mode === "seller" ? (
          workspaceCardView === "cards" ? (
            <ContextualBusinessCards
              productCount={productCount}
              customerCount={customerCount}
              invoiceCount={invoiceCount}
              notificationCount={notificationCount}
              report={report}
              syncSummary={syncSummary}
              onAddCard={onAddWorkspaceCard}
              onOpenCatalogue={() => setWorkspaceCardView("catalogue")}
              onOpenNetworkSync={() => setWorkspaceCardView("networkSync")}
              onPreviewStorefront={() => setWorkspaceCardView("storefrontPreview")}
              onNavigate={onNavigate}
            />
          ) : workspaceCardView === "networkSync" ? (
            <NetworkSyncNestedCard
              graph={networkGraph}
              oauthProviders={oauthProviders}
              oauthProvidersLoaded={oauthProvidersLoaded}
              onBack={() => setWorkspaceCardView("cards")}
              onDisconnectSource={onNetworkDisconnectSource}
              onOAuthProvider={onNetworkProviderOAuth}
              onPhoneContactsSync={onNetworkPhoneContactsSync}
              onRefresh={onNetworkRefresh}
            />
          ) : workspaceCardView === "storefrontPreview" ? (
            <StorefrontPreviewCard
              businessName={businessName}
              products={products}
              sokoId={sokoId}
              onBack={() => setWorkspaceCardView("cards")}
              onSell={() => onModeChange("marketplace")}
              onMessage={() => onDraftChange(`Hello ${businessName}, `)}
            />
          ) : (
            <CatalogueNestedCard
              form={productForm}
              products={products}
              view={workspaceCardView}
              onBack={() =>
                setWorkspaceCardView(workspaceCardView === "catalogue" ? "cards" : "catalogue")
              }
              onChangeForm={onProductFormChange}
              onDeleteProduct={onProductRemove}
              onEditProduct={onProductEdit}
              onOpenAdd={() => {
                onProductReset();
                setWorkspaceCardView("addProduct");
              }}
              onOpenDelete={() => setWorkspaceCardView("deleteProduct")}
              onOpenEdit={() => {
                if (products[0] !== undefined) onProductEdit(products[0]);
                setWorkspaceCardView("editProduct");
              }}
              onOpenFields={() => setWorkspaceCardView("manageFields")}
              onOpenProduct={(product) => {
                onProductEdit(product);
                setWorkspaceCardView("editProduct");
              }}
              onSaveFields={onProductFieldsSave}
              onSaveProduct={async () => {
                await onProductSave();
                setWorkspaceCardView("catalogue");
              }}
            />
          )
        ) : null}
      </div>
      {workspaceOpen ? (
        <div className="workspace-panel-backdrop" role="presentation">
          <section
            className="workspace-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace cards"
          >
            <div className="workspace-panel-heading">
              <h2>{workspacePanelTitle(workspaceCardView)}</h2>
              <button type="button" onClick={onCloseWorkspace} aria-label="Close workspace">
                x
              </button>
            </div>
            {workspaceCardView === "cards" ? (
              <ContextualBusinessCards
                productCount={productCount}
                customerCount={customerCount}
                invoiceCount={invoiceCount}
                notificationCount={notificationCount}
                report={report}
                syncSummary={syncSummary}
                onAddCard={onAddWorkspaceCard}
                onOpenCatalogue={() => setWorkspaceCardView("catalogue")}
                onOpenNetworkSync={() => setWorkspaceCardView("networkSync")}
                onPreviewStorefront={() => setWorkspaceCardView("storefrontPreview")}
                onNavigate={(nextView) => {
                  onNavigate(nextView);
                  onCloseWorkspace();
                }}
              />
            ) : workspaceCardView === "networkSync" ? (
              <NetworkSyncNestedCard
                graph={networkGraph}
                oauthProviders={oauthProviders}
                oauthProvidersLoaded={oauthProvidersLoaded}
                onBack={() => setWorkspaceCardView("cards")}
                onDisconnectSource={onNetworkDisconnectSource}
                onOAuthProvider={onNetworkProviderOAuth}
                onPhoneContactsSync={onNetworkPhoneContactsSync}
                onRefresh={onNetworkRefresh}
              />
            ) : workspaceCardView === "storefrontPreview" ? (
              <StorefrontPreviewCard
                businessName={businessName}
                products={products}
                sokoId={sokoId}
                onBack={() => setWorkspaceCardView("cards")}
                onSell={() => onModeChange("marketplace")}
                onMessage={() => onDraftChange(`Hello ${businessName}, `)}
              />
            ) : (
              <CatalogueNestedCard
                form={productForm}
                products={products}
                view={workspaceCardView}
                onBack={() =>
                  setWorkspaceCardView(workspaceCardView === "catalogue" ? "cards" : "catalogue")
                }
                onChangeForm={onProductFormChange}
                onDeleteProduct={onProductRemove}
                onEditProduct={onProductEdit}
                onOpenAdd={() => {
                  onProductReset();
                  setWorkspaceCardView("addProduct");
                }}
                onOpenDelete={() => setWorkspaceCardView("deleteProduct")}
                onOpenEdit={() => {
                  if (products[0] !== undefined) {
                    onProductEdit(products[0]);
                  }
                  setWorkspaceCardView("editProduct");
                }}
                onOpenFields={() => setWorkspaceCardView("manageFields")}
                onOpenProduct={(product) => {
                  onProductEdit(product);
                  setWorkspaceCardView("editProduct");
                }}
                onSaveFields={onProductFieldsSave}
                onSaveProduct={async () => {
                  await onProductSave();
                  setWorkspaceCardView("catalogue");
                }}
              />
            )}
          </section>
        </div>
      ) : null}
      <div className="composer">
        <button
          className="icon-button composer-icon-button"
          type="button"
          aria-label="Voice input"
          title="Voice input"
        >
          <span className="mic-icon" aria-hidden="true" />
        </button>
        <button
          className="icon-button composer-icon-button"
          type="button"
          aria-label="Attach file"
          title="Attach file"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="attach-icon" aria-hidden="true" />
        </button>
        <input
          ref={fileInputRef}
          className="chat-file-input"
          type="file"
          multiple
          accept={chatAttachmentAccept}
          onChange={onAttachmentChange}
        />
        {pendingAttachments.length > 0 ? (
          <div className="attachment-tray" aria-label="Selected attachments">
            {pendingAttachments.map((attachment) => (
              <span className="attachment-chip" key={attachment.id}>
                <span>
                  <strong>{attachment.name}</strong>
                  <small>
                    {formatAttachmentCategory(attachment.category)} ·{" "}
                    {formatFileSize(attachment.size)}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label className="composer-input">
          <span>Message</span>
          <input
            value={chatDraft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSend();
              }
            }}
            placeholder={
              mode === "seller" ? "Ask your agent to manage the shop" : "What are you looking for?"
            }
          />
        </label>
        <button className="send-button" type="button" onClick={onSend}>
          <span className="send-icon" aria-hidden="true" />
          <span className="visually-hidden">Send</span>
        </button>
      </div>
    </div>
  );
}

interface MarketplaceModeCardProps {
  businessName: string;
  hasBusiness: boolean;
  productCount: number;
  sokoId: string;
  onOpenStore: () => void;
  onPrompt: (prompt: string) => void;
  onSell: () => void;
}

function MarketplaceModeCard({
  businessName,
  hasBusiness,
  productCount,
  sokoId,
  onOpenStore,
  onPrompt,
  onSell
}: MarketplaceModeCardProps) {
  return (
    <section className="generated-card-message mode-card" aria-label="Explore the marketplace">
      <div className="mode-card-heading">
        <span className="mode-badge">Marketplace</span>
        <h2>What are you looking for?</h2>
        <p>Ask naturally, or start with one of these suggestions.</p>
      </div>
      <div className="marketplace-prompts" aria-label="Marketplace suggestions">
        <button type="button" onClick={() => onPrompt("Show me shops near me")}>
          Shops near me
        </button>
        <button type="button" onClick={() => onPrompt("Show me today's offers")}>
          Today&apos;s offers
        </button>
        <button type="button" onClick={() => onPrompt("Find affordable essentials")}>
          Affordable essentials
        </button>
      </div>
      {hasBusiness ? (
        <article className="shop-discovery-card">
          <div>
            <span>Your shop</span>
            <h3>{businessName}</h3>
            <p>
              {sokoId} · {productCount} catalogue {productCount === 1 ? "item" : "items"}
            </p>
          </div>
          <div className="compact-actions">
            <button type="button" onClick={onOpenStore}>
              Open store
            </button>
            <button className="secondary" type="button" onClick={onSell}>
              Manage
            </button>
          </div>
        </article>
      ) : (
        <article className="shop-discovery-card">
          <div>
            <span>Want to sell?</span>
            <h3>Set up your business</h3>
            <p>Create your shop when you are ready. Your buyer account is already active.</p>
          </div>
          <div className="compact-actions">
            <button type="button" onClick={onSell}>
              Set up business
            </button>
          </div>
        </article>
      )}
    </section>
  );
}

interface StorefrontPreviewCardProps {
  businessName: string;
  products: ProductSummary[];
  sokoId: string;
  onBack: () => void;
  onSell: () => void;
  onMessage: () => void;
}

function StorefrontPreviewCard({
  businessName,
  products,
  sokoId,
  onBack,
  onSell,
  onMessage
}: StorefrontPreviewCardProps) {
  return (
    <section
      className="generated-card-message storefront-preview-card"
      aria-label={`${businessName} storefront`}
    >
      <div className="generated-card-header">
        <button className="secondary" type="button" onClick={onBack}>
          Back
        </button>
        <span className="mode-badge">Customer view</span>
      </div>
      <div className="storefront-preview-heading">
        <span className="storefront-preview-logo">{businessName.slice(0, 1).toUpperCase()}</span>
        <div>
          <h2>{businessName}</h2>
          <p>{sokoId}</p>
        </div>
      </div>
      {products.length === 0 ? (
        <div className="inline-empty-state">
          <strong>No public products yet</strong>
          <p>Switch to seller controls and add your first catalogue item.</p>
        </div>
      ) : (
        <div className="storefront-preview-products">
          {products.slice(0, 8).map((product) => (
            <article key={product.id}>
              <strong>{product.name}</strong>
              <span>{product.quantity > 0 ? "In stock" : "Out of stock"}</span>
              <p>
                {product.sellingPrice === null
                  ? `Sold per ${product.unit}`
                  : `${formatMoney(product.sellingPrice)} / ${product.unit}`}
              </p>
              <button type="button" disabled={product.quantity <= 0}>
                Add to order
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="compact-actions">
        <button type="button" onClick={onSell}>
          {products.length === 0 ? "Add products" : "Switch mode"}
        </button>
        <button className="secondary" type="button" onClick={onMessage}>
          Message shop
        </button>
      </div>
    </section>
  );
}

interface ContextualBusinessCardsProps {
  productCount: number;
  customerCount: number;
  invoiceCount: number;
  notificationCount: number;
  report: BusinessReportSummary | null;
  syncSummary: SyncQueueSummary;
  onAddCard: () => void;
  onOpenCatalogue: () => void;
  onOpenNetworkSync: () => void;
  onPreviewStorefront: () => void;
  onNavigate: (view: ShellView) => void;
}

function ContextualBusinessCards({
  productCount,
  customerCount,
  invoiceCount,
  notificationCount,
  report,
  syncSummary,
  onAddCard,
  onOpenCatalogue,
  onOpenNetworkSync,
  onPreviewStorefront,
  onNavigate
}: ContextualBusinessCardsProps) {
  const activeQueueCount =
    syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict;

  const workspaceCards: Array<{
    title: string;
    body: string;
    onClick: () => void;
    value: string;
  }> = [
    {
      title: "Catalogue",
      body: "Stock, SKUs, units and adjustments",
      onClick: onOpenCatalogue,
      value: String(productCount)
    },
    {
      title: "Public shop view",
      body: "See the storefront your customers see",
      onClick: onPreviewStorefront,
      value: "View"
    },
    {
      title: "Make a Sale",
      body: "Create, preview and confirm invoices",
      onClick: () => onNavigate("invoices"),
      value: String(invoiceCount)
    },
    {
      title: "Customers",
      body: "Customer contacts and notes",
      onClick: () => onNavigate("customers"),
      value: String(customerCount)
    },
    {
      title: "Payments",
      body: "Record payments and track balances",
      onClick: () => onNavigate("payments"),
      value: formatMoney(report?.payments.totalPaid ?? 0)
    },
    {
      title: "Business Summary",
      body: "Sales and stock health",
      onClick: () => onNavigate("reports"),
      value: formatMoney(report?.sales.grossSales ?? 0)
    },
    {
      title: "Alerts",
      body: "Low stock, debt and sync notices",
      onClick: () => onNavigate("notifications"),
      value: String(notificationCount)
    },
    {
      title: "Network Sync",
      body: "Contacts, social graphs and invites",
      onClick: onOpenNetworkSync,
      value: String(activeQueueCount)
    },
    {
      title: "Knowledge",
      body: "Supplier files and business records",
      onClick: () => onNavigate("imports"),
      value: "CSV"
    },
    {
      title: "Delivery",
      body: "Pickup and delivery fulfillment",
      onClick: () => onNavigate("logistics"),
      value: "Track"
    },
    {
      title: "+ Add card",
      body: "Add more business cards later",
      onClick: onAddCard,
      value: "+"
    }
  ];

  return (
    <section className="generated-card-message" aria-label="Workspace cards">
      <div className="generated-card-grid">
        {workspaceCards.map((card) => (
          <button key={card.title} type="button" onClick={card.onClick}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <small>{card.body}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function workspacePanelTitle(
  view:
    | "cards"
    | "catalogue"
    | "addProduct"
    | "editProduct"
    | "deleteProduct"
    | "manageFields"
    | "networkSync"
    | "storefrontPreview"
): string {
  if (view === "cards") {
    return "Workspace";
  }

  if (view === "networkSync") {
    return "Network Sync";
  }

  if (view === "storefrontPreview") {
    return "Public shop view";
  }

  return "Catalogue";
}

function NetworkSyncNestedCard({
  graph,
  oauthProviders,
  oauthProvidersLoaded,
  onBack,
  onDisconnectSource,
  onOAuthProvider,
  onPhoneContactsSync,
  onRefresh
}: {
  graph: NetworkGraphSummary | null;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  onBack: () => void;
  onDisconnectSource: (sourceId: string) => void;
  onOAuthProvider: (provider: SocialSignupProvider) => Promise<void>;
  onPhoneContactsSync: (
    selectedContacts: ContactPickerContact[]
  ) => Promise<NetworkGraphSummary | null>;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<"providers" | "phone">("providers");
  const [localGraph, setLocalGraph] = useState<NetworkGraphSummary | null>(graph);
  const [selectedContacts, setSelectedContacts] = useState<ContactPickerContact[]>([]);
  const [selectedContactKeys, setSelectedContactKeys] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLocalGraph(graph);
  }, [graph]);

  const activeGraph = localGraph ?? graph;
  const phoneSource = getActiveNetworkSource(activeGraph, "phone");
  const alreadyOnSokoCount =
    activeGraph?.nodes.filter(
      (node) =>
        node.sourceType === "phone_contact" &&
        node.degree === 1 &&
        (node.kind === "soko_user" || node.sokoUserId != null)
    ).length ?? 0;
  const filteredContacts = selectedContacts.filter((contact) =>
    getContactDisplayName(contact).toLowerCase().includes(contactSearch.trim().toLowerCase())
  );
  const inviteContacts = filteredContacts.filter((contact) => {
    const converted = contactPickerContactToNetworkContact(contact);
    return converted !== null && (converted.phone !== null || converted.email !== null);
  });
  const unknownContacts = filteredContacts.filter((contact) => {
    const converted = contactPickerContactToNetworkContact(contact);
    return converted === null || (converted.phone === null && converted.email === null);
  });

  async function requestPhoneContacts() {
    const contactNavigator = navigator as ContactPickerNavigator;

    if (contactNavigator.contacts?.select === undefined) {
      setMessage("Contact permission is only available on supported Android mobile browsers.");
      return;
    }

    try {
      const contacts = await contactNavigator.contacts.select(["name", "tel", "email"], {
        multiple: true
      });

      if (contacts.length === 0) {
        setMessage("No contacts selected.");
        return;
      }

      const nextGraph = await onPhoneContactsSync(contacts);
      setSelectedContacts(contacts);
      setSelectedContactKeys(contacts.map(contactSelectionKey));
      if (nextGraph !== null) {
        setLocalGraph(nextGraph);
      }
      setMessage(
        `Imported ${contacts.length} selected contact${contacts.length === 1 ? "" : "s"}.`
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setMessage("Contact access was denied. You can allow it later from your browser settings.");
    }
  }

  async function connectProvider(providerId: NetworkSyncProviderId) {
    const provider = networkSyncProviders.find((item) => item.id === providerId);

    if (provider?.id === "phone") {
      setView("phone");
      return;
    }

    if (provider?.oauthProvider === null || provider === undefined) {
      setMessage("This login provider is not configured yet.");
      return;
    }

    const oauthConfig = oauthProviders.find((item) => item.id === provider.oauthProvider);

    if (!oauthProvidersLoaded) {
      setMessage("Social providers are still loading. Try again in a moment.");
      return;
    }

    if (oauthConfig?.implemented === false || oauthConfig?.configured !== true) {
      setMessage("This login provider is not configured yet.");
      return;
    }

    await onOAuthProvider(provider.oauthProvider);
  }

  function selectAllVisibleContacts() {
    setSelectedContactKeys(filteredContacts.map(contactSelectionKey));
  }

  function inviteSelectedContacts() {
    if (selectedContactKeys.length === 0) {
      setMessage("Select contacts to invite first.");
      return;
    }

    setMessage("Invite delivery endpoints are not implemented yet.");
  }

  function disconnectPhoneSource() {
    if (phoneSource === null) {
      setMessage("Phone contacts are not connected yet.");
      return;
    }

    onDisconnectSource(phoneSource.id);
    setLocalGraph((current) =>
      current === null
        ? current
        : {
            ...current,
            sources: current.sources.map((source) =>
              source.id === phoneSource.id
                ? { ...source, status: "disconnected", importedCount: 0 }
                : source
            )
          }
    );
    setMessage("Phone contact access was revoked for this workspace.");
  }

  if (view === "phone") {
    return (
      <section className="nested-card network-sync-card" aria-label="Phone Contacts">
        <button className="nested-breadcrumb" type="button" onClick={() => setView("providers")}>
          &lt; Network Sync
        </button>
        <div className="nested-card-title-row">
          <div>
            <h3>Phone Contacts</h3>
            <p>Allow Soko to access contacts only when you tap Allow Access.</p>
          </div>
          <span className={phoneSource === null ? "network-status disconnected" : "network-status"}>
            {phoneSource === null ? "Not Connected" : "Connected"}
          </span>
        </div>
        <div className="permission-checklist">
          <span>Read contacts</span>
          <span>Detect existing Soko users</span>
          <span>Invite non-users</span>
          <span>Keep contacts synchronized</span>
        </div>
        <div className="nested-form-actions">
          <button type="button" onClick={() => void requestPhoneContacts()}>
            Allow Access
          </button>
          <button className="secondary" type="button" onClick={() => void requestPhoneContacts()}>
            Refresh
          </button>
          <button className="secondary" type="button" onClick={disconnectPhoneSource}>
            Disconnect
          </button>
        </div>
        {selectedContacts.length > 0 ? (
          <div className="phone-contact-manager">
            <label className="network-search">
              <span>Search</span>
              <input
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search imported contacts"
              />
            </label>
            <div className="nested-form-actions">
              <button className="secondary" type="button" onClick={selectAllVisibleContacts}>
                Select All
              </button>
              <button type="button" onClick={inviteSelectedContacts}>
                Invite Selected
              </button>
            </div>
            <NetworkContactGroup
              contacts={[]}
              count={alreadyOnSokoCount}
              title="Already using Soko"
            />
            <NetworkContactGroup
              contacts={inviteContacts}
              selectedContactKeys={selectedContactKeys}
              title="Invite to Soko"
              onToggle={(key) =>
                setSelectedContactKeys((keys) =>
                  keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
                )
              }
            />
            <NetworkContactGroup contacts={unknownContacts} title="Unknown contacts" />
          </div>
        ) : null}
        {message.length > 0 ? <p className="setup-status">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="nested-card network-sync-card" aria-label="Network Sync providers">
      <button className="nested-breadcrumb" type="button" onClick={onBack}>
        &lt; Workspace
      </button>
      <div className="nested-card-title-row">
        <div>
          <h3>Network Sync</h3>
          <p>Connect relationship sources for your shop agent.</p>
        </div>
        <button className="small-outline-button" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <div className="network-provider-list">
        {networkSyncProviders.map((provider) => {
          const source = getActiveNetworkSource(activeGraph, provider.id);
          const oauthConfig =
            provider.oauthProvider === null
              ? null
              : oauthProviders.find((item) => item.id === provider.oauthProvider);
          const configured =
            provider.id === "phone" ||
            (oauthProvidersLoaded && oauthConfig?.implemented !== false && oauthConfig?.configured);
          const statusText =
            source === null ? (configured ? "Connect" : "Not configured") : "Connected";

          return (
            <article className="network-provider-row" key={provider.id}>
              <button type="button" onClick={() => void connectProvider(provider.id)}>
                <span className="network-provider-icon">{provider.icon}</span>
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.detail}</small>
                  <small>
                    {source === null
                      ? "Last sync: never"
                      : `Last sync: ${new Date(source.updatedAt ?? source.createdAt ?? Date.now()).toLocaleString()}`}
                  </small>
                </span>
              </button>
              <div>
                <span
                  className={source === null ? "network-status disconnected" : "network-status"}
                >
                  {statusText}
                </span>
                <strong>{source?.importedCount ?? 0}</strong>
                <small>contacts</small>
              </div>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  source === null
                    ? void connectProvider(provider.id)
                    : onDisconnectSource(source.id)
                }
              >
                {source === null ? "Sync" : "Disconnect"}
              </button>
            </article>
          );
        })}
      </div>
      {message.length > 0 ? <p className="setup-status">{message}</p> : null}
    </section>
  );
}

function NetworkContactGroup({
  contacts,
  count,
  selectedContactKeys,
  title,
  onToggle
}: {
  contacts: ContactPickerContact[];
  count?: number;
  selectedContactKeys?: string[];
  title: string;
  onToggle?: (key: string) => void;
}) {
  return (
    <section className="network-contact-group">
      <h4>
        {title} ({count ?? contacts.length})
      </h4>
      {contacts.length === 0 ? (
        <p className="shell-note">No contacts in this group yet.</p>
      ) : (
        contacts.slice(0, 30).map((contact) => {
          const key = contactSelectionKey(contact);
          const converted = contactPickerContactToNetworkContact(contact);

          return (
            <label key={key}>
              {onToggle !== undefined ? (
                <input
                  checked={selectedContactKeys?.includes(key) ?? false}
                  type="checkbox"
                  onChange={() => onToggle(key)}
                />
              ) : null}
              <span>
                <strong>{getContactDisplayName(contact)}</strong>
                <small>{converted?.phone ?? converted?.email ?? "No phone or email"}</small>
              </span>
            </label>
          );
        })
      )}
    </section>
  );
}

function getActiveNetworkSource(
  graph: NetworkGraphSummary | null,
  providerId: NetworkSyncProviderId
): NetworkSyncSourceSummary | null {
  if (graph === null) {
    return null;
  }

  const platform = providerId === "phone" ? "phone" : providerId;
  return (
    graph.sources.find(
      (source) => source.sourcePlatform === platform && source.status === "active"
    ) ?? null
  );
}

function contactSelectionKey(contact: ContactPickerContact): string {
  return `${getContactDisplayName(contact)}:${contact.tel?.[0] ?? ""}:${contact.email?.[0] ?? ""}`;
}

function CatalogueNestedCard({
  form,
  products,
  view,
  onBack,
  onChangeForm,
  onDeleteProduct,
  onEditProduct,
  onOpenAdd,
  onOpenDelete,
  onOpenEdit,
  onOpenFields,
  onOpenProduct,
  onSaveFields,
  onSaveProduct
}: {
  form: ProductFormState;
  products: ProductSummary[];
  view: "catalogue" | "addProduct" | "editProduct" | "deleteProduct" | "manageFields";
  onBack: () => void;
  onChangeForm: (form: ProductFormState) => void;
  onDeleteProduct: (productId: string) => void;
  onEditProduct: (product: ProductSummary) => void;
  onOpenAdd: () => void;
  onOpenDelete: () => void;
  onOpenEdit: () => void;
  onOpenFields: () => void;
  onOpenProduct: (product: ProductSummary) => void;
  onSaveFields: (fields: ProductFieldDraft[]) => void;
  onSaveProduct: () => Promise<void>;
}) {
  const [customProductFields, setCustomProductFields] = useState<ProductFieldDraft[]>([]);
  const [managedFields, setManagedFields] = useState<ProductFieldDraft[]>(() =>
    createDefaultProductFieldDrafts()
  );

  function addCustomProductField() {
    setCustomProductFields((fields) => [...fields, createProductFieldDraft("Custom field")]);
  }

  function updateCustomProductField(fieldId: string, value: string) {
    setCustomProductFields((fields) =>
      fields.map((field) => (field.id === fieldId ? { ...field, value } : field))
    );
  }

  function removeCustomProductField(fieldId: string) {
    setCustomProductFields((fields) => fields.filter((field) => field.id !== fieldId));
  }

  function updateManagedField(fieldId: string, patch: Partial<ProductFieldDraft>) {
    setManagedFields((fields) =>
      fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field))
    );
  }

  function moveManagedField(fieldId: string, direction: -1 | 1) {
    setManagedFields((fields) => {
      const index = fields.findIndex((field) => field.id === fieldId);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= fields.length) {
        return fields;
      }

      const nextFields = [...fields];
      const [field] = nextFields.splice(index, 1);

      if (field === undefined) {
        return fields;
      }

      nextFields.splice(nextIndex, 0, field);
      return nextFields;
    });
  }

  function removeManagedField(fieldId: string) {
    setManagedFields((fields) => fields.filter((field) => field.id !== fieldId || field.required));
  }

  if (view === "catalogue") {
    return (
      <div className="nested-card catalogue-card">
        <button className="nested-breadcrumb" type="button" onClick={onBack}>
          &lt; Workspace
        </button>
        <div className="nested-card-title-row">
          <div>
            <h3>Catalogue</h3>
            <p>Manage your products and menu</p>
          </div>
          <span className="count-badge">{products.length}</span>
        </div>
        <div className="catalogue-action-grid" aria-label="Catalogue actions">
          <button className="success" type="button" onClick={onOpenAdd}>
            <span>+</span>
            Add Product
          </button>
          <button type="button" onClick={onOpenEdit}>
            <span>Edit</span>
            Edit Product
          </button>
          <button className="danger" type="button" onClick={onOpenDelete}>
            <span>Del</span>
            Delete Product
          </button>
          <button className="secondary" type="button" onClick={onOpenFields}>
            <span>Fields</span>
            Manage Fields
          </button>
        </div>
        <div className="nested-list-heading">
          <strong>Existing products</strong>
          <span>{products.length}</span>
        </div>
        {products.length === 0 ? (
          <div className="catalogue-empty-state">
            <div className="catalogue-empty-icon" aria-hidden="true" />
            <h3>No products yet</h3>
            <p>Add the first product to start stock records.</p>
            <button type="button" onClick={onOpenAdd}>
              Add product
            </button>
          </div>
        ) : (
          <div className="nested-product-list">
            {products.map((product) => (
              <button type="button" key={product.id} onClick={() => onOpenProduct(product)}>
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {product.sku ?? "No SKU"} - {product.quantity} {product.unit} -{" "}
                    {formatOptionalMoney(product.sellingPrice)}
                  </small>
                </span>
                <span aria-hidden="true">&gt;</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === "deleteProduct") {
    return (
      <div className="nested-card">
        <button className="nested-breadcrumb" type="button" onClick={onBack}>
          &lt; Catalogue
        </button>
        <div className="nested-card-title-row">
          <div>
            <h3>Delete Product</h3>
            <p>Select a product to remove from stock records.</p>
          </div>
        </div>
        {products.length === 0 ? (
          <div className="catalogue-empty-state compact">
            <h3>No products yet</h3>
            <p>There are no product records to delete.</p>
          </div>
        ) : (
          <div className="nested-product-list danger-list">
            {products.map((product) => (
              <button type="button" key={product.id} onClick={() => onDeleteProduct(product.id)}>
                <span>
                  <strong>{product.name}</strong>
                  <small>{product.sku ?? "No SKU"}</small>
                </span>
                <span>Delete</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === "manageFields") {
    return (
      <div className="nested-card">
        <button className="nested-breadcrumb" type="button" onClick={onBack}>
          &lt; Catalogue
        </button>
        <div className="nested-card-title-row">
          <div>
            <h3>Manage Fields</h3>
            <p>Add, remove, or reorder catalogue fields.</p>
          </div>
          <button
            className="small-outline-button"
            type="button"
            onClick={() =>
              setManagedFields((fields) => [...fields, createProductFieldDraft("Custom field")])
            }
          >
            + Add field
          </button>
        </div>
        <div className="field-manager-list">
          {managedFields.map((field, index) => (
            <div className="field-manager-row" key={field.id}>
              <span className="drag-handle">::</span>
              <label>
                Label
                <input
                  value={field.label}
                  onChange={(event) => updateManagedField(field.id, { label: event.target.value })}
                />
              </label>
              <label>
                Type
                <select
                  value={field.inputType}
                  onChange={(event) =>
                    updateManagedField(field.id, {
                      inputType: event.target.value as ProductFieldInputType
                    })
                  }
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="select">Select</option>
                  <option value="textarea">Textarea</option>
                  <option value="yes_no">Yes/no</option>
                </select>
              </label>
              <div className="field-manager-actions">
                <button
                  type="button"
                  onClick={() => moveManagedField(field.id, -1)}
                  disabled={index === 0}
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => moveManagedField(field.id, 1)}
                  disabled={index === managedFields.length - 1}
                >
                  Down
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => removeManagedField(field.id)}
                  disabled={field.required}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="nested-form-actions">
          <button className="secondary" type="button" onClick={onBack}>
            Cancel
          </button>
          <button type="button" onClick={() => onSaveFields(managedFields)}>
            Save structure
          </button>
        </div>
      </div>
    );
  }

  return (
    <ProductNestedEditor
      customFields={customProductFields}
      form={form}
      isEdit={view === "editProduct"}
      products={products}
      onAddField={addCustomProductField}
      onBack={onBack}
      onChangeCustomField={updateCustomProductField}
      onChangeForm={onChangeForm}
      onEditProduct={onEditProduct}
      onRemoveCustomField={removeCustomProductField}
      onSave={onSaveProduct}
    />
  );
}

function ProductNestedEditor({
  customFields,
  form,
  isEdit,
  products,
  onAddField,
  onBack,
  onChangeCustomField,
  onChangeForm,
  onEditProduct,
  onRemoveCustomField,
  onSave
}: {
  customFields: ProductFieldDraft[];
  form: ProductFormState;
  isEdit: boolean;
  products: ProductSummary[];
  onAddField: () => void;
  onBack: () => void;
  onChangeCustomField: (fieldId: string, value: string) => void;
  onChangeForm: (form: ProductFormState) => void;
  onEditProduct: (product: ProductSummary) => void;
  onRemoveCustomField: (fieldId: string) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="nested-card">
      <button className="nested-breadcrumb" type="button" onClick={onBack}>
        &lt; Catalogue
      </button>
      <div className="nested-card-title-row">
        <div>
          <h3>{isEdit ? "Edit Product" : "Add Product"}</h3>
          <p>{isEdit ? "Update stock item details." : "Create a new stock item."}</p>
        </div>
        <button className="small-outline-button" type="button" onClick={onAddField}>
          + Add field
        </button>
      </div>
      {isEdit ? (
        <label>
          Product
          <select
            value={form.id ?? ""}
            onChange={(event) => {
              const product = products.find((item) => item.id === event.target.value);

              if (product !== undefined) {
                onEditProduct(product);
              }
            }}
          >
            <option value="">Select product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="nested-form-section">
        <div className="nested-form-section-heading">
          <strong>Basic details</strong>
          <button className="small-outline-button" type="button" onClick={onAddField}>
            + Add field
          </button>
        </div>
        <label>
          Name *
          <input
            value={form.name}
            placeholder="Enter product name"
            onChange={(event) => onChangeForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          SKU *
          <input
            value={form.sku}
            placeholder="Enter SKU"
            onChange={(event) => onChangeForm({ ...form, sku: event.target.value })}
          />
        </label>
        <label>
          Unit
          <select
            value={form.unit}
            onChange={(event) => onChangeForm({ ...form, unit: event.target.value })}
          >
            <option value="unit">unit</option>
            <option value="piece">piece</option>
            <option value="kg">kg</option>
            <option value="litre">litre</option>
            <option value="box">box</option>
          </select>
        </label>
        <label>
          Quantity
          <input
            value={form.quantity}
            inputMode="decimal"
            onChange={(event) => onChangeForm({ ...form, quantity: event.target.value })}
          />
        </label>
        <label>
          Selling Price
          <input
            value={form.sellingPrice}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(event) => onChangeForm({ ...form, sellingPrice: event.target.value })}
          />
        </label>
        {customFields.map((field) => (
          <div className="custom-product-field-row" key={field.id}>
            <span className="drag-handle">::</span>
            <label>
              {field.label}
              <input
                value={field.value}
                placeholder={field.label}
                onChange={(event) => onChangeCustomField(field.id, event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => onRemoveCustomField(field.id)}
              aria-label="Remove field"
            >
              x
            </button>
          </div>
        ))}
      </div>
      <details className="nested-form-section">
        <summary>Advanced details</summary>
        <label>
          Buying price
          <input
            value={form.buyingPrice}
            inputMode="decimal"
            placeholder="Optional"
            onChange={(event) => onChangeForm({ ...form, buyingPrice: event.target.value })}
          />
        </label>
        <button className="small-outline-button" type="button" onClick={onAddField}>
          + Add field
        </button>
      </details>
      <div className="nested-form-actions">
        <button className="secondary" type="button" onClick={onBack}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={form.name.trim().length === 0}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function createDefaultProductFieldDrafts(): ProductFieldDraft[] {
  return [
    createProductFieldDraft("Name", "text", true),
    createProductFieldDraft("SKU", "text", true),
    createProductFieldDraft("Unit", "select", true),
    createProductFieldDraft("Quantity", "number", true),
    createProductFieldDraft("Selling Price", "number", true)
  ];
}

function createProductFieldDraft(
  label: string,
  inputType: ProductFieldInputType = "text",
  required = false
): ProductFieldDraft {
  return {
    id: `product-field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    inputType,
    label,
    required,
    value: ""
  };
}

function ShopPresenceButtons({
  activeStatus,
  onStatusChange
}: {
  activeStatus: ShopPresenceStatus;
  onStatusChange: (status: ShopPresenceStatus) => void;
}) {
  const statuses: Array<{ id: ShopPresenceStatus; label: string }> = [
    { id: "online", label: "Online" },
    { id: "private", label: "Private" },
    { id: "offline", label: "Offline" }
  ];

  return (
    <span className="shop-presence-buttons" aria-label="Shop status">
      {statuses.map((status) => (
        <button
          aria-label={status.label}
          className={`presence-dot ${status.id} ${activeStatus === status.id ? "active" : ""}`}
          key={status.id}
          type="button"
          title={status.label}
          onClick={() => onStatusChange(status.id)}
        />
      ))}
    </span>
  );
}

interface EmptyStateSurfaceProps {
  title: string;
  body: string;
  onChat: () => void;
  actionLabel?: string;
}

function EmptyStateSurface({
  title,
  body,
  onChat,
  actionLabel = "Draft in chat"
}: EmptyStateSurfaceProps) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      <button type="button" onClick={onChat}>
        {actionLabel}
      </button>
    </div>
  );
}

async function postJson<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    throw new Error(error.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

async function patchJson<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    throw new Error(error.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

async function deleteJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "DELETE",
    credentials: "include"
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    throw new Error(error.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

async function getJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include"
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    throw new Error(error.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

function readStorefrontAgentId(): string | null {
  const pathname = window.location.pathname;
  const match =
    pathname.match(/^\/agent\/([^/]+)\/?$/) ??
    pathname.match(/^\/(?:shop|soko)\/([^/]+)\/?$/) ??
    pathname.match(/^(\/\+\d{1,3}-A\d{8})\/?$/);

  if (match === null) {
    return null;
  }

  const rawAgentId = (match[1] ?? "").replace(/^\//, "");
  const agentId = decodeURIComponent(rawAgentId).trim();

  if (agentId.length === 0) {
    return null;
  }

  if (!pathname.startsWith("/agent/")) {
    const canonicalAgentId = isSokoId(agentId) ? agentId : encodeURIComponent(agentId);
    window.history.replaceState(null, "", `/agent/${canonicalAgentId}${window.location.search}`);
  }

  return agentId;
}

function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const canInstall = installPrompt !== null && !isStandaloneWebApp();

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function installApp() {
    if (installPrompt === null) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return {
    canInstall,
    installApp
  };
}

function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (import.meta.env.DEV) {
    void unregisterDevelopmentServiceWorkers();
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

async function unregisterDevelopmentServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ("caches" in globalThis) {
      const cacheNames = await globalThis.caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("soko-market-app-"))
          .map((cacheName) => globalThis.caches.delete(cacheName))
      );
    }
  } catch (error) {
    console.warn("Unable to unregister the development service worker.", error);
  }
}

function isStandaloneWebApp(): boolean {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function readStoredBusiness(): ActiveBusiness | null {
  const stored =
    localStorage.getItem(activeBusinessStorageKey) ??
    localStorage.getItem(legacyActiveBusinessStorageKey);

  if (stored === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as ActiveBusiness;

    if (
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      (parsed.language === "en" || parsed.language === "sw") &&
      typeof parsed.role === "string"
    ) {
      return {
        ...parsed,
        sokoId:
          typeof parsed.sokoId === "string" && isSokoId(parsed.sokoId)
            ? parsed.sokoId
            : createFallbackSokoId(parsed.id, parsed.name)
      };
    }
  } catch {
    localStorage.removeItem(activeBusinessStorageKey);
    localStorage.removeItem(legacyActiveBusinessStorageKey);
  }

  return null;
}

function readStoredSokoMode(): SokoMode {
  return localStorage.getItem(activeModeStorageKey) === "seller" ? "seller" : "marketplace";
}

function readStoredAgent(): AgentSettings | null {
  const stored = localStorage.getItem(activeAgentStorageKey);

  if (stored === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as AgentSettings;

    if (
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.description === "string" &&
      isAgentModel(parsed.model) &&
      typeof parsed.role === "string" &&
      typeof parsed.globalAgentId === "string" &&
      typeof parsed.storefrontUrl === "string" &&
      (parsed.language === "en" || parsed.language === "sw") &&
      typeof parsed.personality === "string" &&
      typeof parsed.instructions === "string" &&
      typeof parsed.knowledge === "string" &&
      Array.isArray(parsed.tools) &&
      Array.isArray(parsed.integrations)
    ) {
      return {
        ...parsed,
        contextScripts: Array.isArray(parsed.contextScripts)
          ? sanitizeContextScripts(parsed.contextScripts)
          : defaultAgentContextScripts
      };
    }
  } catch {
    localStorage.removeItem(activeAgentStorageKey);
  }

  return null;
}

function readStoredOwnerAuth(): OwnerAuthRecord | null {
  const stored = localStorage.getItem(ownerAuthStorageKey);

  if (stored === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as OwnerAuthRecord;

    if (typeof parsed.contact === "string" && isCountryDialCode(parsed.countryCode)) {
      return {
        contact: parsed.contact,
        countryCode: parsed.countryCode,
        pinSet: typeof parsed.pinSet === "boolean" ? parsed.pinSet : true,
        ...(isSocialSignupProvider(parsed.provider) ? { provider: parsed.provider } : {})
      };
    }
  } catch {
    localStorage.removeItem(ownerAuthStorageKey);
  }

  return null;
}

function readPendingOAuthLogin(): PendingOAuthLogin | null {
  const stored = sessionStorage.getItem(pendingOAuthStorageKey);

  if (stored === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as PendingOAuthLogin;

    if (
      isSocialSignupProvider(parsed.provider) &&
      typeof parsed.state === "string" &&
      parsed.state.length > 0 &&
      typeof parsed.csrfToken === "string" &&
      parsed.csrfToken.length > 0
    ) {
      return parsed;
    }
  } catch {
    sessionStorage.removeItem(pendingOAuthStorageKey);
  }

  return null;
}

function readSetupDraft(): SetupDraft | null {
  const stored = localStorage.getItem(setupDraftStorageKey);

  if (stored === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as SetupDraft;

    if (
      (parsed.channel === "phone" || parsed.channel === "email") &&
      typeof parsed.destination === "string" &&
      typeof parsed.businessName === "string" &&
      (parsed.language === "en" || parsed.language === "sw") &&
      (parsed.completedStep === 0 || parsed.completedStep === 1 || parsed.completedStep === 2)
    ) {
      return {
        ...parsed,
        countryCode: isCountryDialCode(parsed.countryCode)
          ? parsed.countryCode
          : (inferCountryCode(parsed.destination) ?? "+254")
      };
    }
  } catch {
    localStorage.removeItem(setupDraftStorageKey);
  }

  return null;
}

function createDefaultAgent(business: ActiveBusiness | null): AgentSettings {
  const businessName = business?.name.trim() || "Soko.market";
  const globalAgentId =
    business === null ? "local-soko-market" : createPublicStorefrontAgentId(business);

  return {
    id: `agent-${globalAgentId}`,
    name: businessName,
    description: "AI business attendant linked to a predownloaded small local model.",
    model: "qwen2.5-0.5b-android",
    role: "Business assistant and storefront attendant",
    globalAgentId,
    storefrontUrl: createStorefrontUrl(globalAgentId),
    language: business?.language ?? "en",
    personality: "Warm, concise, accurate and commercially practical",
    instructions:
      "Help the owner run daily business work and help customers browse the storefront.",
    knowledge:
      "Use saved products, invoices, payments, notifications and owner-provided knowledge.",
    tools: ["Products", "Customers", "Invoices", "Payments", "Reports"],
    integrations: ["Soko.market storefront"],
    contextScripts: defaultAgentContextScripts,
    status: "active"
  };
}

function createPublicStorefrontAgentId(business: ActiveBusiness): string {
  if (isSokoId(business.sokoId)) {
    return business.sokoId;
  }

  return createFallbackSokoId(business.id, business.name);
}

function createPublicStorefrontUrl(business: ActiveBusiness): string {
  return createStorefrontUrl(createPublicStorefrontAgentId(business));
}

function createStorefrontUrl(agentId: string): string {
  const trimmedAgentId = agentId.trim();
  const normalizedAgentId = isSokoId(trimmedAgentId)
    ? trimmedAgentId
    : encodeURIComponent(trimmedAgentId);
  const localOrigins = ["localhost", "127.0.0.1", "0.0.0.0"];

  if (localOrigins.includes(window.location.hostname)) {
    return `${window.location.origin}/agent/${normalizedAgentId}`;
  }

  return `https://soko.market/agent/${normalizedAgentId}`;
}

function createFallbackSokoId(businessId: string, businessName: string): string {
  const seed = `${businessId}:${businessName}`;
  let hash = 0;

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return `+254-A${(hash % 100_000_000).toString().padStart(8, "0")}`;
}

function isSokoId(value: unknown): value is string {
  return typeof value === "string" && /^\+\d{1,3}-A\d{8}$/.test(value);
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

function splitListInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sanitizeContextScripts(scripts: unknown[]): string[] {
  return scripts
    .map((script) => (typeof script === "string" ? sanitizeContextScript(script) : ""))
    .filter((script) => script.length > 0)
    .slice(0, 12);
}

function sanitizeContextScript(script: string): string {
  return script
    .replace(/<\s*\/?\s*script[^>]*>/gi, "")
    .replace(
      /\b(eval|Function|import|require|fetch|XMLHttpRequest|localStorage|document|window)\b/gi,
      "[blocked]"
    )
    .replace(/[;&|`$<>]/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 40)
    .join("\n")
    .slice(0, 2400);
}

function isAgentModel(value: unknown): value is AgentModel {
  return (
    value === "qwen2.5-0.5b-android" ||
    value === "sokoclaw-local" ||
    value === "openai-fast" ||
    value === "openai-reasoning"
  );
}

function isSocialSignupProvider(value: unknown): value is SocialSignupProvider {
  return (
    value === "google" ||
    value === "facebook" ||
    value === "tiktok" ||
    value === "x" ||
    value === "apple" ||
    value === "github" ||
    value === "microsoft" ||
    value === "linkedin"
  );
}

function getAuthProviderConfig(
  provider: (typeof socialSignupProviders)[number],
  summaries: OAuthProviderSummary[],
  loaded: boolean
): {
  id: SocialSignupProvider;
  label: string;
  icon: string;
  enabled: boolean;
  configured: boolean;
  authRedirectPath: string;
} {
  const summary = summaries.find((item) => item.id === provider.id);
  const configured = loaded && summary?.configured === true && summary.implemented !== false;

  return {
    id: provider.id,
    label: provider.label,
    icon: provider.icon,
    enabled: configured,
    configured,
    authRedirectPath: provider.authRedirectPath
  };
}

function composeSignupContact(
  channel: AuthChannel,
  countryCode: CountryDialCode,
  destination: string
): string {
  if (channel === "email") {
    return destination.trim();
  }

  const selectedCountryCode = getCountryDialCode(countryCode);
  const phone = sanitizePhoneSuffix(destination, selectedCountryCode.suffixLength);

  if (phone.startsWith("+")) {
    return phone;
  }

  return `${countryCode}${phone}`;
}

function inferCountryCode(value: string): CountryDialCode | null {
  const normalized = value.trim().replace(/[\s-]/g, "");

  return countryDialCodes.find((item) => normalized.startsWith(item.code))?.code ?? null;
}

function stripDialCode(value: string, countryCode: CountryDialCode): string {
  const normalized = value.trim();

  if (!normalized.startsWith("+")) {
    return normalized;
  }

  const matchedCode = inferCountryCode(normalized) ?? countryCode;

  return normalized.replace(matchedCode, "").replace(/^[\s-]+/, "");
}

function isCountryDialCode(value: unknown): value is CountryDialCode {
  return countryDialCodes.some((item) => item.code === value);
}

function getCountryDialCode(countryCode: CountryDialCode) {
  return (
    countryDialCodes.find((item) => item.code === countryCode) ?? {
      code: "+254" as const,
      country: "Kenya",
      flag: "KE",
      suffixLength: 9
    }
  );
}

function sanitizePhoneSuffix(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function isValidPin(value: string): boolean {
  return /^\d{4}$/.test(value);
}

function isSignupContactValid(
  channel: AuthChannel,
  countryCode: CountryDialCode,
  contact: string
): boolean {
  if (channel === "email") {
    return isValidContact(channel, contact);
  }

  const selectedCountryCode = getCountryDialCode(countryCode);
  const phoneSuffix = sanitizePhoneSuffix(contact, selectedCountryCode.suffixLength);

  return phoneSuffix.length === selectedCountryCode.suffixLength;
}

function isValidContact(channel: AuthChannel, contact: string): boolean {
  const value = contact.trim();

  if (channel === "email") {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }

  return /^\+?[0-9\s-]{7,18}$/.test(value);
}

function createChatAttachment(file: File): ChatAttachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}`,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    category: getAttachmentCategory(file)
  };
}

function getAttachmentCategory(file: File): ChatAttachment["category"] {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  if (
    file.type.startsWith("text/") ||
    file.type.startsWith("application/") ||
    /\.(csv|doc|docx|json|odp|ods|odt|pdf|ppt|pptx|rtf|txt|xls|xlsx|xml)$/i.test(file.name)
  ) {
    return "document";
  }

  return "other";
}

function createAttachmentOnlyMessage(attachments: ChatAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }

  return `Uploaded ${attachments.length} ${attachments.length === 1 ? "file" : "files"}.`;
}

function appendAttachmentSummary(message: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) {
    return message;
  }

  return `${message}\n\nAttachments:\n${attachments.map(formatAttachmentForRuntime).join("\n")}`;
}

function formatAttachmentForRuntime(attachment: ChatAttachment): string {
  return `- ${attachment.name} (${formatAttachmentCategory(attachment.category)}, ${attachment.type}, ${formatFileSize(
    attachment.size
  )})`;
}

function formatAttachmentCategory(category: ChatAttachment["category"]): string {
  if (category === "image") {
    return "Image";
  }

  if (category === "video") {
    return "Video";
  }

  if (category === "document") {
    return "Document";
  }

  return "File";
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }

  return `${Math.round(size / 104857.6) / 10} MB`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function asSupplierImportDraft(mapped: DocumentImportDraft): SupplierImportDraft {
  return {
    name: mapped.name,
    phone: "phone" in mapped ? mapped.phone : null,
    email: "email" in mapped ? mapped.email : null,
    notes: "notes" in mapped ? mapped.notes : null
  };
}

function asProductImportDraft(mapped: DocumentImportDraft): ProductImportDraft {
  return {
    name: mapped.name,
    sku: "sku" in mapped ? mapped.sku : null,
    unit: "unit" in mapped ? mapped.unit : "unit",
    quantity: "quantity" in mapped ? mapped.quantity : 0,
    buyingPrice: "buyingPrice" in mapped ? mapped.buyingPrice : null,
    sellingPrice: "sellingPrice" in mapped ? mapped.sellingPrice : null
  };
}

function createImportSourceTemplates(target: DocumentImportTarget): ImportSourceTemplate[] {
  if (target === "supplier") {
    return [
      {
        id: "supplier-sheet",
        label: "Spreadsheet",
        summary: "CSV, TSV, XLS, XLSX, Google Sheets export",
        sourceType: "upload",
        sourceLocator: "Upload or paste a supplier sheet export",
        fileName: "supplier-contacts.csv",
        contentType: "text/csv",
        content:
          "name,phone,email,notes\nWholesale Depot,+254700000010,supply@example.com,Main supplier\nRegional Foods,+254700000011,regional@example.com,Backup supplier"
      },
      {
        id: "supplier-document",
        label: "PDF or Word",
        summary: "Extract supplier rows from copied document text",
        sourceType: "paste",
        sourceLocator: "Paste text extracted from PDF, DOC, DOCX, or scanned document",
        fileName: "supplier-document.txt",
        contentType: "text/plain",
        content:
          "name,phone,email,notes\nMarket Distributor,+254700000012,market@example.com,Imported from document\nCounty Wholesaler,+254700000013,county@example.com,Imported from document"
      },
      {
        id: "supplier-database",
        label: "Existing database",
        summary: "Paste an exported table or reference a supplier source",
        sourceType: "database",
        sourceLocator: "suppliers table export",
        fileName: "supplier-database-export.csv",
        contentType: "text/csv",
        content:
          "name,phone,email,notes\nDatabase Supplier,+254700000014,db-supplier@example.com,Imported from database export"
      }
    ];
  }

  return [
    {
      id: "product-sheet",
      label: "Spreadsheet",
      summary: "CSV, TSV, XLS, XLSX, Google Sheets export",
      sourceType: "upload",
      sourceLocator: "Upload or paste a catalogue sheet export",
      fileName: "product-catalogue.csv",
      contentType: "text/csv",
      content:
        "name,sku,unit,quantity,buyingPrice,sellingPrice\nTomatoes,TOM-001,kg,20,60,90\nCooking Oil,OIL-001,litre,12,220,260"
    },
    {
      id: "product-document",
      label: "PDF or Word",
      summary: "Extract product rows from copied document text",
      sourceType: "paste",
      sourceLocator: "Paste text extracted from PDF, DOC, DOCX, or scanned catalogue",
      fileName: "product-document.txt",
      contentType: "text/plain",
      content:
        "name,sku,unit,quantity,buyingPrice,sellingPrice\nRice,RIC-001,kg,30,120,155\nBeans,BEA-001,kg,25,90,130"
    },
    {
      id: "product-database",
      label: "Existing database",
      summary: "Paste an exported table or reference a product source",
      sourceType: "database",
      sourceLocator: "products table export",
      fileName: "product-database-export.csv",
      contentType: "text/csv",
      content:
        "name,sku,unit,quantity,buyingPrice,sellingPrice\nDatabase Product,DB-001,unit,10,100,140"
    }
  ];
}

function inferImportContentType(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop();

  switch (extension) {
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "sql":
      return "application/sql";
    default:
      return "text/plain";
  }
}

function contactPickerContactToCustomer(
  contact: ContactPickerContact
): Pick<CustomerFormState, "name" | "phone" | "email" | "notes"> | null {
  const name = contact.name?.[0]?.trim() ?? contact.tel?.[0]?.trim() ?? contact.email?.[0]?.trim();

  if (name === undefined || name.length === 0) {
    return null;
  }

  return {
    name,
    phone: contact.tel?.[0] ?? "",
    email: contact.email?.[0] ?? "",
    notes: "Imported from device contacts"
  };
}

function contactPickerContactToNetworkContact(contact: ContactPickerContact): {
  name: string;
  phone: string | null;
  email: string | null;
} | null {
  const name = contact.name?.[0]?.trim() ?? contact.tel?.[0]?.trim() ?? contact.email?.[0]?.trim();

  if (name === undefined || name.length === 0) {
    return null;
  }

  return {
    name,
    phone: contact.tel?.[0]?.trim() || null,
    email: contact.email?.[0]?.trim() || null
  };
}

function getContactDisplayName(contact: ContactPickerContact): string {
  return (
    contact.name?.[0]?.trim() ??
    contact.tel?.[0]?.trim() ??
    contact.email?.[0]?.trim() ??
    "Unnamed contact"
  );
}

function parseContactImportContent(
  content: string
): Array<Pick<CustomerFormState, "name" | "phone" | "email" | "notes">> {
  if (/BEGIN:VCARD/i.test(content)) {
    return content
      .split(/END:VCARD/i)
      .map((card) => ({
        name: extractVcardValue(card, "FN") || extractVcardValue(card, "N"),
        phone: extractVcardValue(card, "TEL"),
        email: extractVcardValue(card, "EMAIL"),
        notes: "Imported from vCard"
      }))
      .filter((record) => record.name.trim().length > 0);
  }

  const rows = content
    .split(/\r?\n/)
    .map((line) => line.split(/,|\t/).map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell.length > 0));
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow ?? []).map((header) => normalizeSearchText(header));

  return dataRows
    .map((row) => ({
      name: getContactCell(row, headers, ["name", "customer", "fullname"]) ?? row[0] ?? "",
      phone: getContactCell(row, headers, ["phone", "mobile", "tel"]) ?? row[1] ?? "",
      email: getContactCell(row, headers, ["email", "mail"]) ?? row[2] ?? "",
      notes: getContactCell(row, headers, ["notes", "note"]) ?? "Imported from contact file"
    }))
    .filter((record) => record.name.trim().length > 0);
}

function extractVcardValue(card: string, field: string): string {
  const match = card.match(new RegExp(`^${field}(?:;[^:]*)?:(.*)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function getContactCell(row: string[], headers: string[], names: string[]): string | undefined {
  const index = headers.findIndex((header) => names.includes(header));
  return index === -1 ? undefined : row[index];
}

function createContactsCsv(customers: CustomerSummary[]): string {
  const rows = [
    ["name", "phone", "email", "notes"],
    ...customers.map((customer) => [
      customer.name,
      customer.phone ?? "",
      customer.email ?? "",
      customer.notes ?? ""
    ])
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function createPhoneNetworkSeed(customers: CustomerSummary[]) {
  return customers.slice(0, 12).map((customer, index) => ({
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    connections: [
      {
        name: `${customer.name.split(" ")[0] || "Customer"} supplier ${index + 1}`
      }
    ]
  }));
}

function isNetworkDiscoveryRequest(message: string): boolean {
  const normalized = normalizeSearchText(message);
  return (
    normalized.includes("through my network") ||
    normalized.includes("connected to") ||
    normalized.includes("contacts who") ||
    normalized.includes("friends know") ||
    normalized.includes("my network") ||
    (normalized.includes("find") && normalized.includes("supplier"))
  );
}

function createSupplierChatReply(
  message: string,
  suppliers: SupplierBusinessCardSummary[]
): { body: string; view: ShellView } | null {
  const normalized = normalizeSearchText(message);

  if (normalized.includes("upload") && normalized.includes("receipt")) {
    return {
      view: "suppliers",
      body: "Open Suppliers, choose a supplier card, then tap Upload receipt. I will extract supplier, sales agent, items, quantities, prices, date, and total; after confirmation the receipt image is not stored."
    };
  }

  if (normalized.includes("add") && normalized.includes("supplier")) {
    return {
      view: "suppliers",
      body: "Opening Suppliers. Add the supplier name, phone, email, notes, or create one from a linked phone contact."
    };
  }

  if (normalized.includes("sales agent") || normalized.includes("sales agents")) {
    const supplier = suppliers.find((item) =>
      normalized.includes(
        item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
      )
    );

    if (supplier !== undefined) {
      return {
        view: "suppliers",
        body:
          supplier.salesAgents.length === 0
            ? `${supplier.name} has no linked sales agents yet.`
            : [
                `${supplier.name} sales agents:`,
                ...supplier.salesAgents.map(
                  (agent) =>
                    `- ${agent.name}: ${agent.phone ?? "no phone"}, receipts ${agent.receiptsHandled}`
                )
              ].join("\n")
      };
    }
  }

  if (
    normalized.includes("show my suppliers") ||
    normalized === "suppliers" ||
    (normalized.includes("which supplier") && normalized.includes("sold"))
  ) {
    return {
      view: "suppliers",
      body:
        suppliers.length === 0
          ? "No suppliers yet. Add one manually, create one from a phone contact, or upload a purchase receipt."
          : [
              "Supplier cards:",
              ...suppliers.map(
                (supplier) =>
                  `- ${supplier.name}: ${supplier.phone ?? "no phone"}, agents ${supplier.salesAgentCount}, receipts ${supplier.purchaseReceiptCount}, last purchase ${
                    supplier.lastPurchaseDate === null
                      ? "none"
                      : new Date(supplier.lastPurchaseDate).toLocaleDateString()
                  }`
              )
            ].join("\n")
    };
  }

  return null;
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function viewLabel(view: ShellView): string {
  const action = quickActions.find((item) => item.id === view);
  return action?.label ?? "Business home";
}

type AgentRuntimeDecision =
  | {
      kind: "act";
      matchedCustomer: CustomerSummary | null;
      matchedProduct: ProductSummary | null;
      response: string;
      result: ParseResult;
    }
  | {
      kind: "options" | "resubmit";
      response: string;
    };

function createAgentRuntimeProfile(agent: AgentSettings): AgentRuntimeProfile {
  return {
    behavior: agent.personality,
    contextScripts: sanitizeContextScripts(agent.contextScripts),
    integrations: agent.integrations,
    knowledge: agent.knowledge,
    model: agent.model,
    role: agent.role,
    instructions: agent.instructions,
    tools: agent.tools
  };
}

function createAgentRuntimeDecision(input: {
  agent: AgentSettings;
  clarificationCount: number;
  customers: CustomerSummary[];
  customerDebts: CustomerDebtSummary[];
  invoices: InvoiceSummary[];
  message: string;
  products: ProductSummary[];
}): AgentRuntimeDecision {
  const scriptedResult = resolveContextScriptCommand(input.agent.contextScripts, input.message);
  const parserResult = scriptedResult ?? parseMerchantCommand(input.message);
  const matchedProduct = findBestMenuProduct(input.message, input.products);
  const matchedCustomer = findBestCustomer(input.message, input.customers);
  const menuResult =
    parserResult.intent === "unknown" && matchedProduct !== null && hasUseVerb(input.message)
      ? createMenuInvoiceResult(input.message, matchedProduct, matchedCustomer)
      : parserResult;
  const confidence =
    scriptedResult === null
      ? getAgentConfidence({
          matchedCustomer,
          matchedProduct,
          message: input.message,
          result: menuResult
        })
      : 0.95;

  if (scriptedResult !== null && menuResult.nextAction.type === "clarify") {
    return {
      kind: "options",
      response:
        "The matching context script needs more detail. Resend the task with the missing product, customer, invoice, or amount."
    };
  }

  if (confidence >= 0.75 && menuResult.nextAction.type !== "clarify") {
    return {
      kind: "act",
      matchedCustomer,
      matchedProduct,
      response: createAgentActionReply({
        agent: input.agent,
        customer: matchedCustomer,
        product: matchedProduct,
        result: menuResult
      }),
      result: menuResult
    };
  }

  if (confidence >= 0.5 || input.clarificationCount === 0) {
    return {
      kind: "options",
      response: createAgentOptionsReply({
        customers: input.customers,
        customerDebts: input.customerDebts,
        invoices: input.invoices,
        matchedCustomer,
        matchedProduct,
        products: input.products,
        result: menuResult
      })
    };
  }

  return {
    kind: "resubmit",
    response:
      "Please resend the task with the action and item name together, for example: show products, create invoice for Mary with Sugar, or record payment 500 for invoice INV-001."
  };
}

function resolveContextScriptCommand(
  contextScripts: string[],
  message: string
): ParseResult | null {
  const match = parseProductContextScriptCommand({
    message,
    contextScripts,
    tenantId: "local-agent"
  });

  return match === null ? null : productContextScriptMatchToParseResult(match);
}

function getAgentConfidence(input: {
  matchedCustomer: CustomerSummary | null;
  matchedProduct: ProductSummary | null;
  message: string;
  result: ParseResult;
}): number {
  if (input.result.intent !== "unknown" && input.result.nextAction.type !== "clarify") {
    return Math.max(input.result.confidence, 0.76);
  }

  if (input.matchedProduct !== null && hasUseVerb(input.message)) {
    return 0.82;
  }

  if (input.matchedProduct !== null || input.matchedCustomer !== null) {
    return 0.55;
  }

  if (input.result.intent !== "unknown") {
    return 0.5;
  }

  return input.result.confidence;
}

function createAgentActionReply(input: {
  agent: AgentSettings;
  customer: CustomerSummary | null;
  product: ProductSummary | null;
  result: ParseResult;
}): string {
  const agentLabel = formatAgentDisplayName(input.agent);

  if (input.result.nextAction.type === "navigate") {
    return `${agentLabel} opened ${viewLabel(input.result.nextAction.view)}.`;
  }

  if (input.result.intent === "add_product") {
    return `${agentLabel} prepared a product draft. Review it, then save it.`;
  }

  if (input.result.intent === "add_customer") {
    return `${agentLabel} prepared a customer draft. Review it, then save it.`;
  }

  if (input.result.intent === "create_invoice") {
    const productText = input.product === null ? "" : ` with ${input.product.name}`;
    const customerText = input.customer === null ? "" : ` for ${input.customer.name}`;
    return `${agentLabel} opened an invoice draft${customerText}${productText}. Review it before saving or confirming.`;
  }

  if (input.result.intent === "record_payment") {
    return `${agentLabel} opened the payment form with the details it could match. Review it before recording payment.`;
  }

  if (input.result.intent === "check_debt") {
    return `${agentLabel} opened payments and debt records.`;
  }

  return `${agentLabel} prepared the matching workspace action.`;
}

function createAgentOptionsReply(input: {
  customers: CustomerSummary[];
  customerDebts: CustomerDebtSummary[];
  invoices: InvoiceSummary[];
  matchedCustomer: CustomerSummary | null;
  matchedProduct: ProductSummary | null;
  products: ProductSummary[];
  result: ParseResult;
}): string {
  const options = buildAgentOptions(input);

  if (input.result.nextAction.type === "clarify" && input.result.intent !== "unknown") {
    return `${input.result.nextAction.question} Resend the task with that detail included.`;
  }

  return `I found a few possible matches. Resend the task with one option: ${options.join("; ")}.`;
}

function buildAgentOptions(input: {
  customers: CustomerSummary[];
  customerDebts: CustomerDebtSummary[];
  invoices: InvoiceSummary[];
  matchedCustomer: CustomerSummary | null;
  matchedProduct: ProductSummary | null;
  products: ProductSummary[];
}): string[] {
  const options = [
    input.matchedProduct === null ? null : `use product ${input.matchedProduct.name}`,
    input.matchedCustomer === null ? null : `use customer ${input.matchedCustomer.name}`,
    input.products.length > 0 ? "show products" : null,
    input.customers.length > 0 ? "show customers" : null,
    input.invoices.length > 0 ? "show invoices" : null,
    input.customerDebts.length > 0 ? "check customer debt" : null
  ].filter((option): option is string => option !== null);

  return options.length === 0
    ? ["show products", "create invoice for a customer", "record payment for an invoice"]
    : options.slice(0, 4);
}

function createMenuInvoiceResult(
  message: string,
  product: ProductSummary,
  customer: CustomerSummary | null
): ParseResult {
  const slots: ParseResult["slots"] = {
    productName: product.name,
    quantity: extractFirstNumber(message) ?? 1,
    unit: product.unit
  };

  if (customer !== null) {
    slots.customerName = customer.name;
  }

  return {
    confidence: 0.82,
    intent: "create_invoice",
    nextAction: {
      type: "draft",
      reason: "Matched a requested menu item to an invoice draft."
    },
    normalizedInput: normalizeSearchText(message),
    slots
  };
}

function findInvoiceForPayment(
  invoices: InvoiceSummary[],
  customer: CustomerSummary | null
): InvoiceSummary | null {
  const candidates =
    customer === null
      ? invoices
      : invoices.filter(
          (invoice) =>
            invoice.customerId === customer.id ||
            normalizeSearchText(invoice.customerName ?? "") === normalizeSearchText(customer.name)
        );
  return candidates.find((invoice) => invoice.status !== "confirmed") ?? candidates[0] ?? null;
}

function findBestMenuProduct(message: string, products: ProductSummary[]): ProductSummary | null {
  return findBestByName(message, products, (product) =>
    [product.name, product.sku ?? "", product.unit].join(" ")
  );
}

function findBestPublicProduct(
  message: string,
  products: PublicStorefrontProductSummary[]
): PublicStorefrontProductSummary | null {
  return findBestByName(message, products, (product) => [product.name, product.unit].join(" "));
}

function findBestCustomer(message: string, customers: CustomerSummary[]): CustomerSummary | null {
  return findBestByName(message, customers, (customer) =>
    [customer.name, customer.phone ?? "", customer.email ?? ""].join(" ")
  );
}

function findBestByName<TItem>(
  message: string,
  items: TItem[],
  getSearchText: (item: TItem) => string
): TItem | null {
  const messageTokens = new Set(tokenizeSearchText(message));
  let best: { item: TItem; score: number } | null = null;

  for (const item of items) {
    const itemTokens = tokenizeSearchText(getSearchText(item));
    if (itemTokens.length === 0) {
      continue;
    }

    const score = itemTokens.filter((token) => messageTokens.has(token)).length / itemTokens.length;

    if (score > 0 && (best === null || score > best.score)) {
      best = { item, score };
    }
  }

  return best !== null && best.score >= 0.34 ? best.item : null;
}

function hasUseVerb(message: string): boolean {
  const tokens = new Set(tokenizeSearchText(message));
  return ["add", "buy", "get", "invoice", "need", "order", "sell", "take", "use", "want"].some(
    (verb) => tokens.has(verb)
  );
}

function extractFirstNumber(message: string): number | undefined {
  const match = message.match(/\b\d+(?:\.\d+)?\b/);

  if (match === null) {
    return undefined;
  }

  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function formatAgentDisplayName(agent: AgentSettings): string {
  return agent.name.trim().length === 0 ? "Your agent" : agent.name.trim();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    currency: "KES",
    style: "currency"
  }).format(value);
}

function formatOptionalMoney(value: number | null): string {
  return value === null ? "not set" : formatMoney(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium"
  }).format(new Date(value));
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element not found.");
}

console.info(`[${buildIdentity.appName}] frontend boot`, {
  apiBaseUrl: buildIdentity.apiBaseUrl,
  appName: buildIdentity.appName,
  buildTimestamp: buildIdentity.buildTimestamp,
  commitSha: buildIdentity.commitSha,
  environment: buildIdentity.environment,
  url: window.location.href,
  version: buildIdentity.version
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
