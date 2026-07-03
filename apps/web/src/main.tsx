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
  const [clarificationCount, setClarificationCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    createInitialChatMessages(readStoredBusiness()?.name ?? "Soko.market")
  );
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(emptyInvoiceForm);
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreview | null>(null);
  const [stockProductId, setStockProductId] = useState("");
  const [stockQuantityAfter, setStockQuantityAfter] = useState("0");
  const [stockReason, setStockReason] = useState("Manual stock count");

  const setupComplete = session !== null && business !== null;
  const currentEmptyState = getEmptyState(view);
  const syncLabel = setupComplete ? "Sync placeholder" : "Waiting for setup";
  const userLabel = session?.user.displayName ?? "Signed out";

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
    setProductForm(emptyProductForm);
    setCustomerForm(emptyCustomerForm);
    setInvoiceForm(emptyInvoiceForm);
    setInvoicePreview(null);
    setView("home");
    setStatusMessage("Signed out");
    localStorage.removeItem(activeBusinessStorageKey);
  }

  function sendChatDraft() {
    const parserResult = parseMerchantCommand(chatDraft);
    const useFallback = shouldUseStructuredFallback(parserResult, clarificationCount);
    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: chatDraft.trim()
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
                  onSend={sendChatDraft}
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
              {currentEmptyState !== undefined &&
              view !== "products" &&
              view !== "customers" &&
              view !== "invoices" ? (
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
                  <p>CP3 shows status only. Offline queue starts in CP7.</p>
                </div>
              </div>
              <div className="status-card">
                <span className="status-dot sync" />
                <div>
                  <strong>Sync pending design</strong>
                  <p>No local business mutations are queued in CP3.</p>
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
  statusMessage: string;
  isOnline: boolean;
  onNavigate: (view: ShellView) => void;
}

function HomeSurface({
  business,
  productCount,
  customerCount,
  invoiceCount,
  statusMessage,
  isOnline,
  onNavigate
}: HomeSurfaceProps) {
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
      </div>

      <div className="prompt-band">
        <div>
          <p className="eyebrow">Chat-first</p>
          <h3>Start with a draft instruction</h3>
          <p>CP6 invoice drafts still require deterministic preview and owner confirmation.</p>
        </div>
        <button type="button" onClick={() => onNavigate("chat")}>
          Open chat
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

interface ChatSurfaceProps {
  chatDraft: string;
  messages: ChatMessage[];
  onDraftChange: (draft: string) => void;
  onSend: () => void;
}

function ChatSurface({ chatDraft, messages, onDraftChange, onSend }: ChatSurfaceProps) {
  return (
    <div className="chat-surface">
      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article className={`message ${message.author}`} key={message.id}>
            <span>{message.author === "merchant" ? "You" : "Sokoclaw"}</span>
            <p>{message.body}</p>
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
}

function EmptyStateSurface({ title, body, onChat }: EmptyStateSurfaceProps) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      <button type="button" onClick={onChat}>
        Draft in chat
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
