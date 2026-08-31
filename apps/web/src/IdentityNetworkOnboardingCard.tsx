import { useMemo, useState } from "react";

import { postJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import {
  contactPickerContactToNetworkContact,
  getContactDisplayName
} from "./NetworkSyncNestedCard";
import type {
  ContactPickerContact,
  ContactPickerNavigator,
  NetworkGraphSummary,
  OAuthProviderSummary,
  SessionResponse,
  SocialSignupProvider
} from "./soko-application-shared";

export function IdentityNetworkOnboardingCard({
  session,
  graph,
  oauthProviders,
  oauthProvidersLoaded,
  onSessionChange,
  onGoogleContacts,
  onPhoneContactsSync
}: {
  session: SessionResponse;
  graph: NetworkGraphSummary | null;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  onSessionChange: (session: SessionResponse) => void;
  onGoogleContacts: (
    provider: SocialSignupProvider,
    purpose?: "identity" | "contacts"
  ) => Promise<void>;
  onPhoneContactsSync: (
    selectedContacts: ContactPickerContact[]
  ) => Promise<NetworkGraphSummary | null>;
}) {
  const verifiedEmail =
    session.user.emailVerificationStatus === "verified"
      ? session.user.emailAddress?.trim() || null
      : session.account.primaryAuthChannel === "email"
        ? session.account.primaryAuthDestination
        : null;
  const [email, setEmail] = useState(verifiedEmail ?? "");
  const [challenge, setChallenge] = useState<{
    id: string;
    mergeRequired: boolean;
  } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const hasSeedNetwork =
    graph?.nodes?.some((node) => node.degree === 1 && node.sourceId !== null) ?? false;
  const isGmail = verifiedEmail !== null && /@(gmail|googlemail)\.com$/i.test(verifiedEmail);
  const googleConfigured =
    oauthProvidersLoaded &&
    oauthProviders.some(
      (provider) =>
        provider.id === "google" &&
        provider.configured &&
        provider.enabled !== false &&
        provider.implemented !== false
    );
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email]);

  if (dismissed || (verifiedEmail !== null && hasSeedNetwork)) return null;

  async function startEmailLink() {
    if (!emailValid) {
      setMessage("Enter a valid email address.");
      return;
    }
    setWorking(true);
    try {
      const response = await postJson<{
        challengeId: string;
        developmentCode?: string;
        mergeRequired: boolean;
      }>("/auth/identity/email/start", { email: email.trim() });
      setChallenge({ id: response.challengeId, mergeRequired: response.mergeRequired });
      setCode(response.developmentCode ?? "");
      setMessage(
        response.mergeRequired
          ? "That address belongs to another Soko account. Verify it to safely join the accounts."
          : "We sent a verification code to that address."
      );
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function verifyEmailLink() {
    if (challenge === null || code.trim().length === 0) return;
    setWorking(true);
    try {
      if (challenge.mergeRequired) {
        const merged = await postJson<SessionResponse>("/auth/identity/email/merge/verify", {
          challengeId: challenge.id,
          code: code.trim()
        });
        onSessionChange(merged);
      } else {
        const result = await postJson<{
          verified: true;
          identityLevel: "verified_contact" | "strong";
        }>("/auth/identity/email/verify", {
          challengeId: challenge.id,
          code: code.trim()
        });
        onSessionChange({
          ...session,
          account: { ...session.account, identityLevel: result.identityLevel },
          user: {
            ...session.user,
            emailAddress: email.trim(),
            emailVerificationStatus: "verified"
          }
        });
      }
      setChallenge(null);
      setCode("");
      setMessage("Email verified and linked. You can now seed your private network.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function importPhoneContacts() {
    const contactNavigator = navigator as ContactPickerNavigator;
    if (contactNavigator.contacts?.select === undefined) {
      setMessage("The contact picker is not available on this device or browser.");
      return;
    }
    setWorking(true);
    try {
      const contacts = await contactNavigator.contacts.select(["name", "tel", "email"], {
        multiple: true
      });
      const usable = contacts.filter(
        (contact) =>
          getContactDisplayName(contact).length > 0 &&
          contactPickerContactToNetworkContact(contact) !== null
      );
      if (usable.length === 0) {
        setMessage("No contacts were selected.");
        return;
      }
      await onPhoneContactsSync(usable);
      setMessage(`${usable.length} phonebook contact${usable.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="identity-network-onboarding" aria-labelledby="identity-network-title">
      <div>
        <p className="eyebrow">Start your network</p>
        <h2 id="identity-network-title">
          {verifiedEmail === null
            ? "Link an email to your Soko account"
            : "Add your first contacts"}
        </h2>
        <p>
          {verifiedEmail === null
            ? "Verify a valid email so this account is recoverable and connected to you."
            : `Your verified address ${verifiedEmail} is linked. Choose which contacts Soko may add as the first point of your private network.`}
        </p>
      </div>

      {verifiedEmail === null ? (
        <form
          className="identity-network-email-form"
          onSubmit={(event) => {
            event.preventDefault();
            void (challenge === null ? startEmailLink() : verifyEmailLink());
          }}
        >
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (challenge !== null) {
                  setChallenge(null);
                  setCode("");
                }
              }}
              placeholder="you@example.com"
            />
          </label>
          {challenge !== null ? (
            <label>
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          ) : null}
          <button
            type="submit"
            disabled={working || !emailValid || (challenge !== null && !code.trim())}
          >
            {working
              ? "Working…"
              : challenge === null
                ? "Send verification code"
                : "Verify and link"}
          </button>
        </form>
      ) : (
        <div className="identity-network-actions">
          {isGmail ? (
            <button
              type="button"
              disabled={working || !googleConfigured}
              title={googleConfigured ? undefined : "Google Contacts is not configured yet."}
              onClick={() => void onGoogleContacts("google", "contacts")}
            >
              Import Google Contacts
            </button>
          ) : null}
          <button
            type="button"
            className="secondary"
            disabled={working}
            onClick={() => void importPhoneContacts()}
          >
            Choose phonebook contacts
          </button>
        </div>
      )}

      <small>
        Contact access is optional and only starts after you choose a source and approve its
        permission.
      </small>
      {message ? <p className="setup-status">{message}</p> : null}
      <button className="identity-network-dismiss" type="button" onClick={() => setDismissed(true)}>
        Not now
      </button>
    </section>
  );
}
