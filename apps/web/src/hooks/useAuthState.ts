import { useRef, useState } from "react";

import type {
  AccountShopSummary,
  AuthBootstrapResponse,
  AuthBootstrapState,
  SokoChatSurface,
  SokoSessionContext
} from "@soko/shared-types";

import type { AccountRestorationResult } from "../features/account-restoration/AccountRestorationPanel";
import type { ShellView, SokoMode } from "../app-shell";
import {
  clearCachedAuthSession,
  readCachedAuthSession,
  saveCachedAuthSession
} from "../auth-bootstrap";
import { getJson, patchJson, postJson } from "../api-helpers";
import { navigateToBrowserUrl, navigateToOwnerRoute } from "../browser-navigation";
import { getErrorMessage, logAuthenticationLifecycle } from "../chat-message-plumbing";
import { inferCountryCode } from "../country-dial-codes";
import { shellViewForSurface } from "../cross-device-session-context";
import { recoverDeviceAccount } from "../device-recovery";
import {
  ApiRequestError,
  apiFetch,
  isDefinitiveAuthenticationError,
  isRetryableApiRequestError
} from "../lib/api";
import {
  createDefaultAgent,
  readPendingOAuthLogin,
  readStoredBusiness
} from "../owner-app-bootstrap";
import { authenticationRoute, routes } from "../routes";
import {
  activeAgentStorageKey,
  activeBusinessStorageKey,
  activeModeStorageKey,
  guestBrowsingStorageKey,
  ownerAuthStorageKey,
  pendingOAuthStorageKey,
  setupDraftStorageKey,
  socialSignupProviders,
  type ActiveBusiness,
  type AgentSettings,
  type CountryDialCode,
  type NetworkGraphSummary,
  type OAuthProviderSummary,
  type OAuthProvidersResponse,
  type OAuthStartResponse,
  type OwnerAuthRecord,
  type PendingOAuthLogin,
  type RoleCheckResponse,
  type SessionResponse,
  type SocialSignupProvider
} from "../soko-application-shared";

interface UseAuthStateDeps {
  business: ActiveBusiness | null;
  setBusiness: (business: ActiveBusiness | null) => void;
  setSession: (
    session: SessionResponse | null | ((current: SessionResponse | null) => SessionResponse | null)
  ) => void;
  sokoSessionContext: SokoSessionContext | null;
  setSokoSessionContext: (context: SokoSessionContext | null) => void;
  setAgentSettings: (agent: AgentSettings) => void;
  setMode: (mode: SokoMode) => void;
  setView: (view: ShellView) => void;
  setStatusMessage: (message: string) => void;
  setNetworkGraph: (graph: NetworkGraphSummary) => void;
  navigateToView: (nextView: ShellView, options?: { replace?: boolean; mode?: SokoMode }) => void;
  loadMarketplaceIntroState: () => Promise<void>;
  validateStoredBusiness: () => Promise<void>;
  accountDeletionIntent: boolean;
  accountRestorationIntent: boolean;
  initialAuthenticationTarget: "signup" | "login" | null;
  initialCountryCode: CountryDialCode;
  initialOwnerAuth: OwnerAuthRecord | null;
  registerReset: (domainKey: string, fn: () => void) => void;
}

export function useAuthState(deps: UseAuthStateDeps) {
  const initialCachedSession = readCachedAuthSession();
  const [authBootstrapState, setAuthBootstrapState] = useState<AuthBootstrapState>(
    initialCachedSession === null ? "initializing" : "offline-authenticated"
  );
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderSummary[]>([]);
  const [oauthProvidersLoaded, setOauthProvidersLoaded] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(
    deps.accountDeletionIntent ||
      deps.accountRestorationIntent ||
      deps.initialAuthenticationTarget !== null
  );
  const [authenticationView, setAuthenticationView] = useState<"signup" | "login">(
    deps.initialAuthenticationTarget ?? (deps.initialOwnerAuth !== null ? "login" : "signup")
  );
  const [isAccountRestorationOpen, setIsAccountRestorationOpen] = useState(
    deps.accountRestorationIntent
  );
  const sessionRefreshInFlightRef = useRef<Promise<SessionResponse | null> | null>(null);

  const {
    business,
    setBusiness,
    setSession,
    sokoSessionContext,
    setSokoSessionContext,
    setAgentSettings,
    setMode,
    setView,
    setStatusMessage,
    setNetworkGraph,
    navigateToView,
    loadMarketplaceIntroState,
    validateStoredBusiness,
    accountDeletionIntent,
    accountRestorationIntent,
    initialAuthenticationTarget,
    initialCountryCode,
    initialOwnerAuth
  } = deps;

  function forgetRememberedOwnerAuth() {
    localStorage.removeItem(ownerAuthStorageKey);
  }

  async function handleOAuthCallback(): Promise<boolean> {
    if (window.location.pathname !== routes.oauthCallback) {
      return false;
    }

    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code");
    const state = parameters.get("state");
    const pendingOAuth = readPendingOAuthLogin();

    if (code === null || state === null || pendingOAuth === null || state !== pendingOAuth.state) {
      setStatusMessage("Social sign-in could not be verified. Please try again.");
      sessionStorage.removeItem(pendingOAuthStorageKey);
      navigateToBrowserUrl(routes.marketplace, { replace: true });
      return true;
    }

    try {
      const response = await postJson<SessionResponse>("/auth/oauth/callback", {
        provider: pendingOAuth.provider,
        state,
        code,
        csrfToken: pendingOAuth.csrfToken
      });
      sessionStorage.removeItem(pendingOAuthStorageKey);
      navigateToBrowserUrl(routes.marketplace, { replace: true });
      await completeOAuthSession(response, pendingOAuth.provider, pendingOAuth.purpose);
    } catch (error) {
      sessionStorage.removeItem(pendingOAuthStorageKey);
      navigateToBrowserUrl(routes.marketplace, { replace: true });
      setStatusMessage(getErrorMessage(error));
    }

    return true;
  }

  async function loadOAuthProviders() {
    try {
      const response = await getJson<OAuthProvidersResponse>("/auth/oauth/providers");
      setOauthProviders(response.providers);
    } catch {
      setOauthProviders([]);
    } finally {
      setOauthProvidersLoaded(true);
    }
  }

  function acceptAuthenticatedSession(response: SessionResponse) {
    sessionStorage.removeItem(guestBrowsingStorageKey);
    logAuthenticationLifecycle("session_response_received", response);
    setSession(response);
    saveCachedAuthSession(response);
    logAuthenticationLifecycle("frontend_session_stored", response);
    setAuthBootstrapState("authenticated");
    setIsAuthOpen(false);
  }

  function completePhoneFirstAuthentication(response: SessionResponse) {
    acceptAuthenticatedSession(response);

    const nextOwnerAuth: OwnerAuthRecord = {
      contact: response.account.primaryAuthDestination,
      countryCode:
        response.account.primaryAuthChannel === "phone"
          ? (inferCountryCode(response.account.primaryAuthDestination) ?? initialCountryCode)
          : initialCountryCode
    };
    localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
    setIsAuthOpen(false);
    logAuthenticationLifecycle("redirect_issued", response);
    navigateToView("chat", { replace: true, mode: "marketplace" });
    setStatusMessage("Authentication complete");
  }

  async function completeOAuthSession(
    response: SessionResponse,
    provider: SocialSignupProvider,
    purpose: "identity" | "contacts" = "identity"
  ) {
    const selectedProvider = socialSignupProviders.find((item) => item.id === provider);
    acceptAuthenticatedSession(response);
    let networkStatus = "";

    if (provider === "google" && purpose !== "contacts") {
      networkStatus =
        " Google identity linked; contacts remain private until you choose to import them.";
    } else {
      try {
        const graph = await postJson<NetworkGraphSummary>(
          `/network/providers/${encodeURIComponent(provider)}/sync`,
          {}
        );
        setNetworkGraph(graph);
        networkStatus = " Network source connected.";
      } catch (error) {
        networkStatus = ` Network sync needs attention: ${getErrorMessage(error)}`;
      }
    }

    if (business !== null) {
      const roleCheck = await postJson<RoleCheckResponse>("/roles/check", {
        businessId: business.id,
        role: "owner"
      });

      if (!roleCheck.allowed) {
        setStatusMessage("This social profile is not linked to this Soko shop yet");
        return;
      }

      const nextOwnerAuth: OwnerAuthRecord = {
        contact: `oauth:${provider}:${response.account.id}`,
        countryCode: initialCountryCode,
        provider
      };
      localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
      navigateToView("chat", { replace: true });
      setStatusMessage(`${selectedProvider?.label ?? "Social"} login complete.${networkStatus}`);
      return;
    }

    const nextOwnerAuth: OwnerAuthRecord = {
      contact: `oauth:${provider}:${response.account.id}`,
      countryCode: initialCountryCode,
      provider
    };
    localStorage.setItem(ownerAuthStorageKey, JSON.stringify(nextOwnerAuth));
    localStorage.removeItem(setupDraftStorageKey);
    navigateToView("chat", { replace: true, mode: "marketplace" });
    setIsAuthOpen(false);
    setStatusMessage(
      `${selectedProvider?.label ?? "Social"} signup complete. Browse the marketplace or tap Sell to set up a business.${networkStatus}`
    );
  }

  function requireReauthentication(message = "Sign in to continue") {
    const storedBusiness = readStoredBusiness();
    const nextAuthenticationView =
      initialAuthenticationTarget ?? (initialOwnerAuth === null ? "signup" : "login");

    setSession(null);
    clearCachedAuthSession();
    setAuthBootstrapState("reauthentication-required");
    if (storedBusiness === null) setBusiness(null);
    if (!accountDeletionIntent && !accountRestorationIntent) {
      setIsAuthOpen(true);
      setAuthenticationView(nextAuthenticationView);
      window.history.replaceState(
        window.history.state,
        "",
        authenticationRoute(nextAuthenticationView)
      );
      setStatusMessage(message);
    }
  }

  function rejectDefinitiveAuthenticationFailure(error: unknown): boolean {
    if (!isDefinitiveAuthenticationError(error)) return false;
    requireReauthentication("Your session expired. Sign in to continue.");
    return true;
  }

  function ensureAuthenticatedSession(): Promise<SessionResponse | null> {
    if (sessionRefreshInFlightRef.current !== null) return sessionRefreshInFlightRef.current;

    const refresh = performSessionRefresh().finally(() => {
      sessionRefreshInFlightRef.current = null;
    });
    sessionRefreshInFlightRef.current = refresh;
    return refresh;
  }

  async function performSessionRefresh(): Promise<SessionResponse | null> {
    // "offline-authenticated" is an unverified local cache. Once online it must become pending
    // so no server-backed feature can race the canonical bootstrap request.
    setAuthBootstrapState("restoring-session");
    try {
      const nextSession = await apiFetch<AuthBootstrapResponse>("/auth/bootstrap");
      logAuthenticationLifecycle("authenticated_user_loaded", nextSession);
      setSession(nextSession);
      saveCachedAuthSession(nextSession);
      setAuthBootstrapState("authenticated");
      if (!accountDeletionIntent && !accountRestorationIntent) {
        setIsAuthOpen(false);
        if (initialAuthenticationTarget !== null) {
          navigateToView("chat", { replace: true, mode: "marketplace" });
        }
      }
      setStatusMessage("Session active");
      await loadMarketplaceIntroState();
      await validateStoredBusiness();
      return nextSession;
    } catch (error) {
      const cached = readCachedAuthSession();
      const storedBusiness = readStoredBusiness();
      if (!navigator.onLine && cached !== null && storedBusiness !== null) {
        setSession(cached);
        setBusiness(storedBusiness);
        setAuthBootstrapState("offline-authenticated");
        setIsAuthOpen(false);
        setStatusMessage("Offline workspace restored. Cloud data will refresh after reconnect.");
        return null;
      }

      if (isDefinitiveAuthenticationError(error)) {
        try {
          const recovered = await recoverDeviceAccount();
          if (recovered !== null) {
            logAuthenticationLifecycle("device_account_recovered", recovered);
            setSession(recovered);
            saveCachedAuthSession(recovered);
            setAuthBootstrapState("authenticated");
            setIsAuthOpen(false);
            setStatusMessage("Soko restored this device account.");
            await loadMarketplaceIntroState();
            await validateStoredBusiness();
            return recovered;
          }
        } catch (recoveryError) {
          if (isRetryableApiRequestError(recoveryError)) {
            setAuthBootstrapState("failed");
            setStatusMessage(
              "Soko could not restore this device. Check your connection and retry."
            );
            return null;
          }
        }
        requireReauthentication(
          initialAuthenticationTarget === "signup"
            ? "Create your Soko account."
            : "Sign in to continue"
        );
        return null;
      }

      if (cached !== null) setSession(cached);
      if (storedBusiness !== null) setBusiness(storedBusiness);
      setAuthBootstrapState("failed");
      if (cached === null) {
        setIsAuthOpen(true);
        setAuthenticationView(initialAuthenticationTarget ?? "signup");
      }
      setStatusMessage("Soko could not restore this session. Check your connection and retry.");
      return null;
    }
  }

  async function refreshSession(): Promise<void> {
    await ensureAuthenticatedSession();
  }

  async function authenticateSocialProfile(
    provider: SocialSignupProvider,
    purpose: "identity" | "contacts" = "identity"
  ) {
    const selectedProvider = socialSignupProviders.find((item) => item.id === provider);
    const providerConfig = oauthProviders.find((item) => item.id === provider);

    if (!oauthProvidersLoaded) {
      setStatusMessage("Social sign-in is still loading. Try again in a moment.");
      return;
    }

    if (providerConfig?.implemented === false || providerConfig?.configured !== true) {
      setStatusMessage("This login provider is not configured yet.");
      return;
    }

    try {
      const response = await postJson<OAuthStartResponse>("/auth/oauth/start", {
        provider,
        purpose,
        redirectUri: `${window.location.origin}${routes.oauthCallback}`
      });
      const pendingOAuth: PendingOAuthLogin = {
        csrfToken: response.csrfToken,
        provider: response.provider,
        purpose,
        state: response.state
      };
      sessionStorage.setItem(pendingOAuthStorageKey, JSON.stringify(pendingOAuth));
      setStatusMessage(
        `Redirecting to ${selectedProvider?.label ?? "social"} to continue with your account.`
      );
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    }
  }

  function completeAccountRestoration(result: AccountRestorationResult) {
    const nextBusiness: ActiveBusiness = {
      ...result.business,
      role: result.membership.role
    };
    const nextAgent = createDefaultAgent(nextBusiness);
    setBusiness(nextBusiness);
    setAgentSettings(nextAgent);
    setIsAccountRestorationOpen(false);
    setMode("seller");
    setView("chat");
    localStorage.setItem(activeBusinessStorageKey, JSON.stringify(nextBusiness));
    localStorage.setItem(activeAgentStorageKey, JSON.stringify(nextAgent));
    navigateToOwnerRoute({ mode: "seller", view: "chat" }, { replace: true });
    setStatusMessage("Account restored. Shop access is active again.");
  }

  // Account-authoritative record of where the owner last worked. Device-only state such as model
  // downloads, E2EE private keys, and unsent drafts deliberately stays in browser storage.
  // setActiveConversationId is a call-time argument, not a hook-level dep: it's owned by the Chat
  // domain hook (Phase 16), and this function's only external call site is a still-inline OwnerApp
  // effect that can supply it directly - same pattern used for Sync (Phase 7), Invoices/Logistics
  // (Phase 9), and Runtime history/Network (Phase 16).
  async function loadSokoSessionContext(
    setActiveConversationId: (conversationId: string | null) => void
  ) {
    try {
      const context = await apiFetch<SokoSessionContext>("/v1/session/context");
      setSokoSessionContext(context);
      const activeShop =
        context.shops.find((shop) => shop.business.id === context.activeShopId) ?? context.shops[0];
      const restoredMode =
        context.mode === "seller" && activeShop === undefined ? "marketplace" : context.mode;
      const restoredView = shellViewForSurface(context.activeSurface, restoredMode);

      if (activeShop !== undefined) {
        const nextBusiness: ActiveBusiness = {
          ...activeShop.business,
          role: activeShop.membership.role
        };
        const nextAgent = createDefaultAgent(nextBusiness);
        setBusiness(nextBusiness);
        setAgentSettings(nextAgent);
        localStorage.setItem(activeBusinessStorageKey, JSON.stringify(nextBusiness));
        localStorage.setItem(activeAgentStorageKey, JSON.stringify(nextAgent));
      }

      setMode(restoredMode);
      setView(restoredView);
      setActiveConversationId(context.conversationId);
      localStorage.setItem(activeModeStorageKey, restoredMode);
      navigateToOwnerRoute(
        {
          mode: restoredMode,
          view: restoredView,
          ...(restoredView === "chat" ? { conversationId: context.conversationId } : {})
        },
        { replace: true }
      );
    } catch {
      // Offline launch continues from the device cache and catches up after reconnecting.
    }
  }

  // Restores mode/shop for one specific conversation's own session context (Phase 2 data model),
  // instead of the account-wide default loadSokoSessionContext restores on login. Used when
  // switching between an account's own agent sessions so Buy/Sell mode is per-session, not shared.
  async function applySessionContextForConversation(
    conversationId: string
  ): Promise<SokoMode | null> {
    try {
      const context = await apiFetch<SokoSessionContext>(
        `/v1/session/context?conversationId=${encodeURIComponent(conversationId)}`
      );
      setSokoSessionContext(context);
      const activeShop =
        context.shops.find((shop) => shop.business.id === context.activeShopId) ?? context.shops[0];
      const restoredMode =
        context.mode === "seller" && activeShop === undefined ? "marketplace" : context.mode;
      setMode(restoredMode);
      localStorage.setItem(activeModeStorageKey, restoredMode);
      return restoredMode;
    } catch {
      return null;
    }
  }

  async function patchSokoSessionContext(patch: {
    mode?: SokoMode;
    activeShopId?: string | null;
    activeSurface?: SokoChatSurface;
    conversationId?: string;
  }) {
    if (sokoSessionContext === null) return;
    try {
      const updated = await patchJson<SokoSessionContext>("/v1/session/context", {
        ...patch,
        expectedSessionVersion: sokoSessionContext.sessionVersion
      });
      setSokoSessionContext(updated);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== "session_context_conflict") return;
      try {
        const latest = await apiFetch<SokoSessionContext>("/v1/session/context");
        const updated = await patchJson<SokoSessionContext>("/v1/session/context", {
          ...patch,
          expectedSessionVersion: latest.sessionVersion
        });
        setSokoSessionContext(updated);
      } catch {
        // Offline navigation remains available; the next connected state change retries sync.
      }
    }
  }

  function switchActiveBusiness(shop: AccountShopSummary, options?: { announce?: boolean }) {
    const nextBusiness: ActiveBusiness = { ...shop.business, role: shop.membership.role };
    const nextAgent = createDefaultAgent(nextBusiness);
    setBusiness(nextBusiness);
    setAgentSettings(nextAgent);
    setMode("seller");
    setView("chat");
    localStorage.setItem(activeBusinessStorageKey, JSON.stringify(nextBusiness));
    localStorage.setItem(activeAgentStorageKey, JSON.stringify(nextAgent));
    navigateToOwnerRoute({ mode: "seller", view: "chat" }, { replace: true });
    if (options?.announce !== false) {
      setStatusMessage(`Switched to ${nextBusiness.name}.`);
    }
  }

  deps.registerReset("auth", () => {
    setOauthProviders([]);
    setOauthProvidersLoaded(false);
    setIsAuthOpen(false);
    setIsAccountRestorationOpen(false);
    setSokoSessionContext(null);
  });

  return {
    authBootstrapState,
    setAuthBootstrapState,
    oauthProviders,
    setOauthProviders,
    oauthProvidersLoaded,
    setOauthProvidersLoaded,
    isAuthOpen,
    setIsAuthOpen,
    authenticationView,
    setAuthenticationView,
    isAccountRestorationOpen,
    setIsAccountRestorationOpen,
    forgetRememberedOwnerAuth,
    handleOAuthCallback,
    loadOAuthProviders,
    acceptAuthenticatedSession,
    completePhoneFirstAuthentication,
    completeOAuthSession,
    refreshSession,
    ensureAuthenticatedSession,
    rejectDefinitiveAuthenticationFailure,
    authenticateSocialProfile,
    completeAccountRestoration,
    loadSokoSessionContext,
    patchSokoSessionContext,
    applySessionContextForConversation,
    switchActiveBusiness
  };
}
