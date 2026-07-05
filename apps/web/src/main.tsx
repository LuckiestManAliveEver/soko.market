import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  parseMerchantCommand,
  shouldUseStructuredFallback,
  type ParseResult
} from "@soko/tool-core";
import { Surface } from "@soko/ui";
import {
  createInitialChatMessages,
  getEmptyState,
  quickActions,
  type ChatMessage,
  type ShellView
} from "./cp3-shell";
import "./styles.css";

type AuthChannel = "phone" | "email";
type SupportedLanguage = "en" | "sw";

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

interface BusinessResponse {
  business: {
    id: string;
    name: string;
    language: SupportedLanguage;
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

interface ProductSummary {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
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

interface DocumentImportPreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: SupplierImportDraft;
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
  target: "supplier";
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
  turnCount: number;
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
  status: "scheduled";
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
}

interface CustomerFormState {
  id: string | null;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

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
  fileName: string;
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

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const activeBusinessStorageKey = "soko.cp3.activeBusiness";

const emptyProductForm: ProductFormState = {
  id: null,
  name: "",
  sku: "",
  unit: "unit",
  quantity: "0"
};

const emptyCustomerForm: CustomerFormState = {
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
  fileName: "suppliers.csv",
  content: "name,phone,email,notes\nWholesale Depot,+254700000010,supply@example.com,Main supplier"
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
  pauseReason: "Public launch is closed until CP16 gates pass.",
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
  const [channel, setChannel] = useState<AuthChannel>("phone");
  const [destination, setDestination] = useState("+254700000000");
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);
  const [otp, setOtp] = useState("");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [businessName, setBusinessName] = useState("Jane's Shop");
  const [language, setLanguage] = useState<SupportedLanguage>("en");
  const [business, setBusiness] = useState<ActiveBusiness | null>(readStoredBusiness);
  const [statusMessage, setStatusMessage] = useState("Checking session");
  const [view, setView] = useState<ShellView>("home");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [chatDraft, setChatDraft] = useState("");
  const [runtimeSessionId, setRuntimeSessionId] = useState<string | null>(null);
  const [clarificationCount, setClarificationCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    createInitialChatMessages(readStoredBusiness()?.name ?? "Soko.market")
  );
  const [products, setProducts] = useState<ProductSummary[]>([]);
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

  const setupComplete = session !== null && business !== null;
  const currentEmptyState = getEmptyState(view);
  const activeQueueCount =
    syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict;
  const syncLabel = setupComplete
    ? activeQueueCount === 0
      ? "Synced"
      : `${activeQueueCount} queued`
    : "Waiting for setup";
  const userLabel = session?.user.displayName ?? "Signed out";
  const activeImportJob =
    importJobs.find((job) => job.id === selectedImportJobId) ?? importJobs[0] ?? null;

  useEffect(() => {
    void refreshSession();
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
    if (business !== null) {
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

    if (view === "products") {
      void loadProducts(business.id);
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
      setBusiness(null);
      setStatusMessage("Sign in to continue");
      localStorage.removeItem(activeBusinessStorageKey);
    } catch {
      setStatusMessage("API unavailable");
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

    setBusiness(null);
    localStorage.removeItem(activeBusinessStorageKey);
  }

  async function requestOtp() {
    try {
      const response = await postJson<OtpRequestResponse>("/auth/otp/request", {
        channel,
        destination
      });
      setChallenge(response);
      setOtp(response.devOtp ?? "");
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

    try {
      const response = await postJson<SessionResponse>("/auth/otp/verify", {
        challengeId: challenge.challengeId,
        code: otp
      });
      setSession(response);
      setStatusMessage("Account verified");
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  async function createBusiness() {
    try {
      const response = await postJson<BusinessResponse>("/businesses", {
        name: businessName,
        language
      });
      const nextBusiness = {
        ...response.business,
        role: response.membership.role
      };
      setBusiness(nextBusiness);
      localStorage.setItem(activeBusinessStorageKey, JSON.stringify(nextBusiness));
      await refreshSession();
      setView("home");
      setStatusMessage("Business shell ready");
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
        quantity: Number(productForm.quantity)
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

  async function loadCustomers(businessId: string) {
    try {
      setCustomers(await getJson<CustomerSummary[]>(`/businesses/${businessId}/customers`));
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
      localStorage.removeItem(activeBusinessStorageKey);
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
              reason: "Enabled for CP15 closed beta readiness."
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

  async function createSupplierCsvImport() {
    if (business === null) {
      return;
    }

    try {
      const job = await postJson<DocumentImportJobSummary>(
        `/businesses/${business.id}/imports/supplier-csv`,
        {
          fileName: importForm.fileName,
          contentType: "text/csv",
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
    mapped: SupplierImportDraft;
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
      const updated = await patchJson<DocumentImportJobSummary>(
        `/businesses/${business.id}/imports/${job.id}/rows/${row.rowNumber}`,
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
      const response = await postJson<DocumentImportConfirmResult>(
        `/businesses/${business.id}/imports/${job.id}/confirm`,
        {
          selectedRowNumbers: job.rows.filter((row) => row.selected).map((row) => row.rowNumber)
        }
      );
      setImportJobs((jobs) =>
        jobs.map((item) => (item.id === response.job.id ? response.job : item))
      );
      await loadDocumentImports(business.id);
      setStatusMessage(`${response.job.confirmedCount} supplier rows imported`);
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

  async function replaySyncQueue() {
    if (business === null) {
      return;
    }

    try {
      await postJson(`/businesses/${business.id}/sync-queue/replay`, {});
      await loadSyncQueue(business.id);
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
    await postJson<{ revoked: boolean }>("/auth/logout", {});
    setSession(null);
    setBusiness(null);
    setProducts([]);
    setCustomers([]);
    setInvoices([]);
    setPayments([]);
    setLogistics([]);
    setInvoicePayments([]);
    setCustomerDebts([]);
    setImportJobs([]);
    setSelectedImportJobId(null);
    setSecurityReview(null);
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
    setCustomerForm(emptyCustomerForm);
    setInvoiceForm(emptyInvoiceForm);
    setPaymentForm(emptyPaymentForm);
    setImportForm(emptyImportForm);
    setLogisticsForm(emptyLogisticsForm);
    setComplianceForm(emptyComplianceForm);
    setBetaForm(emptyBetaForm);
    setLaunchForm(emptyLaunchForm);
    setInvoicePreview(null);
    setView("home");
    setStatusMessage("Signed out");
    localStorage.removeItem(activeBusinessStorageKey);
  }

  async function sendChatDraft() {
    const message = chatDraft.trim();

    if (message.length === 0) {
      return;
    }

    if (business === null) {
      sendLocalParserChat(message);
      return;
    }

    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: message
    };

    setChatMessages((messages) => [...messages, merchantMessage]);
    setChatDraft("");

    try {
      const result = await postJson<RuntimeTurnResult>(`/businesses/${business.id}/runtime/turns`, {
        runtimeSessionId,
        message
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

      setStatusMessage(`Runtime ${result.turn.status.replace("_", " ")}`);
    } catch (error) {
      sendLocalParserChat(message);
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

      setStatusMessage(`Runtime ${result.turn.status.replace("_", " ")}`);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function sendLocalParserChat(message: string) {
    const parserResult = parseMerchantCommand(message);
    const useFallback = shouldUseStructuredFallback(parserResult, clarificationCount);
    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: message
    };
    const reply: ChatMessage = {
      id: `sokoclaw-${Date.now()}`,
      author: "sokoclaw",
      body: useFallback
        ? createStructuredFallbackReply(parserResult)
        : createParserReply(parserResult)
    };

    if (parserResult.nextAction.type === "navigate") {
      setView(parserResult.nextAction.view);
    }

    if (parserResult.intent === "create_invoice" && parserResult.nextAction.type === "draft") {
      setInvoiceForm((form) => ({
        ...form,
        customerName: parserResult.slots.customerName ?? form.customerName,
        quantity:
          parserResult.slots.quantity === undefined
            ? form.quantity
            : String(parserResult.slots.quantity)
      }));
      setInvoicePreview(null);
      setView("invoices");
    }

    setClarificationCount(parserResult.nextAction.type === "clarify" ? clarificationCount + 1 : 0);
    setChatMessages((messages) => [...messages, merchantMessage, reply]);
    setChatDraft("");
  }

  return (
    <Surface title="Soko.market">
      <div className="app-frame">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Mobile PWA shell</p>
            <h2>{business?.name ?? "Owner setup"}</h2>
          </div>
          <div className="status-stack" aria-label="Shell status">
            <span className={isOnline ? "status-pill online" : "status-pill offline"}>
              {isOnline ? "Online" : "Offline"}
            </span>
            <span className="status-pill sync">{syncLabel}</span>
          </div>
        </header>

        {!setupComplete ? (
          <SetupPanel
            channel={channel}
            destination={destination}
            challenge={challenge}
            otp={otp}
            businessName={businessName}
            language={language}
            session={session}
            statusMessage={statusMessage}
            userLabel={userLabel}
            onChannelChange={setChannel}
            onDestinationChange={setDestination}
            onOtpChange={setOtp}
            onBusinessNameChange={setBusinessName}
            onLanguageChange={setLanguage}
            onRequestOtp={() => void requestOtp()}
            onVerifyOtp={() => void verifyOtp()}
            onCreateBusiness={() => void createBusiness()}
            onRefresh={() => void refreshSession()}
            onLogout={() => void logout()}
          />
        ) : (
          <main className="shell-grid">
            <nav className="bottom-nav" aria-label="Primary shell navigation">
              {quickActions.map((action) => (
                <button
                  className={view === action.id ? "active" : ""}
                  key={action.id}
                  type="button"
                  onClick={() => setView(action.id)}
                >
                  <span>{action.label}</span>
                </button>
              ))}
            </nav>

            <section className="home-panel" aria-label="Business home">
              <div className="section-heading">
                <p className="eyebrow">Today</p>
                <h2>{view === "home" ? "Business home" : viewLabel(view)}</h2>
              </div>
              {view === "home" ? (
                <HomeSurface
                  business={business}
                  productCount={products.length}
                  customerCount={customers.length}
                  invoiceCount={invoices.length}
                  syncSummary={syncSummary}
                  statusMessage={statusMessage}
                  isOnline={isOnline}
                  onNavigate={setView}
                />
              ) : null}
              {view === "chat" ? (
                <ChatSurface
                  chatDraft={chatDraft}
                  messages={chatMessages}
                  onDraftChange={setChatDraft}
                  onConfirm={(token) => void confirmRuntimeAction(token)}
                  onSend={() => void sendChatDraft()}
                />
              ) : null}
              {view === "products" ? (
                <ProductSurface
                  products={products}
                  form={productForm}
                  stockProductId={stockProductId}
                  stockQuantityAfter={stockQuantityAfter}
                  stockReason={stockReason}
                  onFormChange={setProductForm}
                  onSave={() => void saveProduct()}
                  onReset={() => setProductForm(emptyProductForm)}
                  onEdit={(product) => {
                    setProductForm({
                      id: product.id,
                      name: product.name,
                      sku: product.sku ?? "",
                      unit: product.unit,
                      quantity: String(product.quantity)
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
                />
              ) : null}
              {view === "customers" ? (
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
              ) : null}
              {view === "invoices" ? (
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
              ) : null}
              {view === "sync" ? (
                <SyncSurface
                  summary={syncSummary}
                  items={syncQueue}
                  onRefresh={() => business !== null && void loadSyncQueue(business.id)}
                  onReplay={() => void replaySyncQueue()}
                />
              ) : null}
              {view === "payments" ? (
                <PaymentSurface
                  invoices={invoices}
                  payments={payments}
                  invoicePayments={invoicePayments}
                  customerDebts={customerDebts}
                  form={paymentForm}
                  onFormChange={setPaymentForm}
                  onRecord={() => void recordPayment()}
                  onRefresh={() => business !== null && void loadPaymentData(business.id)}
                />
              ) : null}
              {view === "imports" ? (
                <ImportSurface
                  form={importForm}
                  importJobs={importJobs}
                  activeImportJob={activeImportJob}
                  selectedImportJobId={selectedImportJobId}
                  onFormChange={setImportForm}
                  onCreate={() => void createSupplierCsvImport()}
                  onSelectJob={setSelectedImportJobId}
                  onRowChange={updateImportRowLocal}
                  onSaveRow={(job, row) => void saveImportRow(job, row)}
                  onConfirm={(job) => void confirmImport(job)}
                  onRefresh={() => business !== null && void loadDocumentImports(business.id)}
                />
              ) : null}
              {view === "logistics" ? (
                <LogisticsSurface
                  invoices={invoices}
                  logistics={logistics}
                  form={logisticsForm}
                  onFormChange={setLogisticsForm}
                  onCreate={() => void createLogistics()}
                  onStatusChange={(logisticsId, status) =>
                    void updateLogisticsStatus(logisticsId, status)
                  }
                  onRefresh={() => business !== null && void loadLogistics(business.id)}
                />
              ) : null}
              {view === "compliance" ? (
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
                  onRefresh={() => business !== null && void loadCompliance(business.id)}
                />
              ) : null}
              {view === "beta" ? (
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
                  onRefresh={() => business !== null && void loadBetaReadiness(business.id)}
                />
              ) : null}
              {view === "launch" ? (
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
                  onRefresh={() => business !== null && void loadLaunchReadiness(business.id)}
                />
              ) : null}
              {view === "reports" ? (
                <ReportsSurface
                  report={reportSummary}
                  knowledge={knowledgeSummary}
                  onRefresh={() => business !== null && void loadReports(business.id)}
                />
              ) : null}
              {view === "notifications" ? (
                <NotificationsSurface
                  inbox={notificationInbox}
                  onRefresh={() => business !== null && void loadNotifications(business.id)}
                  onUpdate={(notificationId, status) =>
                    void updateNotification(notificationId, status)
                  }
                />
              ) : null}
              {currentEmptyState !== undefined &&
              view !== "products" &&
              view !== "customers" &&
              view !== "invoices" &&
              view !== "sync" &&
              view !== "payments" &&
              view !== "imports" &&
              view !== "logistics" &&
              view !== "compliance" &&
              view !== "beta" &&
              view !== "reports" &&
              view !== "notifications" ? (
                <EmptyStateSurface
                  title={currentEmptyState.title}
                  body={currentEmptyState.body}
                  onChat={() => setView("chat")}
                />
              ) : null}
            </section>

            <aside className="side-panel" aria-label="Shell details">
              <div>
                <p className="eyebrow">Owner</p>
                <h3>{userLabel}</h3>
                <p>{business.role}</p>
              </div>
              <div className="status-card">
                <span className={isOnline ? "status-dot online" : "status-dot offline"} />
                <div>
                  <strong>{isOnline ? "Connected" : "Offline"}</strong>
                  <p>CP7 keeps cached business data visible while queued work awaits replay.</p>
                </div>
              </div>
              <div className="status-card">
                <span className="status-dot sync" />
                <div>
                  <strong>{syncLabel}</strong>
                  <p>
                    {syncSummary.conflict > 0
                      ? `${syncSummary.conflict} conflict item needs review.`
                      : `${syncSummary.synced} synced item${syncSummary.synced === 1 ? "" : "s"}.`}
                  </p>
                </div>
              </div>
              <div className="side-actions">
                <button type="button" onClick={() => void refreshSession()}>
                  Refresh
                </button>
                <button className="secondary" type="button" onClick={() => void logout()}>
                  Logout
                </button>
              </div>
            </aside>
          </main>
        )}
      </div>
    </Surface>
  );
}

interface SetupPanelProps {
  channel: AuthChannel;
  destination: string;
  challenge: OtpRequestResponse | null;
  otp: string;
  businessName: string;
  language: SupportedLanguage;
  session: SessionResponse | null;
  statusMessage: string;
  userLabel: string;
  onChannelChange: (channel: AuthChannel) => void;
  onDestinationChange: (destination: string) => void;
  onOtpChange: (otp: string) => void;
  onBusinessNameChange: (businessName: string) => void;
  onLanguageChange: (language: SupportedLanguage) => void;
  onRequestOtp: () => void;
  onVerifyOtp: () => void;
  onCreateBusiness: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}

function SetupPanel(props: SetupPanelProps) {
  return (
    <main className="setup-grid">
      <section className="panel">
        <div className="section-heading">
          <p className="eyebrow">Step 1</p>
          <h2>Owner access</h2>
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
        <label>
          Contact
          <input
            value={props.destination}
            onChange={(event) => props.onDestinationChange(event.target.value)}
            inputMode={props.channel === "phone" ? "tel" : "email"}
          />
        </label>
        <button type="button" onClick={props.onRequestOtp}>
          Request OTP
        </button>
        <label>
          OTP
          <input
            value={props.otp}
            onChange={(event) => props.onOtpChange(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="button" onClick={props.onVerifyOtp} disabled={props.challenge === null}>
          Verify
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <p className="eyebrow">Step 2</p>
          <h2>Business setup</h2>
        </div>
        <label>
          Business
          <input
            value={props.businessName}
            onChange={(event) => props.onBusinessNameChange(event.target.value)}
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
        <button type="button" onClick={props.onCreateBusiness} disabled={props.session === null}>
          Create Business
        </button>
      </section>

      <section className="panel status-panel">
        <div className="section-heading">
          <p className="eyebrow">Session</p>
          <h2>Status</h2>
        </div>
        <p>{props.statusMessage}</p>
        <p>{props.userLabel}</p>
        <div className="actions">
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
          <button
            className="secondary"
            type="button"
            onClick={props.onLogout}
            disabled={props.session === null}
          >
            Logout
          </button>
        </div>
      </section>
    </main>
  );
}

interface HomeSurfaceProps {
  business: ActiveBusiness;
  productCount: number;
  customerCount: number;
  invoiceCount: number;
  syncSummary: SyncQueueSummary;
  statusMessage: string;
  isOnline: boolean;
  onNavigate: (view: ShellView) => void;
}

function HomeSurface({
  business,
  productCount,
  customerCount,
  invoiceCount,
  syncSummary,
  statusMessage,
  isOnline,
  onNavigate
}: HomeSurfaceProps) {
  const activeQueueCount =
    syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict;

  return (
    <div className="home-surface">
      <div className="metric-grid">
        <div className="metric">
          <span>Products</span>
          <strong>{productCount}</strong>
        </div>
        <div className="metric">
          <span>Customers</span>
          <strong>{customerCount}</strong>
        </div>
        <div className="metric">
          <span>Invoices</span>
          <strong>{invoiceCount}</strong>
        </div>
        <div className="metric">
          <span>Queued</span>
          <strong>{activeQueueCount}</strong>
        </div>
      </div>

      <div className="prompt-band">
        <div>
          <p className="eyebrow">Offline-ready</p>
          <h3>Review queued work before replay</h3>
          <p>CP7 keeps local mutations queued until server validation confirms them.</p>
        </div>
        <button type="button" onClick={() => onNavigate("sync")}>
          Open sync
        </button>
      </div>

      <div className="quick-grid" aria-label="Quick actions">
        {quickActions
          .filter((action) => action.id !== "home" && action.id !== "chat")
          .map((action) => (
            <button key={action.id} type="button" onClick={() => onNavigate(action.id)}>
              <strong>{action.label}</strong>
              <span>{action.summary}</span>
            </button>
          ))}
      </div>

      <p className="shell-note">
        {business.name} is {isOnline ? "online" : "offline"}; {statusMessage}.
      </p>
    </div>
  );
}

interface SyncSurfaceProps {
  summary: SyncQueueSummary;
  items: SyncQueueItem[];
  onRefresh: () => void;
  onReplay: () => void;
}

function SyncSurface(props: SyncSurfaceProps) {
  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Sync queue actions">
        <div className="section-heading">
          <p className="eyebrow">CP7 sync</p>
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
              <strong>{item.attempts}</strong>
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
          <p className="eyebrow">CP8 payment</p>
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
    mapped: SupplierImportDraft;
    selected: boolean;
  }) => void;
  onSaveRow: (job: DocumentImportJobSummary, row: DocumentImportPreviewRow) => void;
  onConfirm: (job: DocumentImportJobSummary) => void;
  onRefresh: () => void;
}

function ImportSurface(props: ImportSurfaceProps) {
  const selectedRows = props.activeImportJob?.rows.filter((row) => row.selected) ?? [];
  const invalidSelectedRows = selectedRows.filter((row) => row.errors.length > 0);

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Supplier CSV import">
        <div className="section-heading">
          <p className="eyebrow">CP9 import</p>
          <h3>Supplier CSV preview</h3>
        </div>
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
          CSV content
          <textarea
            value={props.form.content}
            onChange={(event) => props.onFormChange({ ...props.form, content: event.target.value })}
            rows={7}
          />
        </label>
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
          <p className="eyebrow">Jobs</p>
          <h3>Document imports</h3>
        </div>
        {props.importJobs.length === 0 ? (
          <div className="empty-record">
            <h3>No imports yet</h3>
            <p>Preview a supplier CSV before confirming new records.</p>
          </div>
        ) : (
          props.importJobs.map((job) => (
            <article className="record-row" key={job.id}>
              <div>
                <strong>
                  {job.source.fileName} - {job.status}
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
            <p className="eyebrow">{props.activeImportJob.status}</p>
            <h3>Preview rows</h3>
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
          {props.activeImportJob.rows.map((row) => (
            <ImportRowEditor
              importJobId={props.activeImportJob?.id ?? ""}
              key={row.rowNumber}
              row={row}
              disabled={props.activeImportJob?.status !== "previewed"}
              onRowChange={props.onRowChange}
              onSave={() =>
                props.activeImportJob !== null && props.onSaveRow(props.activeImportJob, row)
              }
            />
          ))}
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
    mapped: SupplierImportDraft;
    selected: boolean;
  }) => void;
  onSave: () => void;
}

function ImportRowEditor(props: ImportRowEditorProps) {
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
                mapped: props.row.mapped,
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
            value={props.row.mapped.name}
            disabled={props.disabled}
            onChange={(event) => updateMapped({ ...props.row.mapped, name: event.target.value })}
          />
        </label>
        <label>
          Phone
          <input
            value={props.row.mapped.phone ?? ""}
            disabled={props.disabled}
            onChange={(event) =>
              updateMapped({ ...props.row.mapped, phone: event.target.value || null })
            }
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Email
          <input
            value={props.row.mapped.email ?? ""}
            disabled={props.disabled}
            onChange={(event) =>
              updateMapped({ ...props.row.mapped, email: event.target.value || null })
            }
          />
        </label>
        <label>
          Notes
          <input
            value={props.row.mapped.notes ?? ""}
            disabled={props.disabled}
            onChange={(event) =>
              updateMapped({ ...props.row.mapped, notes: event.target.value || null })
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
          <p className="eyebrow">CP13 logistics</p>
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
  onEdit: (product: ProductSummary) => void;
  onStockProductChange: (productId: string) => void;
  onStockQuantityAfterChange: (quantity: string) => void;
  onStockReasonChange: (reason: string) => void;
  onAdjustStock: () => void;
}

function ProductSurface(props: ProductSurfaceProps) {
  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Product form">
        <div className="section-heading">
          <p className="eyebrow">{props.form.id === null ? "New product" : "Edit product"}</p>
          <h3>{props.form.id === null ? "Add stock item" : "Update stock item"}</h3>
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
        <div className="actions">
          <button type="button" onClick={props.onSave}>
            {props.form.id === null ? "Create" : "Save"}
          </button>
          <button className="secondary" type="button" onClick={props.onReset}>
            Clear
          </button>
        </div>
      </section>

      <section className="record-form" aria-label="Stock adjustment">
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

      <section className="record-list" aria-label="Products">
        {props.products.length === 0 ? (
          <div className="empty-record">
            <h3>No products yet</h3>
            <p>Add the first product to start CP5 stock records.</p>
          </div>
        ) : (
          props.products.map((product) => (
            <article className="record-row" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>
                  {product.quantity} {product.unit}
                  {product.sku === null ? "" : ` · ${product.sku}`}
                </span>
              </div>
              <button type="button" onClick={() => props.onEdit(product)}>
                Edit
              </button>
            </article>
          ))
        )}
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
            <p>Add the first customer to start CP5 customer records.</p>
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
            <p>Create the first CP6 invoice draft to preview totals and confirm stock movement.</p>
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
          <p className="eyebrow">CP14 compliance</p>
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
          body={props.deviceTrust?.reason ?? "Device trust is a CP14 placeholder."}
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
          <p className="eyebrow">CP15 beta</p>
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
          <p className="eyebrow">CP16 launch</p>
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
        body="Refresh to load CP12 deterministic business summaries."
        onChat={onRefresh}
        actionLabel="Refresh"
      />
    );
  }

  return (
    <div className="records-surface">
      <section className="record-form" aria-label="Report controls">
        <div className="section-heading">
          <p className="eyebrow">CP12 reports</p>
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
          <p className="eyebrow">CP12 alerts</p>
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

interface ChatSurfaceProps {
  chatDraft: string;
  messages: ChatMessage[];
  onDraftChange: (draft: string) => void;
  onConfirm: (confirmationToken: string) => void;
  onSend: () => void;
}

function ChatSurface({ chatDraft, messages, onDraftChange, onConfirm, onSend }: ChatSurfaceProps) {
  return (
    <div className="chat-surface">
      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article className={`message ${message.author}`} key={message.id}>
            <span>{message.author === "merchant" ? "You" : "Sokoclaw"}</span>
            <p>{message.body}</p>
            {message.confirmationToken !== undefined ? (
              <button type="button" onClick={() => onConfirm(message.confirmationToken ?? "")}>
                Confirm
              </button>
            ) : null}
          </article>
        ))}
      </div>
      <div className="composer">
        <label>
          Message
          <textarea
            value={chatDraft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Example: Add 10 packets of maize flour"
            rows={3}
          />
        </label>
        <button type="button" onClick={onSend}>
          Send draft
        </button>
      </div>
    </div>
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

function readStoredBusiness(): ActiveBusiness | null {
  const stored = localStorage.getItem(activeBusinessStorageKey);

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
      return parsed;
    }
  } catch {
    localStorage.removeItem(activeBusinessStorageKey);
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function viewLabel(view: ShellView): string {
  const action = quickActions.find((item) => item.id === view);
  return action?.label ?? "Business home";
}

function createParserReply(result: ParseResult): string {
  if (result.nextAction.type === "clarify") {
    return `${result.nextAction.question} Intent: ${result.intent}. Confidence: ${formatConfidence(
      result.confidence
    )}.`;
  }

  if (result.nextAction.type === "navigate") {
    return `Opening ${viewLabel(result.nextAction.view)}. Intent: ${result.intent}. Confidence: ${formatConfidence(
      result.confidence
    )}. No business record was changed.`;
  }

  return `Draft parsed as ${result.intent}. Confidence: ${formatConfidence(
    result.confidence
  )}. ${formatSlots(result.slots)}No business record was changed.`;
}

function createStructuredFallbackReply(result: ParseResult): string {
  return `I still need a clearer command. Use quick actions for Products, Customers, Invoices, or Payments, or try a direct command like "show products". Intent: ${result.intent}. No business record was changed.`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    currency: "KES",
    style: "currency"
  }).format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium"
  }).format(new Date(value));
}

function formatSlots(slots: ParseResult["slots"]): string {
  const entries = Object.entries(slots);

  if (entries.length === 0) {
    return "";
  }

  return `Slots: ${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}. `;
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
