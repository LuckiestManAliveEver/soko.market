import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Surface } from "@soko/ui";
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

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";

function App() {
  const [channel, setChannel] = useState<AuthChannel>("phone");
  const [destination, setDestination] = useState("+254700000000");
  const [challenge, setChallenge] = useState<OtpRequestResponse | null>(null);
  const [otp, setOtp] = useState("");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [businessName, setBusinessName] = useState("Jane's Shop");
  const [language, setLanguage] = useState<SupportedLanguage>("en");
  const [business, setBusiness] = useState<BusinessResponse | null>(null);
  const [message, setMessage] = useState("Ready");

  const setupComplete = useMemo(() => session !== null && business !== null, [business, session]);

  useEffect(() => {
    void refreshSession();
  }, []);

  async function refreshSession() {
    const response = await fetch(`${apiBaseUrl}/session`, {
      credentials: "include"
    });

    if (response.ok) {
      setSession((await response.json()) as SessionResponse);
      setMessage("Session active");
    }
  }

  async function requestOtp() {
    const response = await postJson<OtpRequestResponse>("/auth/otp/request", {
      channel,
      destination
    });
    setChallenge(response);
    setOtp(response.devOtp);
    setMessage(`OTP sent to ${response.destination}`);
  }

  async function verifyOtp() {
    if (challenge === null) {
      setMessage("Request an OTP first");
      return;
    }

    const response = await postJson<SessionResponse>("/auth/otp/verify", {
      challengeId: challenge.challengeId,
      code: otp
    });
    setSession(response);
    setMessage("Account verified");
  }

  async function createBusiness() {
    const response = await postJson<BusinessResponse>("/businesses", {
      name: businessName,
      language
    });
    setBusiness(response);
    await refreshSession();
    setMessage("Business created");
  }

  async function logout() {
    await postJson<{ revoked: boolean }>("/auth/logout", {});
    setSession(null);
    setBusiness(null);
    setMessage("Signed out");
  }

  return (
    <Surface title="Soko.market">
      <div className="cp2-shell">
        <section className="panel">
          <h2>Owner Access</h2>
          <div className="segmented" aria-label="Auth channel">
            <button
              className={channel === "phone" ? "active" : ""}
              type="button"
              onClick={() => setChannel("phone")}
            >
              Phone
            </button>
            <button
              className={channel === "email" ? "active" : ""}
              type="button"
              onClick={() => setChannel("email")}
            >
              Email
            </button>
          </div>
          <label>
            Contact
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              inputMode={channel === "phone" ? "tel" : "email"}
            />
          </label>
          <button type="button" onClick={() => void requestOtp()}>
            Request OTP
          </button>
          <label>
            OTP
            <input
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button type="button" onClick={() => void verifyOtp()} disabled={challenge === null}>
            Verify
          </button>
        </section>

        <section className="panel">
          <h2>Business Setup</h2>
          <label>
            Business
            <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
          </label>
          <label>
            Language
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
            >
              <option value="en">English</option>
              <option value="sw">Swahili</option>
            </select>
          </label>
          <button type="button" onClick={() => void createBusiness()} disabled={session === null}>
            Create Business
          </button>
        </section>

        <section className="panel status-panel">
          <h2>Status</h2>
          <p>{message}</p>
          {session !== null ? <p>{session.user.displayName}</p> : <p>Signed out</p>}
          {business !== null ? <p>{business.business.name}</p> : <p>No business yet</p>}
          {setupComplete ? <p>Owner role active</p> : null}
          <div className="actions">
            <button type="button" onClick={() => void refreshSession()}>
              Refresh
            </button>
            <button type="button" onClick={() => void logout()} disabled={session === null}>
              Logout
            </button>
          </div>
        </section>
      </div>
    </Surface>
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

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
