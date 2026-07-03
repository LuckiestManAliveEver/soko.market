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
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(emptyCustomerForm);
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

  async function logout() {
    await postJson<{ revoked: boolean }>("/auth/logout", {});
    setSession(null);
    setBusiness(null);
    setProducts([]);
    setCustomers([]);
    setProductForm(emptyProductForm);
    setCustomerForm(emptyCustomerForm);
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
              {currentEmptyState !== undefined && view !== "products" && view !== "customers" ? (
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
  statusMessage: string;
  isOnline: boolean;
  onNavigate: (view: ShellView) => void;
}

function HomeSurface({
  business,
  productCount,
  customerCount,
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
          <strong>0</strong>
        </div>
      </div>

      <div className="prompt-band">
        <div>
          <p className="eyebrow">Chat-first</p>
          <h3>Start with a draft instruction</h3>
          <p>CP4 parses drafts. CP5 product and customer writes use validated record tools.</p>
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
