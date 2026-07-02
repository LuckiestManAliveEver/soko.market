import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Surface } from "@soko/ui";
import {
  createCp3PlaceholderReply,
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

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const activeBusinessStorageKey = "soko.cp3.activeBusiness";

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    createInitialChatMessages(readStoredBusiness()?.name ?? "Soko.market")
  );

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

  async function logout() {
    await postJson<{ revoked: boolean }>("/auth/logout", {});
    setSession(null);
    setBusiness(null);
    setView("home");
    setStatusMessage("Signed out");
    localStorage.removeItem(activeBusinessStorageKey);
  }

  function sendChatDraft() {
    const merchantMessage: ChatMessage = {
      id: `merchant-${Date.now()}`,
      author: "merchant",
      body: chatDraft.trim()
    };
    const reply: ChatMessage = {
      id: `sokoclaw-${Date.now()}`,
      author: "sokoclaw",
      body: createCp3PlaceholderReply(chatDraft)
    };

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
              {currentEmptyState !== undefined ? (
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
  statusMessage: string;
  isOnline: boolean;
  onNavigate: (view: ShellView) => void;
}

function HomeSurface({ business, statusMessage, isOnline, onNavigate }: HomeSurfaceProps) {
  return (
    <div className="home-surface">
      <div className="metric-grid">
        <div className="metric">
          <span>Products</span>
          <strong>0</strong>
        </div>
        <div className="metric">
          <span>Customers</span>
          <strong>0</strong>
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
          <p>CP3 captures the surface. CP4 will parse and route commands after checks.</p>
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

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
