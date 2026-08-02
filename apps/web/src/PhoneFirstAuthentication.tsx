import { useState } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";
import type { AuthSessionView } from "@soko/shared-types";
import { apiFetch } from "./lib/api";
import { getUserFacingErrorMessage } from "./user-facing-error";

type Stage =
  | "entry"
  | "profile"
  | "passkey-prompt"
  | "passkey-recommendation"
  | "password"
  | "mfa"
  | "recovery-code"
  | "reset-pin"
  | "reset-password";
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
  const [createdSession, setCreatedSession] = useState<AuthSessionView | null>(null);
  const [mfaFactor, setMfaFactor] = useState<"totp" | "recovery_code">("totp");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Phone can be your Soko.market identifier. SMS verification is not used."
  );

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
    if (initialMode === "login") {
      await apiFetch("/auth/login/methods", { method: "POST", body: identifierBody() });
      setStage("passkey-prompt");
      setMessage("Use a passkey for the fastest, most secure return access.");
      return;
    }
    if (identifierType === "email") {
      setMessage("New accounts start with a phone identifier. Use phone to create your account.");
      return;
    }
    const transaction = await apiFetch<{ transactionId: string }>("/auth/signup/start", {
      method: "POST",
      body: identifierBody()
    });
    setTransactionId(transaction.transactionId);
    setStage("profile");
    setMessage("Phone added as an unverified sign-in identifier. Finish creating your account.");
  }

  async function completeSignup() {
    const session = await apiFetch<AuthSessionView>("/auth/signup/complete", {
      method: "POST",
      body: {
        transactionId,
        displayName,
        ...(password ? { password, passwordConfirmation } : {}),
        email: email || undefined,
        termsAccepted,
        privacyAccepted
      }
    });
    setCreatedSession(session);
    setStage("passkey-recommendation");
    setMessage("Account created. Add a passkey for secure passwordless return access.");
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
    if (identifierType === "phone") {
      setPassword("");
      setPasswordConfirmation("");
      setStage("reset-pin");
      setMessage("Choose a new PIN, then verify your phone passkey to authorize the reset.");
      return;
    }
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

  async function resetPinWithPasskey() {
    if (!/^\d{4}$/u.test(password) || password !== passwordConfirmation) {
      setMessage("Enter and confirm a new 4-digit PIN.");
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setMessage("Passkeys are unavailable in this browser.");
      return;
    }
    const challenge = await apiFetch<{
      ceremonyId: string;
      options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
    }>("/auth/passkeys/login/options", {
      method: "POST",
      body: { purpose: "pin_recovery" }
    });
    const response = await startAuthentication({ optionsJSON: challenge.options });
    await apiFetch<AuthSessionView>("/auth/passkeys/login/verify", {
      method: "POST",
      body: { ceremonyId: challenge.ceremonyId, response }
    });
    const session = await apiFetch<AuthSessionView>("/auth/pin/recover/passkey", {
      method: "POST",
      body: { pin: password }
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

  async function createPasskey() {
    if (!createdSession) return;
    if (!browserSupportsWebAuthn()) {
      setMessage("Passkeys are unavailable in this browser. You can add one later in Security.");
      return;
    }
    const challenge = await apiFetch<{
      ceremonyId: string;
      options: Parameters<typeof startRegistration>[0]["optionsJSON"];
    }>("/auth/passkeys/register/options", { method: "POST", body: {} });
    const response = await startRegistration({ optionsJSON: challenge.options });
    await apiFetch("/auth/passkeys/register/verify", {
      method: "POST",
      body: { ceremonyId: challenge.ceremonyId, label: "Signup device", response }
    });
    onAuthenticated(createdSession);
  }

  const optionalPasswordInvalid =
    password.length !== 0 && (password.length < 10 || password !== passwordConfirmation);

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
              Recover account
            </button>
          </>
        ) : null}
        {stage === "passkey-prompt" ? (
          <>
            <h2>Welcome back</h2>
            <p>Continue with a passkey for passwordless access.</p>
            <button type="button" disabled={busy} onClick={() => void run(usePasskey)}>
              Continue with passkey
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setPassword("");
                setStage("password");
                setMessage("Use your password fallback if this account has one.");
              }}
            >
              Use password fallback
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!identifier.trim() || busy}
              onClick={() => void run(startRecovery)}
            >
              Recover account
            </button>
          </>
        ) : null}
        {stage === "recovery-code" ? (
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
              onClick={() => void run(verifyRecovery)}
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
              optional
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
                optionalPasswordInvalid ||
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
        {stage === "passkey-recommendation" && createdSession ? (
          <>
            <h2>Make return access effortless</h2>
            <p>
              Create a passkey for this device. It works with your device unlock and provides
              passwordless return access.
            </p>
            <button type="button" disabled={busy} onClick={() => void run(createPasskey)}>
              Create passkey
            </button>
            {password ? (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => onAuthenticated(createdSession)}
              >
                Do this later
              </button>
            ) : (
              <p>Create a passkey now because this account does not have a password fallback.</p>
            )}
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
        {stage === "reset-pin" ? (
          <>
            <h2>Reset legacy PIN</h2>
            <p>Your phone passkey will verify your identity before the PIN is changed.</p>
            <label>
              New 4-digit PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value.replace(/\D/gu, ""))}
              />
            </label>
            <label>
              Confirm new PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="new-password"
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value.replace(/\D/gu, ""))
                }
              />
            </label>
            <button
              type="button"
              disabled={busy || !/^\d{4}$/u.test(password) || password !== passwordConfirmation}
              onClick={() => void run(resetPinWithPasskey)}
            >
              Verify passkey and reset PIN
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
  optional?: boolean;
  password: string;
  confirmation: string;
  setPassword: (value: string) => void;
  setConfirmation: (value: string) => void;
}) {
  return (
    <>
      <label>
        Password{props.optional ? " fallback (optional)" : ""}
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
        Confirm password{props.optional ? " (optional)" : ""}
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
