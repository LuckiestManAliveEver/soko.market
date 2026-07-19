export type RuntimeName = "api" | "sync" | "ai-runtime" | "web";

export interface HealthResponse {
  service: RuntimeName;
  status: "ok";
  timestamp: string;
}

export interface EnvironmentConfig {
  apiHost: string;
  apiPort: number;
  allowedCorsOrigins: string[];
  databaseUrl: string;
  localModelEnabled: boolean;
  localModelEndpoint: string;
  localModelId: string;
  localModelMaxTokens: number;
  localModelProvider: "llama.cpp" | "ollama";
  localModelProfile: string;
  localModelTemperature: number;
  localModelTimeoutMs: number;
  redisUrl: string;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  reason: string;
}

export type AuthChannel = "email" | "phone";

export type OAuthProvider =
  "google" | "facebook" | "apple" | "github" | "microsoft" | "linkedin" | "x" | "tiktok";

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
  phoneNumberE164?: string | null;
  phoneCountryCode?: string | null;
  phoneNationalNumber?: string | null;
  phoneVerificationStatus?: "unverified" | null;
  phoneAddedAt?: string | null;
  phoneUpdatedAt?: string | null;
  phoneSource?: "phone_login" | "shop_registration" | null;
  publicPhoneEnabled?: boolean;
}

export interface BusinessSummary {
  id: string;
  name: string;
  language: SupportedLanguage;
  sokoId: string;
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

export interface PasskeySummary {
  id: string;
  label: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export type SokoMode = "marketplace" | "seller";

export type SokoChatSurface =
  "conversation" | "storefront" | "catalogue" | "product" | "order" | "receipt" | "owner-controls";

export type ConversationKind = "personal" | "storefront" | "order";

export type ConversationParticipantRole = "account" | "shop" | "agent";

export type ConversationMessageAuthor = "user" | "agent" | "system";

export type MessageChannel =
  | "soko"
  | "sms"
  | "mms"
  | "rcs_business"
  | "whatsapp_business"
  | "telegram"
  | "facebook_messenger"
  | "instagram_messaging"
  | "email";

export type MessageComposerChannel = "soko" | "sms_external_app" | "sms_native" | "unsupported";

export type MessageHandoffStatus =
  | "preparing"
  | "composer_opened"
  | "no_sms_app"
  | "invalid_recipient"
  | "cancelled_before_handoff"
  | "native_bridge_unavailable"
  | "unsupported";

export interface MessageHandoffSummary {
  id: string;
  accountId: string;
  businessId: string | null;
  conversationId: string | null;
  channel: "sms_external_app";
  status: MessageHandoffStatus;
  normalizedErrorCode: string | null;
  createdAt: string;
}

export type ConversationMessageDeliveryStatus =
  | "draft"
  | "queued"
  | "sending"
  | "retrying"
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type MessageDeliveryAttemptResult = "succeeded" | "transient_failure" | "permanent_failure";

export interface ConversationAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  category: "document" | "image" | "video" | "audio" | "other";
  /** A data URL for small offline-first attachments or an HTTPS object-storage URL. */
  url: string;
}

export interface ConversationReaction {
  emoji: string;
  actorId: string;
  createdAt: string;
}

export interface E2eePublicKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
}

export interface E2eeDeviceSummary {
  id: string;
  accountId: string;
  label: string;
  publicKey: E2eePublicKey;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface EncryptedMessageEnvelope {
  version: 1;
  algorithm: "ECDH-P256-HKDF-SHA256-AES-256-GCM";
  recipientDeviceId: string;
  ephemeralPublicKey: E2eePublicKey;
  salt: string;
  iv: string;
  ciphertext: string;
}

export type ConversationMessageContent =
  | { type: "text"; text: string; attachments?: ConversationAttachment[] }
  | {
      type: "encrypted";
      envelopes: EncryptedMessageEnvelope[];
      attachmentCount: number;
      iv: string;
      ciphertext: string;
    }
  | { type: "storefront"; shopId: string }
  | { type: "owner-controls"; shopId: string }
  | { type: "confirmation"; confirmationToken: string; prompt: string };

export interface AccountShopSummary {
  business: BusinessSummary;
  membership: MembershipSummary;
}

export interface ConversationParticipantSummary {
  id: string;
  conversationId: string;
  role: ConversationParticipantRole;
  accountId: string | null;
  businessId: string | null;
  agentId: string | null;
  displayName?: string | null;
  lastReadAt?: string | null;
  archivedAt?: string | null;
  mutedUntil?: string | null;
  pinnedAt?: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  accountId: string;
  kind: ConversationKind;
  activeShopId: string | null;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageSummary {
  id: string;
  conversationId: string;
  clientMessageId: string;
  idempotencyKey: string;
  author: ConversationMessageAuthor;
  authorId: string;
  content: ConversationMessageContent;
  status?: ConversationMessageDeliveryStatus;
  queuedAt?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  failureCode?: string | null;
  retryCount?: number;
  nextRetryAt?: string | null;
  selectedChannel?: MessageChannel;
  actualChannel?: MessageChannel | null;
  providerMessageId?: string | null;
  importedSource?: string | null;
  importedExternalId?: string | null;
  consentRecordId?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  reactions?: ConversationReaction[];
  clientTimestamp: string | null;
  createdAt: string;
}

export interface MessageDeliveryAttemptSummary {
  id: string;
  accountId: string;
  conversationId: string;
  messageId: string;
  channel: MessageChannel;
  provider: string;
  attemptNumber: number;
  requestedAt: string;
  respondedAt: string | null;
  result: MessageDeliveryAttemptResult;
  normalizedFailureCode: string | null;
  providerResponseReference: string | null;
}

export interface ConversationInboxItem extends ConversationSummary {
  lastMessage: ConversationMessageSummary | null;
  unreadCount: number;
  participant: ConversationParticipantSummary;
}

export interface ConversationTypingSummary {
  actorId: string;
  displayName: string;
  expiresAt: string;
}

export interface ConversationView {
  conversation: ConversationSummary;
  participants: ConversationParticipantSummary[];
  messages: ConversationMessageSummary[];
  typing?: ConversationTypingSummary[];
}

export interface PushSubscriptionSummary {
  id: string;
  accountId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { auth: string; p256dh: string };
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceIntroStateSummary {
  accountId: string;
  userId: string;
  businessId: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface AiModelSummary {
  id: string;
  label: string;
  provider: "local" | "openai";
  description: string;
  capabilities: string[];
  available: boolean;
  source: "huggingface" | "github" | "builtin" | "hosted";
  format: "GGUF" | "remote";
  license: string | null;
  licenseUrl: string | null;
  modelCardUrl: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  minimumMemoryGb: number | null;
  recommended: boolean;
}

export interface ActiveAiModelSummary {
  businessId: string;
  modelId: string;
  activatedAt: string;
  activatedBy: string;
}

export interface SokoSessionContext {
  accountId: string;
  userId: string;
  sessionId: string;
  conversationId: string;
  activeShopId: string | null;
  agentId: string;
  activeModelId: string;
  mode: SokoMode;
  activeSurface: SokoChatSurface;
  permissions: string[];
  sessionVersion: number;
  shops: AccountShopSummary[];
}

export interface StoredSokoSessionContext {
  sessionId: string;
  conversationId: string;
  activeShopId: string | null;
  activeModelId: string;
  mode: SokoMode;
  activeSurface: SokoChatSurface;
  sessionVersion: number;
  updatedAt: string;
}

export interface IdentityProviderSummary {
  id: OAuthProvider;
  displayName: string;
  icon?: string;
  authorizationUrl: string;
  callbackPath?: string;
  tokenUrl: string;
  userInfoUrl: string | null;
  scopes: string[];
  enabled?: boolean;
  pkce: boolean;
}

export interface UserIdentitySummary {
  id: string;
  accountId: string;
  userId: string;
  provider: OAuthProvider;
  providerSubject: string;
  email: string | null;
  displayName: string | null;
  linkedAt: string;
}

export interface OAuthSessionSummary {
  id: string;
  provider: OAuthProvider;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface ProductSummary {
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

export type ProductFieldInputType = "text" | "number" | "select" | "textarea" | "yes_no";

export interface ProductFieldDefinition {
  id: string;
  label: string;
  inputType: ProductFieldInputType;
  required: boolean;
}

export interface ProductFieldSchemaSummary {
  businessId: string;
  fields: ProductFieldDefinition[];
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

export type NetworkSyncSourceType = "phone_contact" | "social";

export type NetworkEdgeSourceType =
  "phone_contact" | "social_follow" | "social_interaction" | "imported_contact" | "agent_route";

export type NetworkVisibilityStatus = "direct" | "agent_mediated" | "private";

export type NetworkConsentStatus =
  "granted" | "pending" | "agent_required" | "rejected" | "revoked";

export type NetworkNodeKind = "soko_user" | "soko_shop" | "external_contact" | "external_social";

export type SocialNetworkProvider =
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "tiktok"
  | "x"
  | "linkedin"
  | "google"
  | "microsoft"
  | "github"
  | "apple";

export interface ContactHashSummary {
  id: string;
  ownerUserId: string;
  hashType: "phone" | "email" | "social";
  hashValue: string;
  displayHint: string | null;
  createdAt: string;
}

export interface ExternalIdentitySummary {
  id: string;
  ownerUserId: string;
  provider: string;
  providerSubjectHash: string;
  displayName: string;
  handle: string | null;
  createdAt: string;
}

export interface SokoIdentityLinkSummary {
  id: string;
  ownerUserId: string;
  nodeId: string;
  linkedUserId: string | null;
  linkedBusinessId: string | null;
  linkedAgentId: string | null;
  confidence: number;
  createdAt: string;
}

export interface NetworkNodeSummary {
  id: string;
  ownerUserId: string;
  kind: NetworkNodeKind;
  displayName: string;
  degree: 0 | 1 | 2;
  sourceId: string | null;
  sourceType: NetworkSyncSourceType | "owner";
  sourcePlatform: string | null;
  sokoUserId: string | null;
  sokoBusinessId: string | null;
  sokoAgentId: string | null;
  contactHashIds: string[];
  externalIdentityId: string | null;
  visibilityStatus: NetworkVisibilityStatus;
  consentStatus: NetworkConsentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkEdgeSummary {
  id: string;
  ownerUserId: string;
  sourceType: NetworkEdgeSourceType;
  sourcePlatform: string | null;
  fromNodeId: string;
  toNodeId: string;
  degree: 1 | 2;
  trustWeight: number;
  interactionWeight: number;
  visibilityStatus: NetworkVisibilityStatus;
  consentStatus: NetworkConsentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ContactSyncSourceSummary {
  id: string;
  ownerUserId: string;
  sourceType: "phone_contact";
  sourcePlatform: "phone";
  displayName: string;
  importedCount: number;
  directCount: number;
  extendedCount: number;
  status: "active" | "disconnected";
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
}

export interface SocialSyncSourceSummary {
  id: string;
  ownerUserId: string;
  sourceType: "social";
  sourcePlatform: SocialNetworkProvider;
  displayName: string;
  importedCount: number;
  directCount: number;
  extendedCount: number;
  status: "active" | "disconnected";
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
}

export type NetworkSyncSourceSummary = ContactSyncSourceSummary | SocialSyncSourceSummary;

export interface NetworkPermissionSummary {
  id: string;
  ownerUserId: string;
  routeId: string;
  fromNodeId: string;
  toNodeId: string;
  status: NetworkConsentStatus;
  createdAt: string;
  updatedAt: string;
}

export type AgentRouteStatus =
  "pending_permission" | "forwarded" | "suggested" | "blocked" | "approved" | "rejected";

export interface AgentRouteSummary {
  id: string;
  ownerUserId: string;
  requestText: string;
  status: AgentRouteStatus;
  directNodeId: string;
  targetNodeId: string;
  viaAgentLabel: string;
  path: string[];
  permissionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkGraphSummary {
  ownerUserId: string;
  generatedAt: string;
  nodes: NetworkNodeSummary[];
  edges: NetworkEdgeSummary[];
  sources: NetworkSyncSourceSummary[];
  routes: AgentRouteSummary[];
  permissions: NetworkPermissionSummary[];
  identityLinks: SokoIdentityLinkSummary[];
}

export interface SupplierSummary {
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

export interface SalesAgentSummary {
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

export type SupplierContactLinkType = "supplier" | "sales_agent";

export interface SupplierContactLinkSummary {
  id: string;
  businessId: string;
  linkType: SupplierContactLinkType;
  supplierId: string | null;
  salesAgentId: string | null;
  networkNodeId: string;
  contactName: string;
  linkedAt: string;
}

export interface ReceiptLineItemSummary {
  id: string;
  receiptId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PurchaseReceiptSummary {
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

export type ReceiptOCREngine = "paddleocr" | "tesseract";
export type ReceiptOCRProfile = "mobile" | "balanced" | "accurate";

export type ReceiptOCRJobStatus =
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

export interface ReceiptOCRBlockSummary {
  id: string;
  page: number;
  text: string;
  confidence: number;
  boundingBox: Array<{ x: number; y: number }> | null;
}

export interface ReceiptFieldEvidenceSummary {
  field: string;
  value: string | number | null;
  confidence: number;
  sourceText: string | null;
}

export interface ReceiptMatchCandidateSummary {
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

export interface ReceiptStructuredExtractionSummary {
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
}

export interface ReceiptContactEntityMatchSummary {
  extractedName: string | null;
  extractedPhone: string | null;
  extractedEmail: string | null;
  selectedRecordId: string | null;
  selectedContactId: string | null;
  confidence: number;
  matchedBy: string[];
  sources: string[];
  requiresConfirmation: boolean;
  candidates: ReceiptMatchCandidateSummary[];
}

export interface ReceiptContactMatchingResultSummary {
  matched: boolean;
  scriptId: "receipt_contact_matching";
  intent: "RECEIPT_CONTACT_MATCH";
  source: "context_script";
  ocrJobId: string;
  supplier: ReceiptContactEntityMatchSummary;
  salesAgent: ReceiptContactEntityMatchSummary;
  unmatchedFields: string[];
  warnings: string[];
  thresholds: {
    autoSelect: number;
    confirmationRequired: number;
    rejectBelow: number;
  };
}

export interface ReceiptOCRJobSummary {
  id: string;
  businessId: string;
  tenantId: string;
  shopId: string;
  uploadedBy: string;
  status: ReceiptOCRJobStatus;
  sourceFileName: string;
  contentType: string;
  engine: ReceiptOCREngine;
  engineVersion: string;
  modelVersion: string;
  profile: ReceiptOCRProfile;
  fallbackUsed: boolean;
  languageHints: string[];
  blocks: ReceiptOCRBlockSummary[];
  fullText: string;
  averageConfidence: number;
  warnings: string[];
  fieldEvidence: ReceiptFieldEvidenceSummary[];
  structuredExtraction: ReceiptStructuredExtractionSummary;
  contactMatchingResult: ReceiptContactMatchingResultSummary;
  supplierCandidates: ReceiptMatchCandidateSummary[];
  salesAgentCandidates: ReceiptMatchCandidateSummary[];
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

export interface SupplierBusinessCardSummary extends SupplierSummary {
  salesAgents: SalesAgentSummary[];
  purchaseReceipts: PurchaseReceiptSummary[];
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

export type DataExportStatus = "ready";

export interface DataExportBundleSummary {
  id: string;
  businessId: string;
  accountId: string;
  actorId: string;
  status: DataExportStatus;
  recordCounts: Record<string, number>;
  checksum: string;
  createdAt: string;
}

export interface DataExportBundle extends DataExportBundleSummary {
  data: {
    account: AccountSummary;
    user: UserSummary;
    business: BusinessSummary;
    memberships: MembershipSummary[];
    products: ProductSummary[];
    customers: CustomerSummary[];
    suppliers: SupplierSummary[];
    invoices: InvoiceSummary[];
    payments: PaymentSummary[];
    logistics: LogisticsSummary[];
    documentImports: DocumentImportJobSummary[];
    notifications: BusinessNotificationSummary[];
    inventoryMovements: InventoryMovementSummary[];
    auditEvents: Array<{
      id: string;
      type: string;
      aggregateType: string;
      aggregateId: string;
      actorId: string;
      occurredAt: string;
      risk: string;
    }>;
  };
}

export type AccountDeletionStatus =
  | "scheduled"
  | "PENDING_VERIFICATION"
  | "VERIFIED"
  | "QUEUED"
  | "RUNNING"
  | "QUARANTINED"
  | "RESTORED"
  | "PURGED"
  | "COMPLETED"
  | "PARTIALLY_FAILED"
  | "FAILED"
  | "CANCELLED";

export interface ComplianceRetentionSummary {
  businessId: string;
  retainedInvoiceCount: number;
  retainedPaymentCount: number;
  retainedLogisticsCount: number;
  retainedImportCount: number;
  retainedAuditEventCount: number;
  directIdentifierFieldsRemoved: number;
}

export interface AccountDeletionRequestSummary {
  id: string;
  accountId: string;
  userId: string;
  businessId: string;
  actorId: string;
  status: AccountDeletionStatus;
  reason: string | null;
  requestedAt: string;
  requestedByUserId?: string;
  reauthenticatedAt?: string | null;
  otpVerifiedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  failureReason?: string | null;
  auditReference?: string | null;
  idempotencyKey?: string | null;
  deactivatedAt: string;
  anonymizeAfter: string;
  retention: ComplianceRetentionSummary;
}

export type ShopPresenceStatus = "online" | "private" | "offline";

export interface ShopPresenceSummary {
  businessId: string;
  status: ShopPresenceStatus;
  updatedBy: string;
  updatedAt: string;
}

export type PublicShopPresenceSummary = Pick<ShopPresenceSummary, "status" | "updatedAt">;

export type NetworkInviteChannel = "phone" | "email";
export type NetworkInviteStatus = "queued" | "sent" | "failed";

export interface NetworkInviteSummary {
  id: string;
  businessId: string;
  invitedByUserId: string;
  contactName: string;
  channel: NetworkInviteChannel;
  destination: string;
  status: NetworkInviteStatus;
  createdAt: string;
  deliveredAt: string | null;
  failureReason: string | null;
}

export type PublicCustomerCareRequestType = "callback" | "quote" | "support" | "registration";

export interface PublicCustomerCareRequestSummary {
  id: string;
  businessId: string;
  type: PublicCustomerCareRequestType;
  customerName: string | null;
  phone: string | null;
  message: string | null;
  status: "new" | "acknowledged" | "closed";
  createdAt: string;
}

export interface PublicStorefrontMessageSummary {
  id: string;
  businessId: string;
  visitorId: string;
  author: "customer" | "agent";
  body: string;
  attachmentNames: string[];
  createdAt: string;
}

export interface PublicOrderItemSummary {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
}

export interface PublicOrderSummary {
  id: string;
  businessId: string;
  visitorId: string;
  customerName: string;
  phone: string;
  note: string | null;
  items: PublicOrderItemSummary[];
  status: "requested" | "accepted" | "rejected" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export type VerificationTier = "unverified" | "owner_verified" | "business_verified";

export interface VerificationTierSummary {
  businessId: string;
  tier: VerificationTier;
  evidenceType: "none" | "owner_attestation" | "business_document";
  note: string | null;
  updatedBy: string;
  updatedAt: string;
}

export type TaxCountryCode = "KE";

export interface CountryTaxConfigSummary {
  businessId: string;
  countryCode: TaxCountryCode;
  defaultTaxRate: number;
  taxIdLabel: string;
  taxId: string | null;
  pricesIncludeTax: boolean;
  updatedBy: string;
  updatedAt: string;
}

export type DeviceTrustLevel = "unknown" | "trusted" | "restricted";

export interface DeviceTrustSummary {
  businessId: string;
  userId: string;
  deviceId: string;
  level: DeviceTrustLevel;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
}

export type BetaAccessStatus = "not_invited" | "active" | "paused";

export interface BetaAccessSummary {
  businessId: string;
  status: BetaAccessStatus;
  targetMerchantCount: number;
  invitedMerchantCount: number;
  pauseReason: string | null;
  updatedBy: string;
  updatedAt: string;
}

export type BetaFeatureFlagKey =
  | "closed_beta"
  | "offline_hardening"
  | "controlled_payments"
  | "support_intake"
  | "crash_telemetry";

export type BetaFeatureFlagRisk = "low" | "medium" | "high";

export interface BetaFeatureFlagSummary {
  businessId: string;
  key: BetaFeatureFlagKey;
  enabled: boolean;
  risk: BetaFeatureFlagRisk;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}

export type BetaDeviceClass = "android_1gb" | "android_2gb";

export type BetaDeviceTestStatus = "passed" | "failed";

export interface BetaDeviceTestSummary {
  id: string;
  businessId: string;
  deviceClass: BetaDeviceClass;
  workflow: string;
  status: BetaDeviceTestStatus;
  durationMs: number;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

export type BetaSupportSeverity = "low" | "medium" | "high" | "critical";

export type BetaSupportTicketStatus = "open" | "triaged" | "resolved";

export interface BetaSupportTicketSummary {
  id: string;
  businessId: string;
  severity: BetaSupportSeverity;
  status: BetaSupportTicketStatus;
  title: string;
  bodySummary: string;
  source: "merchant" | "operator";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type BetaTelemetryKind = "session" | "crash" | "error";

export interface BetaTelemetryEventSummary {
  id: string;
  businessId: string;
  kind: BetaTelemetryKind;
  severity: "info" | "warning" | "critical";
  fingerprint: string;
  messageHash: string;
  boundedMetadata: Record<string, string | number | boolean | null>;
  occurredAt: string;
  recordedAt: string;
}

export type BetaReadinessStatus = "blocked" | "needs_review" | "ready";

export interface BetaReadinessReportSummary {
  businessId: string;
  generatedAt: string;
  status: BetaReadinessStatus;
  access: BetaAccessSummary;
  featureFlags: BetaFeatureFlagSummary[];
  deviceTesting: {
    requiredDeviceClasses: BetaDeviceClass[];
    passedDeviceClasses: BetaDeviceClass[];
    failedTestCount: number;
  };
  offline: {
    cachedRecordCount: number;
    betaCriticalSurfaceCount: number;
    testedSurfaceCount: number;
  };
  syncStress: {
    queuedMutationCount: number;
    syncedMutationCount: number;
    conflictCount: number;
    failedCount: number;
    ready: boolean;
  };
  payments: {
    paymentCount: number;
    partiallyPaidInvoiceCount: number;
    unpaidInvoiceCount: number;
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

export type LaunchAccessStatus = "closed" | "open" | "paused";

export interface LaunchSettingsSummary {
  businessId: string;
  status: LaunchAccessStatus;
  publicOnboardingEnabled: boolean;
  rollbackArmed: boolean;
  freezeActive: boolean;
  allowedSignupCount: number;
  pauseReason: string | null;
  updatedBy: string;
  updatedAt: string;
}

export type LaunchChecklistKey =
  | "environment_config"
  | "secrets_ready"
  | "backup_verified"
  | "monitoring_ready"
  | "deploy_verified"
  | "rollback_runbook"
  | "support_coverage";

export type LaunchChecklistStatus = "pending" | "passed" | "failed";

export interface LaunchChecklistItemSummary {
  businessId: string;
  key: LaunchChecklistKey;
  status: LaunchChecklistStatus;
  evidence: string;
  updatedBy: string;
  updatedAt: string;
}

export type LaunchIncidentSeverity = "low" | "medium" | "high" | "critical";

export type LaunchIncidentStatus = "open" | "mitigating" | "resolved";

export type LaunchIncidentCategory =
  "onboarding" | "payments" | "sync" | "support" | "telemetry" | "rollback";

export interface LaunchIncidentSummary {
  id: string;
  businessId: string;
  severity: LaunchIncidentSeverity;
  status: LaunchIncidentStatus;
  category: LaunchIncidentCategory;
  title: string;
  bodySummary: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type LaunchReadinessStatus = "blocked" | "needs_review" | "ready";

export interface LaunchReadinessReportSummary {
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

export interface SecurityReviewSummary {
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

export interface ComplianceReportSummary {
  exportCount: number;
  deletionRequestCount: number;
  scheduledAnonymizationCount: number;
  retainedRecordCount: number;
  verificationTier: VerificationTier;
  taxCountryCode: TaxCountryCode;
  deviceTrustLevel: DeviceTrustLevel;
  highRiskAuditEventCount: number;
}

export interface CustomerDebtSummary {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;
}

export type DocumentImportTarget = "supplier" | "product";

export type DocumentImportStatus = "previewed" | "confirmed" | "failed";

export interface DocumentImportSourceSummary {
  id: string;
  businessId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  sourceType?: "upload" | "paste" | "database";
  sourceLocator?: string | null;
  originalStorageKey?: string | null;
  createdAt: string;
}

export interface SupplierImportDraft {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface ProductImportDraft {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
}

export type DocumentImportDraft = SupplierImportDraft | ProductImportDraft;

export interface DocumentImportPreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: DocumentImportDraft;
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
  fieldMapping: Record<string, keyof SupplierImportDraft | keyof ProductImportDraft>;
  rows: DocumentImportPreviewRow[];
  confirmedCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface DocumentImportConfirmResult {
  job: DocumentImportJobSummary;
  suppliers?: SupplierSummary[];
  products?: ProductSummary[];
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

export const ACCOUNT_SYNC_COLLECTIONS = [
  "session_context",
  "shops",
  "conversations",
  "conversation_messages",
  "conversation_participants",
  "conversation_typing"
] as const;

export type AccountSyncCollection = (typeof ACCOUNT_SYNC_COLLECTIONS)[number];
export type SyncCollection = AccountSyncCollection;

const accountSyncCollectionSet = new Set<string>(ACCOUNT_SYNC_COLLECTIONS);

export function isAccountSyncCollection(value: unknown): value is AccountSyncCollection {
  return typeof value === "string" && accountSyncCollectionSet.has(value);
}

export type SyncChangeOperation = "upsert" | "delete";

export interface SyncChange<T = unknown> {
  accountId: string;
  collection: SyncCollection;
  entityId: string;
  operation: SyncChangeOperation;
  sequence: number;
  cursor: string;
  shopId: string | null;
  entity: T | null;
  changedAt: string;
  tombstoneExpiresAt: string | null;
}

export interface SyncPullRequest {
  cursor: string | null;
  limit?: number;
}

export interface SyncPullPage<T = unknown> {
  accountId: string;
  fromCursor: string | null;
  nextCursor: string;
  changes: SyncChange<T>[];
  hasMore: boolean;
  serverTime: string;
}

export interface SyncRealtimeReadyEvent {
  type: "realtime.ready";
  protocolVersion: 1;
  accountId: string;
  serverTime: string;
}

export interface SyncRealtimeChangesAvailableEvent {
  type: "sync.changes_available";
  protocolVersion: 1;
  accountId: string;
  cursor: string;
  sequence: number;
  collection: SyncCollection;
  emittedAt: string;
}

export type SyncRealtimeEvent = SyncRealtimeReadyEvent | SyncRealtimeChangesAvailableEvent;

export type McpAccessScope = "mcp:read" | "mcp:act";

export interface McpAccessTokenSummary {
  id: string;
  accountId: string;
  name: string;
  scopes: McpAccessScope[];
  shopId: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface McpAccessTokenCreated {
  accessToken: string;
  token: McpAccessTokenSummary;
}

export interface McpPrincipal {
  tokenId: string;
  accountId: string;
  userId: string;
  sessionId: string;
  scopes: McpAccessScope[];
  shopId: string | null;
  expiresAt: string;
}

export interface LocalSyncRecord<T = unknown> {
  accountId: string;
  collection: SyncCollection;
  entityId: string;
  sequence: number;
  cursor: string;
  shopId: string | null;
  entity: T | null;
  changedAt: string;
  deletedAt: string | null;
  tombstoneExpiresAt: string | null;
}

export interface LocalSyncSnapshot<T = unknown> {
  accountId: string;
  cursor: string | null;
  records: LocalSyncRecord<T>[];
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
  buyingPrice?: number | null;
  sellingPrice?: number | null;
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

export interface LocalSyncMutation extends SyncQueueItem {
  accountId: string;
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
  compliance: ComplianceReportSummary;
  beta: BetaReadinessReportSummary;
  launch: LaunchReadinessReportSummary;
  sync: SyncHealthReportSummary;
}

export type BusinessNotificationType =
  | "low_stock"
  | "open_debt"
  | "sync_conflict"
  | "import_failed"
  | "fulfillment_pending"
  | "beta_readiness"
  | "launch_readiness"
  | "security_event"
  | "shop_deletion";

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
    | "report"
    | "product"
    | "customer_debt"
    | "sync_queue"
    | "document_import"
    | "logistics"
    | "beta_readiness"
    | "launch_readiness"
    | "security"
    | "shop_deletion";
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
    | "compliance"
    | "beta"
    | "launch"
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
  | "product.update"
  | "product.delete"
  | "product.stock_adjust"
  | "product.field.add"
  | "product.field.remove"
  | "customer.create"
  | "invoice.draft"
  | "payment.record"
  | "receipt.scan"
  | "receipt.review"
  | "receipt.confirm"
  | "receipt.correct"
  | "receipt.cancel"
  | "receipt.lookup"
  | "receipt.list"
  | "document_import.confirm"
  | "unknown.clarify";

export type RuntimeParserIntent =
  | "add_product"
  | "add_customer"
  | "create_invoice"
  | "record_payment"
  | "check_debt"
  | "show_products"
  | "show_invoices"
  | "confirm_document_import"
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
  complianceExportCount: number;
  scheduledDeletionCount: number;
  verificationTier: VerificationTier;
  deviceTrustLevel: DeviceTrustLevel;
  betaAccessStatus: BetaAccessStatus;
  betaReadinessStatus: BetaReadinessStatus;
  openSupportTicketCount: number;
  crashFreeSessionRate: number;
  publicLaunchStatus: LaunchAccessStatus;
  launchReadinessStatus: LaunchReadinessStatus;
  openLaunchIncidentCount: number;
  lowStockCount: number;
  outstandingDebtTotal: number;
  unreadNotificationCount: number;
  knowledgeFactCount: number;
}

export type RuntimeModelProviderName = "llama.cpp" | "ollama" | "openai" | "test";

export type RuntimeModelAdapterStatus =
  "disabled" | "available" | "unavailable" | "timeout" | "malformed" | "error";

export interface RuntimeModelPrompt {
  message: string;
  conversationHistory?: RuntimeModelConversationMessage[];
  context: RuntimeContextSummary;
  allowedTools: RuntimeToolName[];
  schemaVersion: "cp11-runtime-model-v1";
}

export interface RuntimeModelConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RuntimeModelDiagnostic {
  provider: RuntimeModelProviderName;
  status: "ready" | "unavailable";
  model: string | null;
  modelAvailable: boolean | null;
  inferenceAvailable: boolean | null;
  errorCode: string | null;
  checkedAt: string;
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
  diagnose?(runInference?: boolean): Promise<RuntimeModelDiagnostic>;
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
