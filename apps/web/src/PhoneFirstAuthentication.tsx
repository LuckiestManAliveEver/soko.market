import { useState } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";
import type { AuthSessionView } from "@soko/shared-types";
import { normalizePhoneInput, phoneNormalizationErrorMessage } from "@soko/shared-types";
import { getCountryCallingCode, type CountryCode } from "libphonenumber-js";
import { apiFetch } from "./lib/api";
import { AppIcon } from "./AppIcon";
import { PhoneNumberField, authenticationPhoneCountries } from "./PhoneNumberField";
import { getUserFacingErrorMessage } from "./user-facing-error";

type Stage =
  | "entry"
  | "pin"
  | "name"
  | "secure"
  | "password"
  | "mfa"
  | "recovery-code"
  | "reset-pin"
  | "reset-password";
type IdentifierType = "phone" | "email" | "store";
type SecureOffer = "passkey" | "pin";

interface Props {
  onAuthenticated: (session: AuthSessionView) => void;
  onCancel: () => void;
}

export function PhoneFirstAuthentication({ onAuthenticated, onCancel }: Props) {
  const [identifierType, setIdentifierType] = useState<IdentifierType>("phone");
  const [country, setCountry] = useState<CountryCode>("KE");
  const [identifier, setIdentifier] = useState("");
  const [stage, setStage] = useState<Stage>("entry");
  const [transactionId, setTransactionId] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [legacyPin, setLegacyPin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [createdSession, setCreatedSession] = useState<AuthSessionView | null>(null);
  const [secureOffer, setSecureOffer] = useState<SecureOffer>("passkey");
  const [mfaFactor, setMfaFactor] = useState<"totp" | "recovery_code">("totp");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Phone can be your Soko.market identifier. SMS verification is not used."
  );

  const identifierBody = () => {
    if (identifierType === "email") {
      const trimmed = identifier.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(trimmed)) {
        throw new Error("Enter a valid email address.");
      }
      return { type: identifierType, identifier: trimmed };
    }
    if (identifierType === "store") {
      const normalized = identifier.trim().replace(/^\+/u, "").replace(/-/gu, "");
      if (!/^\d{1,3}[A-Za-z]\d{8}$/u.test(normalized)) {
        throw new Error("Enter a valid Soko ID, e.g. 254A00000001.");
      }
      return { type: identifierType, identifier: normalized };
    }
    const normalized = normalizePhoneInput({
      rawInput: identifier,
      selectedCountry: country,
      selectedCallingCode: getCountryCallingCode(country)
    });
    if (!normalized.valid) throw new Error(phoneNormalizationErrorMessage(normalized.error));
    return { type: identifierType, identifier: normalized.e164, country: normalized.country };
  };

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
    identifierBody();
    setPin("");
    setStage("pin");
    setMessage(
      identifierType === "store"
        ? "Enter the store owner's PIN to continue."
        : "Enter your PIN. New here? This creates one. Already have an account? Enter your existing PIN."
    );
  }

  async function submitPin() {
    const normalized = identifierBody();
    const result = await apiFetch<AuthSessionView>(
      identifierType === "store" ? "/auth/pin/store-login" : "/auth/pin/continue",
      {
        method: "POST",
        body:
          identifierType === "store"
            ? { sokoId: normalized.identifier, pin }
            : {
                method: identifierType,
                contact: normalized.identifier,
                ...(identifierType === "phone" ? { country } : {}),
                pin
              }
      }
    );
    if (result.isNewAccount) {
      setCreatedSession(result);
      setDisplayName(result.user.displayName);
      setStage("name");
      setMessage("Welcome! What should we call you?");
      return;
    }
    onAuthenticated(result);
  }

  async function submitDisplayName() {
    if (!createdSession) return;
    const result = await apiFetch<{ user: AuthSessionView["user"] }>("/account/display-name", {
      method: "PUT",
      body: { displayName: displayName.trim() }
    });
    setCreatedSession({ ...createdSession, user: result.user });
    setSecureOffer("passkey");
    setStage("secure");
    setMessage("Add a passkey for secure passwordless return access, or skip for now.");
  }

  async function afterAlternateAuthentication(session: AuthSessionView) {
    try {
      const status = await apiFetch<{ hasPin: boolean }>("/auth/pin/status");
      if (!status.hasPin) {
        setCreatedSession(session);
        setSecureOffer("pin");
        setPassword("");
        setPasswordConfirmation("");
        setStage("secure");
        setMessage("Set a 4-digit PIN so next time you can sign in even faster.");
        return;
      }
    } catch {
      // The nudge is best-effort only; fall through to the authenticated state either way.
    }
    onAuthenticated(session);
  }

  async function login() {
    if (legacyPin) {
      const normalizedBody = identifierBody();
      const session = await apiFetch<AuthSessionView>("/auth/pin/login", {
        method: "POST",
        body: {
          method: identifierType,
          contact: normalizedBody.identifier,
          ...(identifierType === "phone" ? { country } : {}),
          pin: password
        }
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
    } else {
      await afterAlternateAuthentication(result as AuthSessionView);
    }
  }

  async function verifyMfa() {
    const session = await apiFetch<AuthSessionView>("/auth/mfa/verify", {
      method: "POST",
      body: { transactionId, factor: mfaFactor, code }
    });
    await afterAlternateAuthentication(session);
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
    await afterAlternateAuthentication(session);
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

  async function setupPin() {
    if (!createdSession) return;
    await apiFetch("/auth/pin/setup", { method: "POST", body: { pin: password } });
    onAuthenticated(createdSession);
  }

  return (
    <main className="setup-grid auth-landing-grid">
      <section className="panel auth-card">
        <div className="section-heading">
          <AppIcon className="auth-brand-icon" />
          <p className="eyebrow">SECURE ACCOUNT ACCESS</p>
          <h1>Welcome to soko.market</h1>
        </div>
        {stage === "entry" || stage === "password" || stage === "pin" ? (
          <>
            {identifierType === "phone" ? (
              <PhoneNumberField
                country={country}
                value={identifier}
                countries={authenticationPhoneCountries}
                onCountryChange={setCountry}
                onValueChange={setIdentifier}
              />
            ) : identifierType === "email" ? (
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </label>
            ) : (
              <label>
                Soko ID
                <input
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder="254A00000001"
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
            {stage === "pin" ? (
              <label>
                4-digit PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/gu, ""))}
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={
                busy ||
                !identifier.trim() ||
                (stage === "password" && !password) ||
                (stage === "pin" && pin.length !== 4)
              }
              aria-busy={busy}
              onClick={() =>
                void run(stage === "password" ? login : stage === "pin" ? submitPin : continueIdentifier)
              }
            >
              {busy ? "Working…" : stage === "password" ? "Sign in" : "Continue"}
            </button>
            {stage === "pin" ? (
              <p className="setup-status">
                By continuing, you agree to our <a href="/terms">Terms of Service</a> and{" "}
                <a href="/privacy">Privacy Policy</a>.
              </p>
            ) : null}
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
            {stage !== "password" ? (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setIdentifierType(
                    identifierType === "phone" ? "email" : identifierType === "email" ? "store" : "phone"
                  );
                  setIdentifier("");
                  setStage("entry");
                }}
              >
                {identifierType === "phone"
                  ? "Use email instead"
                  : identifierType === "email"
                    ? "Use store ID instead"
                    : "Use phone instead"}
              </button>
            ) : null}
            {identifierType !== "store" ? (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void run(usePasskey)}
              >
                Use a passkey instead
              </button>
            ) : null}
            {stage !== "password" && identifierType !== "store" ? (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setPassword("");
                  setStage("password");
                  setMessage("Use your password fallback if this account has one.");
                }}
              >
                Use a password instead
              </button>
            ) : null}
            {identifierType !== "store" ? (
              <button
                className="secondary"
                type="button"
                disabled={!identifier.trim() || busy}
                onClick={() => void run(startRecovery)}
              >
                Trouble signing in?
              </button>
            ) : null}
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
        {stage === "name" ? (
          <>
            <h2>What should we call you?</h2>
            <label>
              Display name
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !displayName.trim()}
              aria-busy={busy}
              onClick={() => void run(submitDisplayName)}
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </>
        ) : null}
        {stage === "secure" && createdSession ? (
          <>
            <h2>Make return access effortless</h2>
            {secureOffer === "passkey" ? (
              <>
                <p>
                  Create a passkey for this device. It works with your device unlock and provides
                  passwordless return access.
                </p>
                <button type="button" disabled={busy} onClick={() => void run(createPasskey)}>
                  Create passkey
                </button>
              </>
            ) : (
              <>
                <p>Choose a 4-digit PIN so your next sign-in is even faster.</p>
                <label>
                  New PIN
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
                  onClick={() => void run(setupPin)}
                >
                  Set PIN
                </button>
              </>
            )}
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => onAuthenticated(createdSession)}
            >
              Skip for now
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
          Browse marketplace without an account
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
