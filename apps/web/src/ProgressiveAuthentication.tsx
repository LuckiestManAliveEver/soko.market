import { useEffect, useState } from "react";
import type { AuthSessionView } from "@soko/shared-types";
import { AppIcon } from "./AppIcon";
import { commitDeviceRecoveryCredential, prepareDeviceRecoveryCredential } from "./device-recovery";
import { apiFetch } from "./lib/api";
import { recordOnboardingEvent } from "./performance";

const continueRequestKeyStorage = "soko.market.continue-request.v1";
const continueRequestKeyTtlMs = 10 * 60 * 1000;

interface Props {
  onAuthenticated: (session: AuthSessionView) => void;
  onSignUp: () => void;
  onLogIn: () => void;
}

export function ProgressiveAuthentication({ onAuthenticated, onSignUp, onLogIn }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    recordOnboardingEvent("first_launch_viewed");
  }, []);

  async function continueToSoko() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage("");
    recordOnboardingEvent("continue_clicked");
    try {
      if (!navigator.onLine) {
        throw new Error("offline");
      }
      const requestKey = readOrCreateContinueRequestKey();
      const deviceCredential = await prepareDeviceRecoveryCredential();
      const session = await apiFetch<AuthSessionView>("/auth/continue", {
        method: "POST",
        body: { devicePublicKeyJwk: deviceCredential.publicKeyJwk },
        idempotencyKey: requestKey,
        skipAuthRefresh: true
      });
      if (session.deviceRecoveryCredentialId === undefined) {
        throw new Error("Device recovery was not established.");
      }
      await commitDeviceRecoveryCredential(session.deviceRecoveryCredentialId);
      clearContinueRequestKey();
      recordOnboardingEvent("device_account_created");
      onAuthenticated(session);
    } catch {
      setFailed(true);
      setMessage("Couldn't open Soko. Check your connection and try again.");
      recordOnboardingEvent("continue_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-grid auth-landing-grid progressive-auth" aria-busy={busy}>
      <section className="panel auth-card progressive-auth-card" aria-labelledby="soko-welcome">
        <div className="auth-brand">
          <AppIcon className="auth-brand-icon" />
          <h1 id="soko-welcome">Soko</h1>
          <p>Commerce through chat</p>
        </div>
        <button
          className="progressive-continue-button"
          type="button"
          disabled={busy}
          onClick={() => void continueToSoko()}
        >
          {busy ? "Opening Soko…" : failed ? "Try again" : "Continue to Soko"}
        </button>
        {message ? (
          <p className="setup-error auth-status" role="alert">
            {message}
          </p>
        ) : null}
        <div className="progressive-account-actions" aria-label="Account access">
          <button type="button" disabled={busy} onClick={onSignUp}>
            Sign up
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={onLogIn}>
            Log in
          </button>
        </div>
        <p className="auth-legal">
          By continuing, you agree to the <a href="/terms">Terms</a> and acknowledge the{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>
    </main>
  );
}

function readOrCreateContinueRequestKey(): string {
  try {
    const stored = JSON.parse(localStorage.getItem(continueRequestKeyStorage) ?? "null") as {
      key?: unknown;
      createdAt?: unknown;
    } | null;
    if (
      stored !== null &&
      typeof stored.key === "string" &&
      /^[A-Za-z0-9_-]{32,128}$/u.test(stored.key) &&
      typeof stored.createdAt === "number" &&
      Date.now() - stored.createdAt >= 0 &&
      Date.now() - stored.createdAt < continueRequestKeyTtlMs
    ) {
      return stored.key;
    }
  } catch {
    // Storage can be unavailable in private/locked-down contexts; the cookie still authenticates.
  }

  const key =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) =>
          value.toString(16).padStart(2, "0")
        ).join("");
  try {
    localStorage.setItem(continueRequestKeyStorage, JSON.stringify({ key, createdAt: Date.now() }));
  } catch {
    // A single live request remains safe even when retry persistence is unavailable.
  }
  return key;
}

function clearContinueRequestKey(): void {
  try {
    localStorage.removeItem(continueRequestKeyStorage);
  } catch {
    // The short-lived server record expires independently.
  }
}
