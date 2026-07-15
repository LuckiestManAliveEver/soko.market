import { lazy, Suspense, type ReactNode } from "react";
import { readOwnerRoute, routes } from "./routes";

const TermsOfServicePage = lazy(() => import("./legal/TermsOfServicePage"));
const PrivacyPolicyPage = lazy(() => import("./legal/PrivacyPolicyPage"));
const AccountDeletionPage = lazy(() => import("./legal/AccountDeletionPage"));
const OwnerApp = lazy(() =>
  import("./SokoApplication").then((module) => ({ default: module.OwnerApp }))
);
const PublicStorefront = lazy(() =>
  import("./SokoApplication").then((module) => ({ default: module.PublicStorefrontChat }))
);

export function AppRouter() {
  const storefrontAgentId = readStorefrontAgentId();

  if (storefrontAgentId !== null) {
    return <LazyRoute page={<PublicStorefront agentId={storefrontAgentId} />} />;
  }

  if (window.location.pathname === routes.terms) {
    return <LegalRoute label="Terms of Service" page={<TermsOfServicePage />} />;
  }

  if (window.location.pathname === routes.privacy) {
    return <LegalRoute label="Privacy Policy" page={<PrivacyPolicyPage />} />;
  }

  if (window.location.pathname === routes.accountDeletion) {
    return <LegalRoute label="account deletion" page={<AccountDeletionPage />} />;
  }

  if (
    readOwnerRoute(window.location.pathname) === null &&
    window.location.pathname !== routes.oauthCallback
  ) {
    return (
      <main className="legal-placeholder">
        <h1>Destination unavailable</h1>
        <p>This address does not match a Soko.market page.</p>
        <a href={routes.marketplace}>Return to the marketplace</a>
      </main>
    );
  }

  return <LazyRoute page={<OwnerApp />} />;
}

function LazyRoute({ page }: { page: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="legal-placeholder" aria-busy="true">
          <p>Loading Soko.market…</p>
        </main>
      }
    >
      {page}
    </Suspense>
  );
}

function LegalRoute({ label, page }: { label: string; page: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="legal-placeholder" aria-busy="true">
          <p>Loading {label}…</p>
        </main>
      }
    >
      {page}
    </Suspense>
  );
}

export function readStorefrontAgentId(): string | null {
  const pathname = window.location.pathname;
  const match =
    pathname.match(/^\/agent\/([^/]+)\/?$/) ??
    pathname.match(/^\/(?:shop|shops|soko)\/([^/]+)\/?$/) ??
    pathname.match(/^(\/(?:\+?\d{1,3}-?[A-Za-z]\d{8}))\/?$/);

  if (match === null) return null;

  const rawAgentId = (match[1] ?? "").replace(/^\//, "");
  let agentId: string;
  try {
    agentId = decodeURIComponent(rawAgentId).trim();
  } catch {
    return null;
  }

  if (agentId.length === 0) return null;

  if (!pathname.startsWith("/agent/")) {
    const canonicalAgentId = isSokoId(agentId) ? normalizeSokoId(agentId) : agentId;
    window.history.replaceState(
      null,
      "",
      `${routes.publicAgent(canonicalAgentId)}${window.location.search}`
    );
  }

  return agentId;
}

function isSokoId(value: unknown): value is string {
  return typeof value === "string" && /^\+?\d{1,3}-?[A-Za-z]\d{8}$/.test(value.trim());
}

function normalizeSokoId(value: string): string {
  const compact = value.trim().replace(/-/g, "");
  return compact.startsWith("+") ? compact.slice(1) : compact;
}
