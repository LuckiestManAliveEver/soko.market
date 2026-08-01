import { useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { AuthSessionView } from "@soko/shared-types";
import { apiFetch } from "./lib/api";
import { getUserFacingErrorMessage } from "./user-facing-error";

type Stage =
  "entry" | "verify-phone" | "profile" | "password" | "mfa" | "recovery-code" | "reset-password";
type IdentifierType = "phone" | "email";

const countries = [
  ["KE", "+254", "Kenya"],
  ["UG", "+256", "Uganda"],
  ["TZ", "+255", "Tanzania"],
  ["RW", "+250", "Rwanda"],
  ["NG", "+234", "Nigeria"],
  ["ZA", "+27", "South Africa"],
  ["GB", "+44", "United Kingdom"],
  ["US", "+1", "United States"]
] as const;

interface Props {
  initialMode: "signup" | "login";
  onAuthenticated: (session: AuthSessionView) => void;
  onCancel: () => void;
}

export function PhoneFirstAuthentication({ initialMode, onAuthenticated, onCancel }: Props) {
  const [identifierType, setIdentifierType] = useState<IdentifierType>("phone");
  const [country, setCountry] = useState("KE");
  const [identifier, setIdentifier] = useState("");
  const [stage, setStage] = useState<Stage>("entry");
  const [transactionId, setTransactionId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [legacyPin, setLegacyPin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [mfaFactor, setMfaFactor] = useState<"totp" | "recovery_code">("totp");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Phone is your primary Soko.market identity.");

  const identifierBody = () => ({
    type: identifierType,
    identifier,
    ...(identifierType === "phone" ? { country } : {})
  });

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(getUserFacingErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function continueIdentifier() {
    const result = await apiFetch<{ next: "signup" | "login" }>("/auth/identify", {
      method: "POST",
      body: identifierBody()
    });
    if (result.next === "login") {
      setStage("password");
      setMessage("Enter your password to continue.");
      return;
    }
    if (identifierType === "email") {
      setMessage(
        "New accounts start with a verified phone number. Use phone to create your account."
      );
      return;
    }
    const challenge = await apiFetch<{ transactionId: string; developmentCode?: string }>(
      "/auth/signup/start",
      { method: "POST", body: identifierBody() }
    );
    setTransactionId(challenge.transactionId);
    setCode(challenge.developmentCode ?? "");
    setStage("verify-phone");
    setMessage("Enter the verification code sent to your phone.");
  }

  async function verifyPhone() {
    await apiFetch("/auth/signup/verify-phone", { method: "POST", body: { transactionId, code } });
    setStage("profile");
    setCode("");
    setMessage("Phone verified. Finish creating your account.");
  }

  async function completeSignup() {
    const session = await apiFetch<AuthSessionView>("/auth/signup/complete", {
      method: "POST",
      body: {
        transactionId,
        displayName,
        password,
        passwordConfirmation,
        email: email || undefined,
        termsAccepted,
        privacyAccepted
      }
    });
    onAuthenticated(session);
  }

  async function login() {
    if (legacyPin) {
      const dial = countries.find(([iso]) => iso === country)?.[1] ?? "+254";
      const contact =
        identifierType === "phone" && !identifier.trim().startsWith("+")
          ? `${dial}${identifier.replace(/\D/gu, "").replace(/^0+/u, "")}`
          : identifier;
      const session = await apiFetch<AuthSessionView>("/auth/pin/login", {
        method: "POST",
        body: { method: identifierType, contact, pin: password }
      });
      onAuthenticated(session);
      return;
    }
    const result = await apiFetch<AuthSessionView | { mfaRequired: true; transactionId: string }>(
      "/auth/login/password",
      {
        method: "POST",
        body: { ...identifierBody(), password }
      }
    );
    if ("mfaRequired" in result && result.mfaRequired) {
      setTransactionId(result.transactionId);
      setStage("mfa");
      setCode("");
      setMessage("Enter your second factor.");
    } else onAuthenticated(result as AuthSessionView);
  }

  async function verifyMfa() {
    const session = await apiFetch<AuthSessionView>("/auth/mfa/verify", {
      method: "POST",
      body: { transactionId, factor: mfaFactor, code }
    });
    onAuthenticated(session);
  }

  async function startRecovery() {
    const result = await apiFetch<{
      transactionId: string;
      developmentCode?: string;
      message: string;
    }>("/auth/recovery/start", {
      method: "POST",
      body: identifierBody()
    });
    setTransactionId(result.transactionId);
    setCode(result.developmentCode ?? "");
    setStage("recovery-code");
    setMessage(result.message);
  }

  async function verifyRecovery() {
    await apiFetch("/auth/recovery/verify", { method: "POST", body: { transactionId, code } });
    setCode("");
    setStage("reset-password");
    setMessage("Identity verified. Choose a new password.");
  }

  async function resetPassword() {
    const session = await apiFetch<AuthSessionView>("/auth/recovery/reset-password", {
      method: "POST",
      body: { transactionId, password, passwordConfirmation, ...(code ? { mfaCode: code } : {}) }
    });
    onAuthenticated(session);
  }

  async function usePasskey() {
    if (!browserSupportsWebAuthn()) {
      setMessage("Passkeys are unavailable in this browser.");
      return;
    }
    const challenge = await apiFetch<{
      ceremonyId: string;
      options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
    }>("/auth/passkeys/login/options", { method: "POST", body: {} });
    const response = await startAuthentication({ optionsJSON: challenge.options });
    const session = await apiFetch<AuthSessionView>("/auth/passkeys/login/verify", {
      method: "POST",
      body: { ceremonyId: challenge.ceremonyId, response }
    });
    onAuthenticated(session);
  }

  return (
    <main className="setup-grid auth-landing-grid" id={initialMode}>
      <section className="panel auth-card">
        <div className="section-heading">
          <p className="eyebrow">SECURE ACCOUNT ACCESS</p>
          <h1>Welcome to soko.market</h1>
        </div>
        {stage === "entry" || stage === "password" ? (
          <>
            {identifierType === "phone" ? (
              <div className="phone-contact-row">
                <label>
                  Country code
                  <select value={country} onChange={(event) => setCountry(event.target.value)}>
                    {countries.map(([iso, dial, name]) => (
                      <option value={iso} key={iso}>
                        {dial} {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Phone number
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </label>
            )}
            {stage === "password" ? (
              <label>
                {legacyPin ? "Legacy 4-digit PIN" : "Password"}
                <input
                  type="password"
                  inputMode={legacyPin ? "numeric" : undefined}
                  maxLength={legacyPin ? 4 : 256}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={busy || !identifier.trim() || (stage === "password" && !password)}
              aria-busy={busy}
              onClick={() => void run(stage === "password" ? login : continueIdentifier)}
            >
              {busy ? "Working…" : stage === "password" ? "Sign in" : "Continue"}
            </button>
            {stage === "password" ? (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setLegacyPin((current) => !current);
                  setPassword("");
                }}
              >
                {legacyPin ? "Use password" : "Use legacy PIN"}
              </button>
            ) : null}
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setIdentifierType(identifierType === "phone" ? "email" : "phone");
                setIdentifier("");
                setStage("entry");
              }}
            >
              {identifierType === "phone" ? "Use email instead" : "Use phone instead"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void run(usePasskey)}
            >
              Use a passkey
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!identifier.trim() || busy}
              onClick={() => void run(startRecovery)}
            >
              Forgot password?
            </button>
          </>
        ) : null}
        {stage === "verify-phone" || stage === "recovery-code" ? (
          <>
            <label>
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !code.trim()}
              aria-busy={busy}
              onClick={() => void run(stage === "verify-phone" ? verifyPhone : verifyRecovery)}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </>
        ) : null}
        {stage === "profile" ? (
          <>
            <label>
              Display name
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Email (optional)
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <PasswordFields
              password={password}
              confirmation={passwordConfirmation}
              setPassword={setPassword}
              setConfirmation={setPasswordConfirmation}
            />
            <label>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
              />{" "}
              I accept the <a href="/terms">Terms of Service</a>
            </label>
            <label>
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(event) => setPrivacyAccepted(event.target.checked)}
              />{" "}
              I acknowledge the <a href="/privacy">Privacy Policy</a>
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !displayName.trim() ||
                password.length < 10 ||
                password !== passwordConfirmation ||
                !termsAccepted ||
                !privacyAccepted
              }
              aria-busy={busy}
              onClick={() => void run(completeSignup)}
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </>
        ) : null}
        {stage === "mfa" ? (
          <>
            <label>
              Second factor
              <select
                value={mfaFactor}
                onChange={(event) => setMfaFactor(event.target.value as typeof mfaFactor)}
              >
                <option value="totp">Authenticator app</option>
                <option value="recovery_code">Recovery code</option>
              </select>
            </label>
            <label>
              Code
              <input
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button type="button" disabled={busy || !code} onClick={() => void run(verifyMfa)}>
              Verify and sign in
            </button>
          </>
        ) : null}
        {stage === "reset-password" ? (
          <>
            <PasswordFields
              password={password}
              confirmation={passwordConfirmation}
              setPassword={setPassword}
              setConfirmation={setPasswordConfirmation}
            />
            <label>
              MFA code (if enabled)
              <input
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || password.length < 10 || password !== passwordConfirmation}
              onClick={() => void run(resetPassword)}
            >
              Reset password
            </button>
          </>
        ) : null}
        <p className="setup-status" role="status" aria-live="polite">
          {message}
        </p>
        <button className="secondary" type="button" onClick={onCancel}>
          Back to marketplace
        </button>
      </section>
    </main>
  );
}

function PasswordFields(props: {
  password: string;
  confirmation: string;
  setPassword: (value: string) => void;
  setConfirmation: (value: string) => void;
}) {
  return (
    <>
      <label>
        Password
        <input
          type="password"
          minLength={10}
          maxLength={256}
          autoComplete="new-password"
          value={props.password}
          onChange={(event) => props.setPassword(event.target.value)}
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          minLength={10}
          maxLength={256}
          autoComplete="new-password"
          value={props.confirmation}
          onChange={(event) => props.setConfirmation(event.target.value)}
        />
      </label>
    </>
  );
}
