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
  const [recoveryMfaCode, setRecoveryMfaCode] = useState("");
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
        {stage === "recovery-reset" ? (
          <>
            <h2>Verify and choose a new password</h2>
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
              type="button"
              disabled={
                busy || !code.trim() || password.length < 10 || password !== passwordConfirmation
              }
              aria-busy={busy}
              onClick={() => void run(verifyAndResetPassword)}
            >
              {busy ? "Working…" : "Reset password"}
            </button>
          </>
        ) : null}
        {stage === "reset-pin" ? (
          <>
            <h2>Choose a new PIN</h2>
            <p>Your identity is verified. Set the PIN you will sign in with from now on.</p>
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
              aria-busy={busy}
              onClick={() => void run(finishPinRecovery)}
            >
              {busy ? "Working…" : "Save new PIN"}
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
