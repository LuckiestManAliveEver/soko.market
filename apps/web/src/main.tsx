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
  devOtp: string;
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
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(emptyPaymentForm);
  const [importForm, setImportForm] = useState<ImportFormState>(emptyImportForm);
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
      setOtp(response.devOtp);
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
    setInvoicePayments([]);
    setCustomerDebts([]);
    setImportJobs([]);
    setSelectedImportJobId(null);
    setRuntimeSessionId(null);
    setProductForm(emptyProductForm);
    setCustomerForm(emptyCustomerForm);
    setInvoiceForm(emptyInvoiceForm);
    setPaymentForm(emptyPaymentForm);
    setImportForm(emptyImportForm);
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
