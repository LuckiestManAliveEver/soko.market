import { useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { AuthSessionView } from "@soko/shared-types";
import { normalizePhoneInput, phoneNormalizationErrorMessage } from "@soko/shared-types";
import { getCountryCallingCode, type CountryCode } from "libphonenumber-js";
import { apiFetch } from "./lib/api";
import { AppIcon } from "./AppIcon";
import { PhoneNumberField, authenticationPhoneCountries } from "./PhoneNumberField";
import { getUserFacingErrorMessage } from "./user-facing-error";

type Stage = "entry" | "pin" | "password" | "mfa" | "recovery-reset" | "reset-pin";
type IdentifierType = "phone" | "email" | "store";

export interface RememberedAccount {
  type: "phone" | "email";
  identifier: string;
  label: string;
}

interface Props {
  intent: "signup" | "login";
  remembered: RememberedAccount | null;
  onAuthenticated: (session: AuthSessionView) => void;
  onIntentChange: (intent: "signup" | "login") => void;
  onForgetRemembered: () => void;
  onCancel: () => void;
}

export function PhoneFirstAuthentication({
  intent,
  remembered,
  onAuthenticated,
  onIntentChange,
  onForgetRemembered,
  onCancel
}: Props) {
  // A returning visit on this browser, for the same account, skips straight to a PIN-only
  // screen - no need to retype the phone/email that already got them here once. "Not you?"
  // (further down) drops back to normal identifier entry within the same mount.
  const startsWithRemembered = intent === "login" && remembered !== null;
  const [usingRemembered, setUsingRemembered] = useState(startsWithRemembered);
  const [identifierType, setIdentifierType] = useState<IdentifierType>(remembered?.type ?? "phone");
  const [country, setCountry] = useState<CountryCode>("KE");
  const [identifier, setIdentifier] = useState(startsWithRemembered ? (remembered?.identifier ?? "") : "");
  const [stage, setStage] = useState<Stage>(startsWithRemembered ? "pin" : "entry");
  const [transactionId, setTransactionId] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [legacyPin, setLegacyPin] = useState(false);
  const [recoveryMfaCode, setRecoveryMfaCode] = useState("");
  const [mfaFactor, setMfaFactor] = useState<"totp" | "recovery_code">("totp");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    startsWithRemembered ? "Enter the PIN for your existing Soko account." : ""
  );

  function useDifferentAccount() {
    setUsingRemembered(false);
    setIdentifier("");
    setPin("");
    setStage("entry");
    setMessage("");
    onForgetRemembered();
  }

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
        : "Enter the PIN for your existing Soko account."
    );
  }

  async function submitPin() {
    if (intent === "signup" && pin !== pinConfirmation) {
      setMessage("The PINs do not match. Enter the same 4 digits again.");
      return;
    }
    // A remembered identifier is already normalized (it came straight from the account's
    // primaryAuthDestination on a previous successful login), so it skips identifierBody()'s
    // phone parsing, which needs a country hint this screen no longer collects.
    const normalized = usingRemembered
      ? { identifier: remembered!.identifier }
      : identifierBody();
    const result = await apiFetch<AuthSessionView>(
      intent === "signup"
        ? "/auth/pin/signup"
        : identifierType === "store"
          ? "/auth/pin/store-login"
          : "/auth/pin/login",
      {
        method: "POST",
        body:
          identifierType === "store"
            ? { sokoId: normalized.identifier, pin }
            : {
                method: identifierType,
                contact: normalized.identifier,
                ...(identifierType === "phone" && !usingRemembered ? { country } : {}),
                pin
              }
      }
    );
    onAuthenticated(result);
  }

  // Lets someone who landed on the signup screen but already has an account log in without
  // losing what they typed - same identifier field, a second button instead of navigating away
  // (which would otherwise reset this form, per the `key={authenticationView}` remount at the
  // call site).
  async function loginInsteadOfSignup() {
    const normalized = identifierBody();
    const result = await apiFetch<AuthSessionView>(
      identifierType === "store" ? "/auth/pin/store-login" : "/auth/pin/login",
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
    onAuthenticated(result);
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
      onAuthenticated(result as AuthSessionView);
    }
  }

  async function verifyMfa() {
    const session = await apiFetch<AuthSessionView>("/auth/mfa/verify", {
      method: "POST",
      body: { transactionId, factor: mfaFactor, code }
    });
    onAuthenticated(session);
  }

  // Step 1 of recovery: prove identity. Phone accounts have no SMS channel, so identity is
  // proven with a passkey right here, before anything about a new credential is asked - the same
  // "authenticate first" order a phone's biometric unlock uses. Email/store accounts prove
  // identity with an emailed code instead, entered together with the new password in step 2.
  async function startRecovery() {
    if (identifierType === "phone") {
      if (!browserSupportsWebAuthn()) {
        setMessage(
          "Passkey recovery isn't available in this browser. Try Chrome, Safari, or Edge, or contact support."
        );
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
      setPassword("");
      setPasswordConfirmation("");
      setStage("reset-pin");
      setMessage("Identity verified. Choose a new PIN.");
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
    setPassword("");
    setPasswordConfirmation("");
    setRecoveryMfaCode("");
    setStage("recovery-reset");
    setMessage(result.message);
  }

  // Step 2 of recovery for email/store accounts: verify the emailed code and set the new
  // password in one action, instead of two separate screens.
  async function verifyAndResetPassword() {
    await apiFetch("/auth/recovery/verify", { method: "POST", body: { transactionId, code } });
    const session = await apiFetch<AuthSessionView>("/auth/recovery/reset-password", {
      method: "POST",
      body: {
        transactionId,
        password,
        passwordConfirmation,
        ...(recoveryMfaCode ? { mfaCode: recoveryMfaCode } : {})
      }
    });
    onAuthenticated(session);
  }

  // Step 2 of recovery for phone accounts: identity was already proven by the passkey in
  // startRecovery, so this only sets the new PIN.
  async function finishPinRecovery() {
    if (!/^\d{4}$/u.test(password) || password !== passwordConfirmation) {
      setMessage("Enter and confirm a new 4-digit PIN.");
      return;
    }
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

  function goBack() {
    setMessage("");
    if (stage === "entry") {
      onCancel();
      return;
    }
    if (stage === "mfa") {
      setStage("password");
      return;
    }
    setStage("entry");
  }

  const isCredentialEntry = stage === "entry" || stage === "password" || stage === "pin";
  const stepNumber = stage === "entry" ? 1 : 2;
  const stepTotal = 2;
  const heading =
    stage === "entry"
      ? intent === "signup"
        ? "Create your account"
        : "Welcome back"
      : stage === "pin"
        ? "Enter your PIN"
        : stage === "password"
          ? "Log in with password"
          : stage === "mfa"
            ? "Security check"
            : stage === "reset-pin"
              ? "Choose a new PIN"
              : "Recover your account";

  return (
    <main className="auth-onboarding" aria-busy={busy}>
      <section className="auth-onboarding-card" aria-labelledby="auth-onboarding-title">
        <header className="auth-onboarding-header">
          <button className="auth-back-button" type="button" onClick={goBack} aria-label="Back">
            <span aria-hidden="true">←</span>
          </button>
          <div className="auth-wordmark">
            <AppIcon className="auth-wordmark-icon" />
            <span>soko.market</span>
          </div>
          <span className="auth-header-spacer" aria-hidden="true" />
        </header>

        <div className="auth-onboarding-content">
          {intent === "login" ? (
            <div className="auth-progress" aria-label={`Step ${stepNumber} of ${stepTotal}`}>
              {Array.from({ length: stepTotal }, (_, index) => (
                <span className={index < stepNumber ? "complete" : ""} key={index} />
              ))}
            </div>
          ) : null}
          <div className="auth-onboarding-heading">
            <p className="eyebrow">{intent === "signup" ? "CREATE YOUR ACCOUNT" : "LOG IN"}</p>
            <h1 id="auth-onboarding-title">{heading}</h1>
            <p>
              {stage === "entry"
                ? intent === "signup"
                  ? "Enter your phone number and choose the 4-digit PIN you will use to log in. SMS verification is not used."
                  : "Use your phone number, email, or Soko ID to get back to your conversations."
                : message}
            </p>
          </div>

          {intent === "login" && stage === "entry" ? (
            <div className="auth-method-tabs" role="tablist" aria-label="Login method">
              {(["phone", "email", "store"] as const).map((method) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={identifierType === method}
                  className={identifierType === method ? "active" : ""}
                  key={method}
                  onClick={() => {
                    setIdentifierType(method);
                    setIdentifier("");
                    setMessage("");
                  }}
                >
                  {method === "phone" ? "Phone" : method === "email" ? "Email" : "Soko ID"}
                </button>
              ))}
            </div>
          ) : null}

          {isCredentialEntry ? (
            <div className="auth-fields">
              {usingRemembered ? (
                <div className="auth-remembered-account">
                  <p>
                    Continuing as <strong>{remembered?.label}</strong>
                  </p>
                  <button className="auth-text-button" type="button" onClick={useDifferentAccount}>
                    Not you? Use a different account
                  </button>
                </div>
              ) : identifierType === "phone" ? (
                <PhoneNumberField
                  country={country}
                  value={identifier}
                  countries={authenticationPhoneCountries}
                  onCountryChange={setCountry}
                  onValueChange={setIdentifier}
                  autoFocus={stage === "entry"}
                />
              ) : identifierType === "email" ? (
                <label>
                  Email address
                  <input
                    autoFocus
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                  />
                </label>
              ) : (
                <label>
                  Soko ID
                  <input
                    autoFocus
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
                    autoFocus
                    type="password"
                    inputMode={legacyPin ? "numeric" : undefined}
                    maxLength={legacyPin ? 4 : 256}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              ) : null}
              {stage === "pin" || (intent === "signup" && stage === "entry") ? (
                <label className="auth-pin-field">
                  4-digit PIN
                  <input
                    autoFocus={stage === "pin"}
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="[0-9]*"
                    autoComplete={intent === "signup" ? "new-password" : "current-password"}
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/gu, ""))}
                  />
                  <span className="auth-pin-dots" aria-hidden="true">
                    {[0, 1, 2, 3].map((index) => (
                      <i className={index < pin.length ? "filled" : ""} key={index} />
                    ))}
                  </span>
                </label>
              ) : null}
              {intent === "signup" && stage === "entry" ? (
                <label className="auth-pin-field">
                  Confirm 4-digit PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="[0-9]*"
                    autoComplete="new-password"
                    value={pinConfirmation}
                    onChange={(event) => setPinConfirmation(event.target.value.replace(/\D/gu, ""))}
                  />
                  <span className="auth-pin-dots" aria-hidden="true">
                    {[0, 1, 2, 3].map((index) => (
                      <i className={index < pinConfirmation.length ? "filled" : ""} key={index} />
                    ))}
                  </span>
                </label>
              ) : null}
              <div
                className={intent === "signup" && stage === "entry" ? "auth-button-row" : undefined}
              >
                <button
                  className="auth-primary-button"
                  type="button"
                  disabled={
                    busy ||
                    !identifier.trim() ||
                    (intent === "signup" &&
                      stage === "entry" &&
                      (pin.length !== 4 || pinConfirmation.length !== 4)) ||
                    (stage === "password" && !password) ||
                    (stage === "pin" && pin.length !== 4)
                  }
                  aria-busy={busy}
                  onClick={() =>
                    void run(
                      stage === "password"
                        ? login
                        : stage === "pin"
                          ? submitPin
                          : intent === "signup"
                            ? submitPin
                            : continueIdentifier
                    )
                  }
                >
                  {busy
                    ? "Please wait…"
                    : stage === "password"
                      ? "Log in"
                      : stage === "pin"
                        ? "Log in"
                        : intent === "signup"
                          ? "Create account"
                          : "Continue to log in"}
                </button>
                {intent === "signup" && stage === "entry" ? (
                  <button
                    className="auth-secondary-button"
                    type="button"
                    disabled={busy || !identifier.trim() || pin.length !== 4}
                    aria-busy={busy}
                    onClick={() => void run(loginInsteadOfSignup)}
                  >
                    Log in instead
                  </button>
                ) : null}
              </div>
              {stage === "password" ? (
                <button
                  className="auth-text-button"
                  type="button"
                  onClick={() => {
                    setLegacyPin((current) => !current);
                    setPassword("");
                  }}
                >
                  {legacyPin ? "Use password" : "Use legacy PIN"}
                </button>
              ) : null}
            </div>
          ) : null}

          {intent === "signup" && stage === "entry" ? (
            <p className="auth-legal">
              By creating an account, you agree to our <a href="/terms">Terms of Service</a> and{" "}
              <a href="/privacy">Privacy Policy</a>.
            </p>
          ) : null}

          {intent === "login" && (stage === "entry" || stage === "pin") ? (
            <div className="auth-alternatives">
              {identifierType !== "store" ? (
                <button type="button" disabled={busy} onClick={() => void run(usePasskey)}>
                  Use a passkey
                </button>
              ) : null}
              {stage === "entry" && identifierType !== "store" ? (
                <button
                  type="button"
                  onClick={() => {
                    setPassword("");
                    setStage("password");
                    setMessage("Use your password fallback if this account has one.");
                  }}
                >
                  Use a password
                </button>
              ) : null}
              {identifierType !== "store" ? (
                <button
                  type="button"
                  disabled={!identifier.trim() || busy}
                  onClick={() => void run(startRecovery)}
                >
                  Trouble logging in?
                </button>
              ) : null}
            </div>
          ) : null}

          {stage === "recovery-reset" ? (
            <div className="auth-fields">
              <label>
                Verification code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
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
                  value={recoveryMfaCode}
                  onChange={(event) => setRecoveryMfaCode(event.target.value)}
                />
              </label>
              <button
                className="auth-primary-button"
                type="button"
                disabled={
                  busy || !code.trim() || password.length < 10 || password !== passwordConfirmation
                }
                aria-busy={busy}
                onClick={() => void run(verifyAndResetPassword)}
              >
                {busy ? "Working…" : "Reset password"}
              </button>
            </div>
          ) : null}
          {stage === "reset-pin" ? (
            <div className="auth-fields">
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
                className="auth-primary-button"
                type="button"
                disabled={busy || !/^\d{4}$/u.test(password) || password !== passwordConfirmation}
                aria-busy={busy}
                onClick={() => void run(finishPinRecovery)}
              >
                {busy ? "Working…" : "Save new PIN"}
              </button>
            </div>
          ) : null}
          {stage === "mfa" ? (
            <div className="auth-fields">
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
              <button
                className="auth-primary-button"
                type="button"
                disabled={busy || !code}
                onClick={() => void run(verifyMfa)}
              >
                Verify and sign in
              </button>
            </div>
          ) : null}

          {message && stage === "entry" ? (
            <p className="auth-feedback" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
          {intent === "login" ? (
            <>
              <div className="auth-intent-switch">
                <span>New to Soko?</span>
                <button
                  className="auth-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => onIntentChange("signup")}
                >
                  Create an account
                </button>
              </div>
              <button className="auth-guest-button" type="button" onClick={onCancel}>
                Continue to marketplace as guest
              </button>
            </>
          ) : null}
        </div>
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
