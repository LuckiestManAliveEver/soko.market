import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Surface } from "@soko/ui";
import type {
  AccountShopSummary,
  AuthBootstrapResponse,
  AuthBootstrapState,
  BuyFeedSummary,
  E2eeDeviceSummary,
  SokoChatSurface,
  SokoSessionContext
} from "@soko/shared-types";
import {
  createInitialChatMessages,
  type ChatMessage,
  type ShellView,
  type SokoMode
} from "./app-shell";

import {
  browserGgufRuntimeSupported,
  listLocalAiModels,
  getOrCreateDeviceModelScopeId
} from "./ai-model-manager";
import {
  assignmentAfterReadiness,
  readDeviceAgentModelAssignment,
  saveDeviceAgentModelAssignment
} from "./agent-model-assignment";
import { testAgentModelRuntime, type AgentModelRuntime } from "./agent-model-runtime";
import { createAdaptiveAgentModelRuntime } from "./browser-gguf-runtime";
import {
  cancelBrowserGeneration,
  clearBrowserInferenceAccountData
} from "./browser-inference-session";

import { readClientInferencePreferences } from "./inference/preferences";

import { ensureE2eeIdentity, type E2eeIdentity } from "./e2ee";
import {
  authenticationRoute,
  pathForOwnerView,
  readAuthenticationRouteHash,
  readAuthenticationRoutePath,
  readOwnerRoute,
  routes
} from "./routes";
import {
  canNavigateBackWithinApp,
  initializeOwnerHistory,
  navigateToBrowserUrl,
  navigateToOwnerRoute,
  readCurrentOwnerRoute,
  readSokoHistoryState,
  subscribeToBrowserNavigation
} from "./browser-navigation";
import {
  clearOwnerNavigationSession,
  readOwnerNavigationSession,
  scheduleOwnerNavigationSessionWrite
} from "./owner-navigation-session";
import { useAsyncActions } from "./hooks/useAsyncActions";
import { useDomainResetRegistry } from "./hooks/useDomainReset";
import { useCustomersState } from "./hooks/useCustomersState";
import { useImportsState } from "./hooks/useImportsState";
import { useInvoicesState } from "./hooks/useInvoicesState";
import { useAgentModelState } from "./hooks/useAgentModelState";
import { useBusinessSetupState } from "./hooks/useBusinessSetupState";
import { useChatState } from "./hooks/useChatState";
import { useLogisticsState } from "./hooks/useLogisticsState";
import { useReadinessState } from "./hooks/useReadinessState";
import { useReportsState } from "./hooks/useReportsState";
import { useRuntimeHistoryState } from "./hooks/useRuntimeHistoryState";
import { useStorefrontCareState } from "./hooks/useStorefrontCareState";
import { useNetworkState } from "./hooks/useNetworkState";
import { useProductsState } from "./hooks/useProductsState";
import { useSyncState } from "./hooks/useSyncState";
import { usePaymentsState } from "./hooks/usePaymentsState";
import { useSuppliersState } from "./hooks/useSuppliersState";
import { useNotificationsState } from "./hooks/useNotificationsState";
import { useViewRefreshRegistry } from "./hooks/useViewRefresh";
import { shellViewForSurface, surfaceForShellView } from "./cross-device-session-context";
import {
  ApiRequestError,
  apiFetch,
  isDefinitiveAuthenticationError,
  isRetryableApiRequestError
} from "./lib/api";
import { clearPersistentApiRequestCache } from "./api-request-cache";
import { detectCapabilitySettings } from "./capability-profile";
import { markNavigationCommitted, startNavigationMeasurement } from "./performance";
import { likelyNextOwnerViews, prefetchOwnerView, scheduleIdleOwnerPrefetch } from "./prefetch";
import { createScreenStateCache, restoreScreenScroll } from "./screen-state-cache";
import { setConnectivityAuthentication } from "./connectivity";

import { clearMessagingOutbox } from "./messaging/outbox";

import type { AccountRestorationResult } from "./features/account-restoration/AccountRestorationPanel";
import { AppIcon } from "./AppIcon";
import { AuthenticationActionMessage } from "./AuthenticationActionMessage";
import { clearDeviceRecoveryCredential, recoverDeviceAccount } from "./device-recovery";
import type { RememberedAccount } from "./PhoneFirstAuthentication";

import {
  bootstrapProgressMessage,
  clearCachedAuthSession,
  isAuthBootstrapPending,
  readCachedAuthSession,
  saveCachedAuthSession
} from "./auth-bootstrap";

import {
  AccountRestorationPanel,
  type ActiveBusiness,
  type AgentSettings,
  type BusinessAgentProfileSummary,
  type BuyCartItem,
  type CountryDialCode,
  type MarketplaceIntroStateSummary,
  type NetworkGraphSummary,
  type OAuthProviderSummary,
  type OAuthProvidersResponse,
  type OAuthStartResponse,
  type OwnerAuthRecord,
  type PendingOAuthLogin,
  PhoneFirstAuthentication,
  PhoneSignup,
  type ProductSummary,
  type PublicStorefrontListResponse,
  type PublicStorefrontSummary,
  type RoleCheckResponse,
  type SessionResponse,
  type SetupDraft,
  type ShopPresenceStatus,
  type ShopPresenceSummary,
  type SocialSignupProvider,
  activeAgentStorageKey,
  activeBusinessStorageKey,
  activeModeStorageKey,
  emptyCustomerForm,
  emptyInvoiceForm,
  emptyProductForm,
  emptySupplierForm,
  guestBrowsingStorageKey,
  legacyActiveBusinessStorageKey,
  ownerAuthStorageKey,
  pendingOAuthStorageKey,
  setupDraftStorageKey,
  socialSignupProviders,
  uiBackgroundRefreshIntervalMs
} from "./soko-application-shared";

import { postJson, patchJson, getJson } from "./api-helpers";

import { createPublicStorefrontUrl } from "./sokoid-and-storefront";
import { inferCountryCode } from "./country-dial-codes";
import {
  readStoredBusiness,
  readStoredSokoMode,
  readStoredAgent,
  readStoredOwnerAuth,
  readPendingOAuthLogin,
  readSetupDraft,
  createDefaultAgent,
  agentSettingsFromBusinessProfile
} from "./owner-app-bootstrap";

import {
  isHumanDirectConversation,
  logAuthenticationLifecycle,
  isRedundantAgentErrorMessage,
  getErrorMessage
} from "./chat-message-plumbing";

import { useInstallPrompt } from "./misc-browser-utils";

import { PrimaryNavigation } from "./PrimaryNavigation";

import { LogisticsSurface } from "./LogisticsSurface";
import { CustomerSurface } from "./CustomerSurface";

import { BusinessSetupPanel } from "./BusinessSetupPanel";
import { NetworkSurface } from "./NetworkSurface";
import { SyncSurface } from "./SyncSurface";
import { RuntimeSurface } from "./RuntimeSurface";
import { PaymentSurface } from "./PaymentSurface";
import { ImportSurface } from "./ImportSurface";

import { ProductSurface } from "./ProductSurface";
import { SupplierSurface } from "./SupplierSurface";
import { InvoiceSurface } from "./InvoiceSurface";
import { ComplianceSurface } from "./ComplianceSurface";
import { BetaSurface } from "./BetaSurface";
import { LaunchSurface } from "./LaunchSurface";
import { ReportsSurface } from "./ReportsSurface";
import { NotificationsSurface } from "./NotificationsSurface";

import { AgentProfileSurface } from "./AgentProfileSurface";
import { ChatSurface } from "./ChatSurface";

import { BuildIdentity, NativeLaunchScreen } from "./BuildIdentity";
import { OwnerCoreProvider, type OwnerCoreState } from "./hooks/OwnerCoreContext";
export { PublicStorefrontChat } from "./PublicStorefrontChat";

export function OwnerApp() {
  const installPrompt = useInstallPrompt();
  const capabilitySettingsRef = useRef(detectCapabilitySettings());
  const screenStateCacheRef = useRef(
    createScreenStateCache(capabilitySettingsRef.current.preservedScreenLimit)
  );
  const shellInstanceIdRef = useRef(
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `shell-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const accountDeletionIntent =
    new URLSearchParams(window.location.search).get("intent") === "account-deletion";
  const accountRestorationIntent =
    new URLSearchParams(window.location.search).get("intent") === "account-restoration";
  const initialAuthenticationTarget =
    readAuthenticationRoutePath(window.location.pathname) ??
    readAuthenticationRouteHash(window.location.hash);
  const initialSetupDraft = readSetupDraft();
  const initialBusiness = readStoredBusiness();
  const initialOwnerAuth = readStoredOwnerAuth();
  // A PIN-based account remembered from a prior successful login on this browser. Excludes
  // social/OAuth logins (no PIN to enter) so the login screen only skips identifier entry when
  // a PIN attempt actually makes sense.
  const rememberedAccount: RememberedAccount | null =
    initialOwnerAuth !== null && initialOwnerAuth.provider === undefined
      ? {
          type: initialOwnerAuth.contact.includes("@") ? "email" : "phone",
          identifier: initialOwnerAuth.contact,
          label: initialOwnerAuth.contact
        }
      : null;
  const initialCachedSession = readCachedAuthSession();
  const initialOwnerRoute = readOwnerRoute(window.location.pathname);
  const initialNavigationSession = readOwnerNavigationSession(
    initialCachedSession?.account.id ?? null
  );
  const initialCountryCode: CountryDialCode =
    initialOwnerAuth?.countryCode ?? initialSetupDraft?.countryCode ?? "+254";
  const [session, setSession] = useState<SessionResponse | null>(initialCachedSession);
  const [sokoSessionContext, setSokoSessionContext] = useState<SokoSessionContext | null>(null);
  const [authBootstrapState, setAuthBootstrapState] = useState<AuthBootstrapState>(
    initialCachedSession === null ? "initializing" : "offline-authenticated"
  );
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderSummary[]>([]);
  const [oauthProvidersLoaded, setOauthProvidersLoaded] = useState(false);
  const [business, setBusiness] = useState<ActiveBusiness | null>(initialBusiness);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(
    () => readStoredAgent() ?? createDefaultAgent(initialBusiness)
  );
  const [statusMessage, setStatusMessage] = useState("Checking session");
  const [view, setView] = useState<ShellView>(
    accountDeletionIntent ? "agent" : (initialOwnerRoute?.view ?? "chat")
  );
  const activeViewRef = useRef(view);
  activeViewRef.current = view;
  const [mode, setMode] = useState<SokoMode>(initialOwnerRoute?.mode ?? readStoredSokoMode());
  // Memoized so OwnerCoreContext consumers only re-render when one of these four pieces of state
  // actually changes, not on every OwnerApp render (i.e. every keystroke in any unrelated domain
  // form) - see docs/architecture/frontend-modularization-roadmap.md's OwnerApp decomposition notes.
  const ownerCoreValue: OwnerCoreState = useMemo(
    () => ({
      session,
      setSession,
      sokoSessionContext,
      setSokoSessionContext,
      business,
      setBusiness,
      agentSettings,
      setAgentSettings,
      view,
      setView,
      mode,
      setMode
    }),
    [session, sokoSessionContext, business, agentSettings, view, mode]
  );
  const { hasPending, isPending, runAction } = useAsyncActions();
  const domainResetRegistry = useDomainResetRegistry();
  const { registerRefresh, refreshersFor } = useViewRefreshRegistry();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [shopPresenceStatus, setShopPresenceStatus] = useState<ShopPresenceStatus>("online");
  const [isWorkspacePanelOpen, setIsWorkspacePanelOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(
    accountDeletionIntent || accountRestorationIntent || initialAuthenticationTarget !== null
  );
  const [authenticationView, setAuthenticationView] = useState<"signup" | "login">(
    initialAuthenticationTarget ?? (initialOwnerAuth !== null ? "login" : "signup")
  );
  const [isAccountRestorationOpen, setIsAccountRestorationOpen] =
    useState(accountRestorationIntent);
  const [isMarketplaceIntroComplete, setIsMarketplaceIntroComplete] = useState(
    () => localStorage.getItem("soko.market.marketplace-intro.completed.v1") === "true"
  );
  const [isMarketplaceShortcutOpen, setIsMarketplaceShortcutOpen] = useState(false);
  const [publicStorefronts, setPublicStorefronts] = useState<PublicStorefrontSummary[]>([]);
  const [publicStorefrontsLoading, setPublicStorefrontsLoading] = useState(false);
  const [buyFeed, setBuyFeed] = useState<BuyFeedSummary | null>(null);
  const [buyCart, setBuyCart] = useState<BuyCartItem[]>([]);
  const [e2eeIdentity, setE2eeIdentity] = useState<E2eeIdentity | null>(null);
  const [routedProductId, setRoutedProductId] = useState<string | null>(
    initialOwnerRoute?.productId ?? null
  );
  const chatModelRuntimeRef = useRef<AgentModelRuntime | null>(null);
  const sessionRefreshInFlightRef = useRef(false);
  const restoredModelInstallationRef = useRef<string | null>(null);

  const authBootstrapPending = isAuthBootstrapPending(authBootstrapState);
  const shouldShowAuth = !authBootstrapPending && isAuthOpen && session === null;
  const setupComplete = business !== null && !shouldShowAuth && !authBootstrapPending;
  const isAuthScreen = authBootstrapPending || shouldShowAuth || isAccountRestorationOpen;
  const publicStorefrontUrl = business === null ? "" : createPublicStorefrontUrl(business);
  const userLabel = session?.user.displayName ?? "Guest";

  function navigateToView(nextView: ShellView, options?: { replace?: boolean; mode?: SokoMode }) {
    const nextMode = options?.mode ?? mode;
    const nextRoute = { mode: nextMode, view: nextView };
    const nextPath = pathForOwnerView(nextView, nextMode);
    const measurement = startNavigationMeasurement(nextPath);
    screenStateCacheRef.current.write(activeViewRef.current, {
      scrollX: window.scrollX,
      scrollY: window.scrollY
    });
    setMode(nextMode);
    setView(nextView);
    setRoutedProductId(null);
    navigateToOwnerRoute(nextRoute, { replace: options?.replace });
    markNavigationCommitted(measurement);
    restoreScreenScroll(screenStateCacheRef.current, nextView);
  }

  function openProduct(product: ProductSummary, options?: { replace?: boolean }) {
    populateProductForm(product);
    setMode("seller");
    setView("products");
    setRoutedProductId(product.id);
    navigateToOwnerRoute(
      { mode: "seller", view: "products", productId: product.id },
      { replace: options?.replace }
    );
  }

  function openAgentProfile(options?: { replace?: boolean }) {
    if (business === null) return;
    setMode("seller");
    setView("agent");
    navigateToOwnerRoute(
      { mode: "seller", view: "agent", agentId: agentSettings.id },
      { replace: options?.replace }
    );
  }

  function returnToChat() {
    const currentState = readSokoHistoryState(window.history.state);
    if (currentState?.view !== "chat" && canNavigateBackWithinApp()) {
      window.history.back();
      return;
    }
    navigateToView("chat", { replace: currentState?.view !== "chat" });
  }

  function requireMessagingSignIn() {
    openAuth();
    setStatusMessage("Sign in to send end-to-end encrypted messages.");
  }

  function openAuth(intent: "signup" | "login" = "login") {
    sessionStorage.removeItem(guestBrowsingStorageKey);
    setIsBusinessSetupOpen(false);
    setIsAuthOpen(true);
    setAuthenticationView(intent);
    setStatusMessage(intent === "signup" ? "Create your Soko account." : "Log in to your account.");
    navigateToBrowserUrl(authenticationRoute(intent), { state: window.history.state });
  }

  function forgetRememberedOwnerAuth() {
    localStorage.removeItem(ownerAuthStorageKey);
  }

  function browseAsGuest() {
    sessionStorage.setItem(guestBrowsingStorageKey, "true");
    setIsAuthOpen(false);
    setIsBusinessSetupOpen(false);
    setIsAccountRestorationOpen(false);
    setIsMessagingInboxOpen(false);
    setMode("marketplace");
    setView("chat");
    setIsMarketplaceShortcutOpen(true);
    navigateToOwnerRoute({ mode: "marketplace", view: "chat" }, { replace: true });
    setStatusMessage("Browsing as a guest. Sign in only when you want to message, order, or sell.");
  }

  // Domain hooks extracted from OwnerApp's state (see docs/architecture/frontend-modularization-
  // roadmap.md's OwnerApp decomposition). Grouped together and placed after every raw useState/
  // useRef declaration above (not interspersed among them) since several of these hooks take
  // still-inline OwnerApp state as a dependency (e.g. `invoices`) - a `const` declared earlier in
  // this function via useState, which would throw a temporal-dead-zone error if referenced by a
  // hook call positioned before that declaration.
  //
  // useSyncState is called first, ahead of every other domain hook, because its
  // queueMutationAfterNetworkFailure is itself an injected dependency several other domain hooks'
  // deps objects need (Logistics/Customers/Payments) - those hooks reference it by name in their
  // own deps, which is only TDZ-safe if the const it resolves to already exists by then.
  const {
    syncQueue,
    syncSummary,
    offlineCache,
    syncRepositoryRef,
    loadSyncQueue,
    loadOfflineCache,
    replaySyncQueue,
    replaySyncQueueItem,
    queueMutationAfterNetworkFailure
  } = useSyncState({
    businessId: business?.id ?? null,
    session,
    setStatusMessage,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const { notificationInbox, loadNotifications, updateNotification } = useNotificationsState({
    businessId: business?.id ?? null,
    setStatusMessage,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  // useReportsState is called early, before any hook whose deps object references loadReports
  // (Logistics, Suppliers, Imports), for the same reason Sync is called first: those hooks
  // reference loadReports by name at hook-call time, which requires the const it resolves to
  // already exist.
  const { reportSummary, knowledgeSummary, loadReports } = useReportsState({
    setStatusMessage,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    logistics,
    logisticsForm,
    setLogisticsForm,
    loadLogistics,
    createLogistics,
    updateLogisticsStatus
  } = useLogisticsState({
    businessId: business?.id ?? null,
    getInvoices: () => invoices,
    setStatusMessage,
    loadReports,
    queueMutationAfterNetworkFailure,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const { customers, customerForm, setCustomerForm, loadCustomers, saveCustomer } =
    useCustomersState({
      businessId: business?.id ?? null,
      setStatusMessage,
      queueMutationAfterNetworkFailure,
      registerReset: domainResetRegistry.registerReset,
      registerRefresh
    });
  const {
    suppliers,
    purchaseReceipts,
    supplierForm,
    setSupplierForm,
    loadSuppliers,
    saveSupplier,
    deleteSupplierCard,
    saveSalesAgent,
    deleteSalesAgentCard,
    searchSupplierContacts,
    linkSupplierPhoneContact,
    createSupplierFromPhoneContact,
    linkSalesAgentPhoneContact,
    createSalesAgentFromPhoneContact,
    uploadSupplierReceipt,
    confirmSupplierReceipt
  } = useSuppliersState({
    businessId: business?.id ?? null,
    setStatusMessage,
    loadReports,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    payments,
    invoicePayments,
    customerDebts,
    paymentForm,
    setPaymentForm,
    loadPaymentData,
    recordPayment
  } = usePaymentsState({
    businessId: business?.id ?? null,
    setStatusMessage,
    queueMutationAfterNetworkFailure,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    products,
    productFields,
    productForm,
    setProductForm,
    stockProductId,
    setStockProductId,
    stockQuantityAfter,
    setStockQuantityAfter,
    stockReason,
    setStockReason,
    populateProductForm,
    loadProducts,
    loadProductFields,
    saveProduct,
    deleteProduct,
    adjustStock,
    saveProductFieldStructure
  } = useProductsState({
    businessId: business?.id ?? null,
    setStatusMessage,
    queueMutationAfterNetworkFailure,
    supplierForm,
    setSupplierForm,
    routedProductId,
    setRoutedProductId,
    navigateToView,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    importJobs,
    selectedImportJobId,
    setSelectedImportJobId,
    importForm,
    setImportForm,
    activeImportJob,
    loadDocumentImports,
    createDocumentImport,
    updateImportRowLocal,
    saveImportRow,
    confirmImport
  } = useImportsState({
    businessId: business?.id ?? null,
    setStatusMessage,
    loadProducts,
    loadSuppliers,
    loadReports,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    invoices,
    invoiceForm,
    setInvoiceForm,
    invoicePreview,
    setInvoicePreview,
    loadInvoices,
    previewInvoice,
    saveInvoice,
    confirmInvoice,
    printInvoice
  } = useInvoicesState({
    businessId: business?.id ?? null,
    setStatusMessage,
    loadProducts,
    queueMutationAfterNetworkFailure,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    networkGraph,
    setNetworkGraph,
    networkInvites,
    loadNetworkGraph,
    loadNetworkInvites,
    syncPhoneNetwork,
    syncSelectedNetworkPhoneContacts,
    inviteNetworkContacts,
    syncSocialNetwork,
    requestNetworkRoute,
    approveNetworkRoute,
    rejectNetworkRoute,
    disconnectNetworkSource,
    shareOwnerStorefrontInvite,
    syncOwnerPhoneContacts,
    importContactsFile,
    exportOwnerContacts
  } = useNetworkState({
    business,
    getCustomers: () => customers,
    loadCustomers,
    authenticateSocialProfile,
    setStatusMessage,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const {
    runtimeSessions,
    selectedRuntimeHistorySessionId,
    setSelectedRuntimeHistorySessionId,
    runtimeTurns,
    loadRuntimeSessions,
    loadRuntimeTurns,
    createRuntimeHistorySession,
    createManagedRuntimeSession,
    ensureRuntimeSession,
    restoreOrCreateRuntimeSession
  } = useRuntimeHistoryState({
    business,
    session,
    setStatusMessage,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  const { storefrontCareRequests, storefrontMessages, storefrontOrders, loadStorefrontInbox } =
    useStorefrontCareState({
      setStatusMessage,
      registerReset: domainResetRegistry.registerReset,
      registerRefresh
    });
  const {
    securityReview,
    dataExport,
    verificationTier,
    taxConfig,
    deviceTrust,
    complianceForm,
    setComplianceForm,
    loadCompliance,
    createDataExport,
    saveVerificationTier,
    saveTaxConfig,
    saveDeviceTrust,
    scheduleAccountDeletion,
    betaReadiness,
    betaSupportTickets,
    betaForm,
    setBetaForm,
    loadBetaReadiness,
    updateBetaAccess,
    enableBetaFlags,
    recordBetaDeviceTest,
    createBetaSupportTicket,
    updateBetaSupportTicketStatus,
    recordBetaTelemetry,
    launchReadiness,
    launchIncidents,
    launchForm,
    setLaunchForm,
    loadLaunchReadiness,
    updateLaunchSettings,
    updateLaunchChecklist,
    createLaunchIncident,
    updateLaunchIncidentStatus
  } = useReadinessState({
    business,
    session,
    isOnline,
    setStatusMessage,
    loadReports,
    resetClientToStartup,
    registerReset: domainResetRegistry.registerReset,
    registerRefresh
  });
  // useChatState is called before useBusinessSetupState because BusinessSetup's own deps object
  // references setConversationInbox/setActiveConversationId/loadConversationThread, all three now
  // returned by this hook - same TDZ-avoidance reasoning as every other domain hook ordering
  // decision in this effort.
  const {
    isMessagingInboxOpen,
    setIsMessagingInboxOpen,
    chatDraft,
    pendingAttachments,
    runtimeSessionId,
    setRuntimeSessionId,
    chatMessages,
    setChatMessages,
    conversationInbox,
    setConversationInbox,
    activeConversationId,
    setActiveConversationId,
    activeConversation,
    replyToMessageId,
    setReplyToMessageId,
    isContactTyping,
    isBrowserGenerating,
    loadMessagingInbox,
    loadConversationThread,
    selectConversation,
    createDirectConversation,
    updateConversationPreference,
    updateMessageAction,
    forwardMessage,
    requestMessagingNotifications,
    disableMessagingNotifications,
    signalTyping,
    recordSmsHandoff,
    recordPlatformHandoff,
    retryQueuedMessages,
    submitAgentResponseFeedback,
    sendChatDraft,
    confirmRuntimeAction,
    handleChatAttachmentChange,
    removePendingAttachment,
    handleSellerPhotoCapture,
    handleSearchBuyFeed,
    handleAddToCart,
    handleRemoveFromCart,
    handleCheckout,
    handleStatusBroadcastPosted
  } = useChatState({
    business,
    session,
    agentSettings,
    e2eeIdentity,
    chatModelRuntimeRef,
    mode,
    setStatusMessage,
    setView,
    navigateToView,
    requireMessagingSignIn,
    runAction,
    products,
    loadProducts,
    setProductForm,
    suppliers,
    loadSuppliers,
    customers,
    loadCustomers,
    setCustomerForm,
    customerDebts,
    invoices,
    loadInvoices,
    setInvoiceForm,
    setInvoicePreview,
    setPaymentForm,
    loadNetworkGraph,
    requestNetworkRoute,
    loadRuntimeSessions,
    createManagedRuntimeSession,
    ensureRuntimeSession,
    loadDocumentImports,
    buyCart,
    setBuyCart,
    setBuyFeed,
    initialNavigationSession,
    initialBusiness,
    initialOwnerRoute,
    registerReset: domainResetRegistry.registerReset
  });
  const {
    businessName,
    setBusinessName,
    language,
    setLanguage,
    businessSetupStep,
    setBusinessSetupStep,
    shopPhoneCountryCode,
    setShopPhoneCountryCode,
    shopPhoneNumber,
    setShopPhoneNumber,
    isBusinessSetupOpen,
    setIsBusinessSetupOpen,
    saveOwnerPhoneForShop,
    createBusiness
  } = useBusinessSetupState({
    business,
    setBusiness,
    session,
    setSession,
    setAgentSettings,
    setMode,
    setView,
    refreshSession,
    setConversationInbox,
    setActiveConversationId,
    loadConversationThread,
    setStatusMessage,
    initialSetupDraft,
    initialCountryCode,
    registerReset: domainResetRegistry.registerReset
  });
  const {
    deviceCloudFallbackModelId,
    setDeviceCloudFallbackModelId,
    restoreDeviceModelForLaunch,
    findSelectedCloudFallback,
    enableDeviceCloudFallback,
    declineDeviceCloudFallback
  } = useAgentModelState({
    business,
    session,
    setAgentSettings,
    setStatusMessage,
    registerReset: domainResetRegistry.registerReset
  });

  useEffect(() => {
    function openAuthenticationFromHash() {
      const target = readAuthenticationRouteHash(window.location.hash);
      if (target === null) return;

      openAuth(target);

      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    }

    openAuthenticationFromHash();
    window.addEventListener("hashchange", openAuthenticationFromHash);
    return () => window.removeEventListener("hashchange", openAuthenticationFromHash);
  }, []);

  useEffect(() => {
    if (isOnline && authBootstrapState === "offline-authenticated") {
      void refreshSession();
    }
  }, [isOnline, authBootstrapState]);

  useEffect(() => {
    setConnectivityAuthentication(session !== null);
  }, [session]);

  useEffect(() => {
    if (session === null) {
      setSokoSessionContext(null);
      return;
    }
    void loadSokoSessionContext();
  }, [session?.account.id]);

  useEffect(() => {
    if (session === null || sokoSessionContext === null) return;
    if (mode === "seller" && business === null) return;

    const activeSurface = surfaceForShellView(view, mode);
    const activeShopId = business?.id ?? null;
    const conversationId = activeConversationId ?? sokoSessionContext.conversationId;
    if (
      sokoSessionContext.mode === mode &&
      sokoSessionContext.activeShopId === activeShopId &&
      sokoSessionContext.activeSurface === activeSurface &&
      sokoSessionContext.conversationId === conversationId
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void patchSokoSessionContext({ mode, activeShopId, activeSurface, conversationId });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeConversationId,
    business?.id,
    mode,
    session?.account.id,
    sokoSessionContext?.sessionVersion,
    view
  ]);

  useEffect(() => {
    if (authBootstrapPending) return;
    void loadPublicStorefronts();
  }, [authBootstrapPending]);

  useEffect(() => {
    void loadOAuthProviders();
    void handleOAuthCallback().then((handled) => {
      if (!handled) {
        void refreshSession();
      }
    });
  }, []);

  useEffect(() => {
    if (session === null) return;

    const savedPhone =
      session.user.phoneNumberE164 ??
      (session.account.primaryAuthChannel === "phone"
        ? session.account.primaryAuthDestination
        : null);
    if (savedPhone === null) return;

    const savedCountryCode = inferCountryCode(savedPhone);
    if (savedCountryCode !== null) {
      setShopPhoneCountryCode(savedCountryCode);
    }
    setShopPhoneNumber(savedPhone);
  }, [
    session?.account.primaryAuthChannel,
    session?.account.primaryAuthDestination,
    session?.user.phoneNumberE164
  ]);

  useEffect(() => {
    const initialRoute = readCurrentOwnerRoute();
    if (initialRoute === null) return;
    initializeOwnerHistory(initialRoute);
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    function restoreRoute() {
      const route = readCurrentOwnerRoute();
      if (route === null) return;
      const measurement = startNavigationMeasurement(window.location.pathname);
      setMode(route.mode);
      setView(route.view);
      setRoutedProductId(route.productId ?? null);
      setActiveConversationId(route.conversationId ?? null);
      setReplyToMessageId(null);
      setIsWorkspacePanelOpen(false);
      setIsMarketplaceShortcutOpen(false);
      markNavigationCommitted(measurement);
      const historyState = readSokoHistoryState(window.history.state);
      if (historyState !== null) {
        window.requestAnimationFrame(() => {
          window.scrollTo(historyState.scrollX, historyState.scrollY);
        });
      }
    }

    const unsubscribe = subscribeToBrowserNavigation(restoreRoute);
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    scheduleOwnerNavigationSessionWrite(session?.account.id ?? null, {
      activeConversationId,
      runtimeSessionId,
      chatDraft,
      chatMessages
    });
  }, [activeConversationId, chatDraft, chatMessages, runtimeSessionId, session?.account.id]);

  useEffect(() => {
    if (routedProductId === null || products.length === 0) return;
    const product = products.find((candidate) => candidate.id === routedProductId);
    if (product === undefined) {
      setRoutedProductId(null);
      navigateToView("products", { replace: true, mode: "seller" });
      setStatusMessage("That product is no longer available.");
      return;
    }
    populateProductForm(product);
  }, [products, routedProductId]);

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine);
    }

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (session === null && business === null) {
      localStorage.removeItem(activeAgentStorageKey);
      return;
    }
    localStorage.setItem(activeAgentStorageKey, JSON.stringify(agentSettings));
  }, [agentSettings, business, session]);

  useEffect(() => {
    localStorage.setItem(activeModeStorageKey, mode);
  }, [mode]);

  useEffect(() => {
    if (session === null) return;
    let cancelled = false;
    void ensureE2eeIdentity(session.account.id)
      .then(async (identity) => {
        await postJson<E2eeDeviceSummary>("/v1/e2ee/devices", {
          deviceId: identity.deviceId,
          label:
            (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
              ?.platform ||
            navigator.platform ||
            "This browser",
          publicKey: identity.publicKey
        });
        if (!cancelled) setE2eeIdentity(identity);
      })
      .catch((error) => {
        if (!cancelled) setStatusMessage(getErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [session?.account.id]);

  useEffect(() => {
    if (session === null || e2eeIdentity === null) return;
    let cancelled = false;
    const refresh = async () => {
      const notificationConversationId = new URLSearchParams(window.location.search).get(
        "conversation"
      );
      const routeConversationId = readCurrentOwnerRoute()?.conversationId ?? null;
      if (!cancelled) {
        await loadMessagingInbox(
          notificationConversationId ?? routeConversationId ?? activeConversationId
        );
      }
      if (notificationConversationId) {
        navigateToOwnerRoute(
          {
            mode,
            view: "chat",
            conversationId: notificationConversationId
          },
          { replace: true }
        );
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 4_000);
    const onOnline = () => {
      void retryQueuedMessages();
      void refresh();
    };
    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: string; conversationId?: string };
      if (data.type === "message.notification.open" && data.conversationId) {
        void selectConversation(data.conversationId);
      }
    };
    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
    };
  }, [session?.account.id, activeConversationId, e2eeIdentity?.deviceId, mode]);

  useEffect(() => {
    if (business !== null) {
      localStorage.removeItem(setupDraftStorageKey);
      return;
    }
    if (!isBusinessSetupOpen && businessName.trim().length === 0) {
      localStorage.removeItem(setupDraftStorageKey);
      return;
    }

    const draft: SetupDraft = {
      countryCode: shopPhoneCountryCode,
      businessName,
      language,
      completedStep: businessSetupStep === "phone" ? 1 : 2
    };
    localStorage.setItem(setupDraftStorageKey, JSON.stringify(draft));
  }, [
    business,
    businessName,
    businessSetupStep,
    isBusinessSetupOpen,
    language,
    shopPhoneCountryCode
  ]);

  useEffect(() => {
    if (business !== null) {
      setAgentSettings((agent) => {
        const defaultAgent = createDefaultAgent(business);

        if (agent.globalAgentId.length === 0) {
          return defaultAgent;
        }

        if (
          agent.globalAgentId === defaultAgent.globalAgentId &&
          agent.storefrontUrl === defaultAgent.storefrontUrl
        ) {
          return agent;
        }

        return {
          ...agent,
          globalAgentId: defaultAgent.globalAgentId,
          storefrontUrl: defaultAgent.storefrontUrl
        };
      });
      setChatMessages((messages) =>
        messages[0]?.id === "welcome"
          ? createInitialChatMessages(business.name)
          : [
              createInitialChatMessages(business.name)[0] as ChatMessage,
              ...messages.filter((message) => message.id !== "welcome")
            ]
      );
    }
  }, [business]);

  useEffect(() => {
    if (!setupComplete || business === null || session === null) return;

    let cancelled = false;
    const accountId = session.account.id;
    const businessId = business.id;

    if (navigator.onLine) {
      console.info(
        JSON.stringify({ event: "agent.runtime_restore_started", accountId, businessId })
      );
      void restoreOrCreateRuntimeSession(setRuntimeSessionId)
        .then((restoredRuntimeSessionId) => {
          if (cancelled) return;
          console.info(
            JSON.stringify({
              event: "agent.runtime_restore_completed",
              accountId,
              businessId,
              runtimeSessionId: restoredRuntimeSessionId
            })
          );
        })
        .catch((error) => {
          if (cancelled) return;
          console.info(
            JSON.stringify({
              event: "agent.runtime_restore_failed",
              accountId,
              businessId,
              errorCode: getErrorMessage(error)
            })
          );
          setStatusMessage(
            "Your shop is open, but its agent session could not start. Retry from chat."
          );
        });

      void restoreDeviceModelForLaunch(businessId)
        .then(async (restoredAssignment) => {
          const modelId = restoredAssignment.modelId;
          if (cancelled) return;
          if (modelId !== null) {
            setAgentSettings((current) => ({ ...current, model: modelId }));
          }
          if (
            restoredAssignment.activeModelInstallationId !== null &&
            restoredAssignment.readinessStatus === "READY"
          ) {
            return;
          }

          const fallbackModelId = await findSelectedCloudFallback(businessId);
          if (cancelled || fallbackModelId === null) return;
          const preferences = readClientInferencePreferences(accountId, businessId);
          if (preferences.cloudConsent) {
            setAgentSettings((current) => ({ ...current, model: fallbackModelId }));
            setStatusMessage(
              "This device has no ready downloaded model, so your explicitly selected OpenAI fallback is available."
            );
            return;
          }
          setDeviceCloudFallbackModelId(fallbackModelId);
          setStatusMessage(
            "No downloaded model is ready on this device. Download one, or explicitly allow your selected OpenAI fallback."
          );
        })
        .catch((error) => {
          if (cancelled) return;
          console.info(
            JSON.stringify({
              event: "model.device_fallback_restore_failed",
              accountId,
              businessId,
              errorCode: getErrorMessage(error)
            })
          );
        });
    }

    const deviceId = getOrCreateDeviceModelScopeId();
    const assignment = readDeviceAgentModelAssignment(businessId, deviceId);
    const installation =
      assignment?.activeModelInstallationId === null ||
      assignment?.activeModelInstallationId === undefined
        ? null
        : (listLocalAiModels().find((model) => model.id === assignment.activeModelInstallationId) ??
          null);

    if (
      assignment !== null &&
      installation !== null &&
      (window.SokoAgentModelRuntime !== undefined || browserGgufRuntimeSupported()) &&
      restoredModelInstallationRef.current !== installation.id
    ) {
      restoredModelInstallationRef.current = installation.id;
      console.info(
        JSON.stringify({
          event: "model.activation.started",
          accountId,
          businessId,
          modelId: installation.modelId,
          reason: "launch_restore"
        })
      );
      const runtime =
        chatModelRuntimeRef.current ??
        (chatModelRuntimeRef.current = createAdaptiveAgentModelRuntime());
      void testAgentModelRuntime(runtime, installation).then((result) => {
        saveDeviceAgentModelAssignment(assignmentAfterReadiness(assignment, result));
        if (cancelled) return;
        console.info(
          JSON.stringify({
            event: result.success ? "model.activation.completed" : "model.activation.failed",
            accountId,
            businessId,
            modelId: installation.modelId,
            errorCode: result.errorCode
          })
        );
        if (!result.success) {
          setStatusMessage(`${result.message} Your account remains signed in.`);
          void findSelectedCloudFallback(businessId).then((fallbackModelId) => {
            if (cancelled || fallbackModelId === null) return;
            const preferences = readClientInferencePreferences(accountId, businessId);
            if (preferences.cloudConsent) {
              setAgentSettings((current) => ({ ...current, model: fallbackModelId }));
            } else {
              setDeviceCloudFallbackModelId(fallbackModelId);
            }
          });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [business?.id, session?.account.id, setupComplete, isOnline]);

  useEffect(() => {
    if (!setupComplete || business === null) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    const businessId = business.id;

    async function refreshActiveView(force = false) {
      if (
        cancelled ||
        refreshInFlight ||
        (!force &&
          (session === null || !navigator.onLine || document.visibilityState !== "visible"))
      ) {
        return;
      }

      refreshInFlight = true;
      // Domain hooks extracted from OwnerApp register their own `load*` here (keyed by which
      // views should trigger them) instead of adding another inline `if (view === ...)` branch
      // below - see apps/web/src/hooks/useViewRefresh.ts. Empty until the first hook registers.
      const refreshes: Promise<void>[] = refreshersFor(view).map((refresh) => refresh(businessId));

      if (view === "invoices") {
        refreshes.push(loadCustomers(businessId));
      }

      if (view === "runtime") {
        refreshes.push(loadRuntimeSessions(businessId));
      }

      await Promise.allSettled(refreshes);
      refreshInFlight = false;
    }

    void refreshActiveView(true);
    const interval = window.setInterval(
      () => void refreshActiveView(),
      uiBackgroundRefreshIntervalMs
    );
    const refreshWhenForegrounded = () => {
      if (document.visibilityState === "visible") {
        void refreshActiveView();
      }
    };
    const refreshWhenOnline = () => void refreshActiveView();

    document.addEventListener("visibilitychange", refreshWhenForegrounded);
    window.addEventListener("focus", refreshWhenForegrounded);
    window.addEventListener("online", refreshWhenOnline);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenForegrounded);
      window.removeEventListener("focus", refreshWhenForegrounded);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, [business?.id, session?.account.id, setupComplete, view]);

  useEffect(() => {
    if (!setupComplete || business === null) return;
    const likelyViews = likelyNextOwnerViews(view);
    if (likelyViews.length === 0) return;
    return scheduleIdleOwnerPrefetch(likelyViews, business.id);
  }, [business?.id, setupComplete, view]);

  useEffect(() => {
    if (!setupComplete || view !== "chat" || business === null) return;
    let cancelled = false;
    const hydrate = () => {
      if (cancelled) return;
      void Promise.allSettled([
        loadProducts(business.id),
        loadProductFields(business.id),
        loadSuppliers(business.id),
        loadCustomers(business.id),
        loadInvoices(business.id),
        loadReports(business.id),
        loadNetworkGraph(),
        loadNetworkInvites(business.id)
      ]);
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(hydrate, { timeout: 1_200 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
      };
    }
    const timeoutId = window.setTimeout(hydrate, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [business?.id, setupComplete, view]);

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
      await completeOAuthSession(response, pendingOAuth.provider);
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

  async function completeOAuthSession(response: SessionResponse, provider: SocialSignupProvider) {
    const selectedProvider = socialSignupProviders.find((item) => item.id === provider);
    acceptAuthenticatedSession(response);
    let networkStatus = "";

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

  async function refreshSession() {
    if (sessionRefreshInFlightRef.current) return;
    sessionRefreshInFlightRef.current = true;
    setAuthBootstrapState((current) =>
      current === "offline-authenticated" ? current : "restoring-session"
    );
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
    } catch (error) {
      const cached = readCachedAuthSession();
      const storedBusiness = readStoredBusiness();
      if (!navigator.onLine && cached !== null && storedBusiness !== null) {
        setSession(cached);
        setBusiness(storedBusiness);
        setAuthBootstrapState("offline-authenticated");
        setIsAuthOpen(false);
        setStatusMessage("Offline workspace restored. Cloud data will refresh after reconnect.");
        return;
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
            return;
          }
        } catch (recoveryError) {
          if (isRetryableApiRequestError(recoveryError)) {
            setAuthBootstrapState("failed");
            setStatusMessage(
              "Soko could not restore this device. Check your connection and retry."
            );
            return;
          }
        }
        setSession(null);
        clearCachedAuthSession();
        setAuthBootstrapState("reauthentication-required");
        if (storedBusiness === null) setBusiness(null);
        if (!accountDeletionIntent && !accountRestorationIntent) {
          const nextAuthenticationView =
            initialAuthenticationTarget ?? (initialOwnerAuth === null ? "signup" : "login");
          setIsAuthOpen(true);
          setAuthenticationView(nextAuthenticationView);
          window.history.replaceState(
            window.history.state,
            "",
            authenticationRoute(nextAuthenticationView)
          );
          setStatusMessage(
            nextAuthenticationView === "signup"
              ? "Create your Soko account."
              : "Sign in to continue"
          );
        }
        return;
      }

      if (cached !== null) setSession(cached);
      if (storedBusiness !== null) setBusiness(storedBusiness);
      setAuthBootstrapState("failed");
      if (cached === null) {
        setIsAuthOpen(true);
        setAuthenticationView(initialAuthenticationTarget ?? "signup");
      }
      setStatusMessage("Soko could not restore this session. Check your connection and retry.");
    } finally {
      sessionRefreshInFlightRef.current = false;
    }
  }

  async function loadMarketplaceIntroState() {
    try {
      const state = await getJson<MarketplaceIntroStateSummary>("/v1/marketplace-intro");
      if (state.completedAt !== null) {
        localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
        setIsMarketplaceIntroComplete(true);
      }
    } catch {
      // Anonymous and offline visitors use the local completion marker.
    }
  }

  async function loadPublicStorefronts() {
    setPublicStorefrontsLoading(true);
    try {
      const response = await getJson<PublicStorefrontListResponse>("/public/storefronts?limit=24");
      setPublicStorefronts(response.storefronts);
    } catch {
      setPublicStorefronts([]);
    } finally {
      setPublicStorefrontsLoading(false);
    }
  }

  async function completeMarketplaceIntro() {
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
    setIsMarketplaceIntroComplete(true);
    setIsMarketplaceShortcutOpen(false);
    setStatusMessage("Marketplace ready. Use the Marketplace button to return anytime.");

    if (session !== null) {
      try {
        await postJson<MarketplaceIntroStateSummary>("/v1/marketplace-intro/complete", {
          businessId: null
        });
      } catch (error) {
        setStatusMessage(getErrorMessage(error));
      }
    }
  }

  async function validateStoredBusiness() {
    const storedBusiness = readStoredBusiness();

    if (storedBusiness === null) {
      return;
    }

    try {
      const roleCheck = await postJson<RoleCheckResponse>("/roles/check", {
        businessId: storedBusiness.id,
        role: "owner"
      });

      if (roleCheck.allowed) {
        setBusiness(storedBusiness);
        const [presence, agentProfile] = await Promise.all([
          getJson<ShopPresenceSummary>(`/businesses/${storedBusiness.id}/presence`),
          getJson<BusinessAgentProfileSummary>(`/businesses/${storedBusiness.id}/agent-profile`)
        ]);
        setShopPresenceStatus(presence.status);
        setAgentSettings(agentSettingsFromBusinessProfile(agentProfile, storedBusiness));
        setStatusMessage("Owner shell active");
        return;
      }
    } catch {
      // Local development uses an in-memory API store; stale cached business views are expected after restarts.
    }

    setBusiness(storedBusiness);
    setStatusMessage("Saved workspace loaded");
  }

  async function authenticateSocialProfile(provider: SocialSignupProvider) {
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
        redirectUri: `${window.location.origin}${routes.oauthCallback}`
      });
      const pendingOAuth: PendingOAuthLogin = {
        csrfToken: response.csrfToken,
        provider: response.provider,
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
  async function loadSokoSessionContext() {
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

  function switchMode(nextMode: SokoMode) {
    if (nextMode === "seller" && business === null) {
      if (session === null) {
        setIsBusinessSetupOpen(false);
        setStatusMessage(
          "Sign up or log in from the welcome message before registering your first shop."
        );
        return;
      }

      setBusinessSetupStep(
        typeof session.user.phoneNumberE164 === "string" && session.user.phoneNumberE164.length > 0
          ? "details"
          : "phone"
      );
      setIsBusinessSetupOpen(true);
      setStatusMessage(
        session.user.phoneNumberE164
          ? "Set up your business to start selling."
          : "Add your phone number to register your first shop."
      );
      return;
    }

    if (nextMode === mode) {
      return;
    }

    const nextPath = pathForOwnerView("chat", nextMode);
    const measurement = startNavigationMeasurement(nextPath);
    setMode(nextMode);
    navigateToOwnerRoute({ mode: nextMode, view: "chat" });
    setIsMarketplaceShortcutOpen(nextMode === "marketplace" && isMarketplaceIntroComplete);
    setView("chat");
    setIsWorkspacePanelOpen(false);
    markNavigationCommitted(measurement);
    setChatMessages((messages) => [
      ...messages,
      {
        id: `mode-${nextMode}-${Date.now()}`,
        author: "sokoclaw",
        body:
          nextMode === "seller"
            ? `Seller controls are ready for ${business?.name ?? "your shop"}. You can use a card below or tell me what to change.`
            : "Marketplace mode restored. Tell me what you want to find, or explore a storefront below."
      }
    ]);
  }

  function updateShopPresenceStatus(nextStatus: ShopPresenceStatus) {
    if (business === null) return;

    void runAction("presence-update", async () => {
      try {
        const presence = await patchJson<ShopPresenceSummary>(
          `/businesses/${business.id}/presence`,
          { status: nextStatus }
        );
        setShopPresenceStatus(presence.status);
        setStatusMessage(`Shop status set to ${presence.status} across devices`);
      } catch (error) {
        setStatusMessage(getErrorMessage(error));
      }
    });
  }

  async function resetClientToStartup(accountId: string | null, message: string) {
    if (accountId !== null) {
      await Promise.all([
        clearBrowserInferenceAccountData(accountId).catch(() => undefined),
        syncRepositoryRef.current?.clearAllAccountData(accountId).catch(() => undefined)
      ]);
      clearMessagingOutbox(accountId);
    }
    await clearPersistentApiRequestCache();
    await clearDeviceRecoveryCredential().catch(() => undefined);
    clearCachedAuthSession();
    clearOwnerNavigationSession(accountId);
    clearOwnerNavigationSession(null);
    localStorage.removeItem(activeBusinessStorageKey);
    localStorage.removeItem(legacyActiveBusinessStorageKey);
    localStorage.removeItem(activeAgentStorageKey);
    localStorage.removeItem(activeModeStorageKey);
    localStorage.removeItem(ownerAuthStorageKey);
    localStorage.removeItem(setupDraftStorageKey);
    sessionStorage.removeItem(pendingOAuthStorageKey);
    sessionStorage.removeItem(guestBrowsingStorageKey);
    setSession(null);
    setBusiness(null);
    // Fires every domain hook's registered reset (empty until each phase of the OwnerApp state
    // decomposition lands its hook - see docs/architecture/frontend-modularization-roadmap.md).
    // Ordered after session/business so any in-flight request's `business === null` guard already
    // sees the logged-out state before a domain's own reset could race a just-completed response.
    domainResetRegistry.resetAll();
    setAgentSettings(createDefaultAgent(null));
    setAuthBootstrapState("unauthenticated");
    setRoutedProductId(null);
    setE2eeIdentity(null);
    setView("chat");
    setMode("marketplace");
    navigateToOwnerRoute({ mode: "marketplace", view: "chat" }, { replace: true });
    setIsWorkspacePanelOpen(false);
    setIsBusinessSetupOpen(false);
    setIsAuthOpen(true);
    setAuthenticationView("signup");
    window.history.replaceState(window.history.state, "", authenticationRoute("signup"));
    setIsAccountRestorationOpen(false);
    setStatusMessage(message);
  }

  async function logout(allSessions = false) {
    const accountId = session?.account.id ?? null;
    try {
      await postJson(allSessions ? "/auth/logout-all" : "/auth/logout", {});
    } catch {
      // Local state still needs to return to startup if the API is unavailable.
    }

    await resetClientToStartup(
      accountId,
      allSessions ? "Signed out on every device." : "Signed out."
    );
  }

  function renderActiveWorkspace() {
    if (business === null) {
      return null;
    }

    switch (view) {
      case "products":
        return (
          <ProductSurface
            businessId={business.id}
            products={products}
            form={productForm}
            stockProductId={stockProductId}
            stockQuantityAfter={stockQuantityAfter}
            stockReason={stockReason}
            onFormChange={setProductForm}
            onSave={() => void runAction("product-save", saveProduct)}
            onReset={() => {
              setProductForm(emptyProductForm);
              setRoutedProductId(null);
              navigateToView("products", { replace: true, mode: "seller" });
            }}
            onAdd={() => {
              setProductForm(emptyProductForm);
              setRoutedProductId(null);
              navigateToView("products", { replace: true, mode: "seller" });
            }}
            onEdit={openProduct}
            onStockProductChange={(productId) => {
              const product = products.find((item) => item.id === productId);
              setStockProductId(productId);
              setStockQuantityAfter(String(product?.quantity ?? 0));
            }}
            onStockQuantityAfterChange={setStockQuantityAfter}
            onStockReasonChange={setStockReason}
            onAdjustStock={() => void runAction("stock-adjust", adjustStock)}
            onPublished={() => loadProducts(business.id)}
            onRemove={(productId) =>
              void runAction("product-delete", () => deleteProduct(productId))
            }
          />
        );
      case "suppliers":
        return (
          <SupplierSurface
            suppliers={suppliers}
            purchaseReceipts={purchaseReceipts}
            form={supplierForm}
            onFormChange={setSupplierForm}
            onSave={() => void runAction("supplier-save", saveSupplier)}
            onReset={() => setSupplierForm(emptySupplierForm)}
            onEdit={(supplier) =>
              setSupplierForm({
                id: supplier.id,
                name: supplier.name,
                phone: supplier.phone ?? "",
                email: supplier.email ?? "",
                notes: supplier.notes ?? ""
              })
            }
            onDelete={(supplierId) =>
              void runAction("supplier-delete", () => deleteSupplierCard(supplierId))
            }
            onSaveSalesAgent={(supplierId, agent) =>
              void runAction("sales-agent-save", () => saveSalesAgent(supplierId, agent))
            }
            onDeleteSalesAgent={(supplierId, salesAgentId) =>
              void runAction("sales-agent-delete", () =>
                deleteSalesAgentCard(supplierId, salesAgentId)
              )
            }
            onSearchContacts={searchSupplierContacts}
            onLinkSupplierContact={(supplierId, networkNodeId) =>
              void linkSupplierPhoneContact(supplierId, networkNodeId)
            }
            onCreateSupplierFromContact={(networkNodeId) =>
              void createSupplierFromPhoneContact(networkNodeId)
            }
            onLinkSalesAgentContact={(salesAgentId, networkNodeId) =>
              void linkSalesAgentPhoneContact(salesAgentId, networkNodeId)
            }
            onCreateSalesAgentFromContact={(supplierId, networkNodeId) =>
              void createSalesAgentFromPhoneContact(supplierId, networkNodeId)
            }
            onUploadReceipt={uploadSupplierReceipt}
            onConfirmReceipt={(job) =>
              void runAction("receipt-confirm", () => confirmSupplierReceipt(job))
            }
            onImport={() => navigateToView("imports")}
          />
        );
      case "customers":
        return (
          <CustomerSurface
            customers={customers}
            form={customerForm}
            onFormChange={setCustomerForm}
            onSave={() => void runAction("customer-save", saveCustomer)}
            onReset={() => setCustomerForm(emptyCustomerForm)}
            onEdit={(customer) =>
              setCustomerForm({
                id: customer.id,
                name: customer.name,
                phone: customer.phone ?? "",
                email: customer.email ?? "",
                notes: customer.notes ?? ""
              })
            }
          />
        );
      case "invoices":
        return (
          <InvoiceSurface
            products={products}
            customers={customers}
            invoices={invoices}
            form={invoiceForm}
            preview={invoicePreview}
            onFormChange={setInvoiceForm}
            onPreview={() => void runAction("invoice-preview", previewInvoice)}
            onSave={() => void runAction("invoice-save", saveInvoice)}
            onReset={() => {
              setInvoiceForm(emptyInvoiceForm);
              setInvoicePreview(null);
            }}
            onEdit={(invoice) => {
              const firstItem = invoice.items[0];
              setInvoiceForm({
                id: invoice.id,
                customerId: invoice.customerId ?? "",
                customerName: invoice.customerName ?? "",
                productId: firstItem?.productId ?? "",
                quantity: String(firstItem?.quantity ?? 1),
                unitPrice: String(firstItem?.unitPrice ?? 0),
                taxRate: String(invoice.taxRate)
              });
              setInvoicePreview(invoice);
            }}
            onConfirm={(invoiceId) =>
              void runAction("invoice-confirm", () => confirmInvoice(invoiceId))
            }
            onPrint={printInvoice}
          />
        );
      case "network":
        return (
          <NetworkSurface
            graph={networkGraph}
            invites={networkInvites}
            providers={oauthProviders}
            onRefresh={() => {
              void loadNetworkGraph();
              void loadNetworkInvites(business.id);
            }}
            onSyncContacts={() => void runAction("network-sync", syncPhoneNetwork)}
            onSyncSocial={(provider) =>
              void runAction("network-social", () => syncSocialNetwork(provider))
            }
            onRoute={(targetNodeId) =>
              void runAction("network-route", () => requestNetworkRoute(targetNodeId))
            }
            onApproveRoute={(routeId) =>
              void runAction("network-route-approve", () => approveNetworkRoute(routeId))
            }
            onRejectRoute={(routeId) =>
              void runAction("network-route-reject", () => rejectNetworkRoute(routeId))
            }
            onDisconnectSource={(sourceId) =>
              void runAction("network-disconnect", () => disconnectNetworkSource(sourceId))
            }
          />
        );
      case "sync":
        return (
          <SyncSurface
            summary={syncSummary}
            items={syncQueue}
            offlineCache={offlineCache}
            storefrontUrl={publicStorefrontUrl}
            onInvite={() => void shareOwnerStorefrontInvite()}
            onSyncContacts={() => void syncOwnerPhoneContacts(setChatMessages)}
            onImportContacts={(event) => void importContactsFile(event)}
            onExportContacts={exportOwnerContacts}
            onRefresh={() => {
              void loadSyncQueue(business.id);
              void loadOfflineCache(business.id);
            }}
            onReplay={() =>
              void runAction("sync-replay", () =>
                replaySyncQueue({
                  loadProducts,
                  loadCustomers,
                  loadInvoices,
                  loadPaymentData,
                  loadLogistics
                })
              )
            }
            onReplayItem={(syncItemId) =>
              void runAction("sync-replay-item", () =>
                replaySyncQueueItem(syncItemId, {
                  loadProducts,
                  loadCustomers,
                  loadInvoices,
                  loadPaymentData,
                  loadLogistics
                })
              )
            }
          />
        );
      case "runtime":
        return (
          <RuntimeSurface
            sessions={runtimeSessions}
            selectedSessionId={selectedRuntimeHistorySessionId}
            turns={runtimeTurns}
            onCreateSession={() =>
              void runAction("runtime-session-create", () =>
                createRuntimeHistorySession(setRuntimeSessionId)
              )
            }
            onRefresh={() => void loadRuntimeSessions(business.id)}
            onSelectSession={(sessionId) => {
              setSelectedRuntimeHistorySessionId(sessionId);
              void loadRuntimeTurns(business.id, sessionId);
            }}
          />
        );
      case "payments":
        return (
          <PaymentSurface
            invoices={invoices}
            payments={payments}
            invoicePayments={invoicePayments}
            customerDebts={customerDebts}
            form={paymentForm}
            onFormChange={setPaymentForm}
            onRecord={() => void runAction("payment-record", recordPayment)}
            onRefresh={() => void loadPaymentData(business.id)}
          />
        );
      case "imports":
        return (
          <ImportSurface
            form={importForm}
            importJobs={importJobs}
            activeImportJob={activeImportJob}
            selectedImportJobId={selectedImportJobId}
            onFormChange={setImportForm}
            onCreate={() => void runAction("import-create", createDocumentImport)}
            onSelectJob={setSelectedImportJobId}
            onRowChange={updateImportRowLocal}
            onSaveRow={(job, row) =>
              void runAction("import-row-save", () => saveImportRow(job, row))
            }
            onConfirm={(job) => void runAction("import-confirm", () => confirmImport(job))}
            onRefresh={() => void loadDocumentImports(business.id)}
          />
        );
      case "logistics":
        return (
          <LogisticsSurface
            invoices={invoices}
            logistics={logistics}
            form={logisticsForm}
            onFormChange={setLogisticsForm}
            onCreate={() => void runAction("logistics-create", createLogistics)}
            onStatusChange={(logisticsId, status) =>
              void runAction("logistics-status", () => updateLogisticsStatus(logisticsId, status))
            }
            onRefresh={() => void loadLogistics(business.id)}
          />
        );
      case "compliance":
        return (
          <ComplianceSurface
            form={complianceForm}
            securityReview={securityReview}
            dataExport={dataExport}
            verification={verificationTier}
            taxConfig={taxConfig}
            deviceTrust={deviceTrust}
            onFormChange={setComplianceForm}
            onExport={() => void runAction("compliance-export", createDataExport)}
            onSaveVerification={() =>
              void runAction("compliance-verification", saveVerificationTier)
            }
            onSaveTax={() => void runAction("compliance-tax", saveTaxConfig)}
            onSaveDeviceTrust={() => void runAction("compliance-device", saveDeviceTrust)}
            onRefresh={() => void loadCompliance(business.id)}
          />
        );
      case "beta":
        return (
          <BetaSurface
            form={betaForm}
            readiness={betaReadiness}
            supportTickets={betaSupportTickets}
            onFormChange={setBetaForm}
            onUpdateAccess={() => void runAction("beta-access", updateBetaAccess)}
            onEnableFlags={() => void runAction("beta-flags", enableBetaFlags)}
            onRecordDeviceTest={() => void runAction("beta-device", recordBetaDeviceTest)}
            onCreateSupportTicket={() =>
              void runAction("beta-ticket-create", createBetaSupportTicket)
            }
            onUpdateSupportTicket={(supportTicketId, status) =>
              void runAction("beta-ticket-update", () =>
                updateBetaSupportTicketStatus(supportTicketId, status)
              )
            }
            onRecordTelemetry={() => void runAction("beta-telemetry", recordBetaTelemetry)}
            onRefresh={() => void loadBetaReadiness(business.id)}
          />
        );
      case "launch":
        return (
          <LaunchSurface
            form={launchForm}
            readiness={launchReadiness}
            incidents={launchIncidents}
            onFormChange={setLaunchForm}
            onUpdateSettings={() => void runAction("launch-settings", updateLaunchSettings)}
            onUpdateChecklist={() => void runAction("launch-checklist", updateLaunchChecklist)}
            onCreateIncident={() => void runAction("launch-incident-create", createLaunchIncident)}
            onUpdateIncident={(incidentId, status) =>
              void runAction("launch-incident-update", () =>
                updateLaunchIncidentStatus(incidentId, status)
              )
            }
            onRefresh={() => void loadLaunchReadiness(business.id)}
          />
        );
      case "reports":
        return (
          <ReportsSurface
            report={reportSummary}
            knowledge={knowledgeSummary}
            onRefresh={() => void loadReports(business.id)}
          />
        );
      case "notifications":
        return (
          <NotificationsSurface
            careRequests={storefrontCareRequests}
            inbox={notificationInbox}
            messages={storefrontMessages}
            orders={storefrontOrders}
            onRefresh={() => {
              void loadNotifications(business.id);
              void loadStorefrontInbox(business.id);
            }}
            onUpdate={(notificationId, status) =>
              void runAction("notification-update", () =>
                updateNotification(notificationId, status)
              )
            }
          />
        );
      default:
        return null;
    }
  }

  return (
    <OwnerCoreProvider value={ownerCoreValue}>
      <Surface title="Soko.market">
        <div
          className={isAuthScreen ? "app-frame auth-frame" : "app-frame"}
          data-shell-instance={shellInstanceIdRef.current}
          data-capability-profile={capabilitySettingsRef.current.profile}
        >
          <header className={isAuthScreen ? "top-bar auth-top-bar" : "top-bar"}>
            {business === null ? (
              <div className="auth-brand-title">
                <AppIcon className="auth-header-icon" />
                <span>soko.market</span>
              </div>
            ) : (
              <button
                className="brand-lockup"
                type="button"
                onClick={() => setupComplete && openAgentProfile()}
                onPointerEnter={() => prefetchOwnerView("agent", business.id)}
                onFocus={() => prefetchOwnerView("agent", business.id)}
              >
                <AppIcon className="logo-mark" />
                <span>
                  <strong>Soko.market</strong>
                  <span>{business.name}</span>
                  <small>{shouldShowAuth ? "Saved workspace loaded" : agentSettings.name}</small>
                  <small>{business.sokoId}</small>
                </span>
              </button>
            )}
            {isAuthScreen && installPrompt.canInstall ? (
              <button
                className="header-action-button workspace"
                type="button"
                data-testid="install-app-button"
                onClick={() => void installPrompt.installApp()}
              >
                Install app
              </button>
            ) : null}
            {!isAuthScreen ? (
              <div className="header-actions">
                {installPrompt.canInstall ? (
                  <button
                    className="header-action-button workspace"
                    type="button"
                    data-testid="install-app-button"
                    onClick={() => void installPrompt.installApp()}
                  >
                    Install app
                  </button>
                ) : null}
                <button
                  className={`header-action-button marketplace ${
                    mode === "marketplace" ? "mode-active" : ""
                  }`}
                  type="button"
                  data-testid="marketplace-button"
                  aria-expanded={mode === "marketplace" && isMarketplaceShortcutOpen}
                  onClick={() => {
                    if (mode === "marketplace") {
                      navigateToView("chat");
                      setIsMarketplaceShortcutOpen((open) => !open);
                      return;
                    }
                    switchMode("marketplace");
                  }}
                >
                  Marketplace
                </button>
                <button
                  className="header-action-button messages"
                  type="button"
                  data-testid="messages-button"
                  aria-expanded={isMessagingInboxOpen}
                  onClick={() => {
                    navigateToView("chat");
                    setIsMessagingInboxOpen((open) => !open);
                  }}
                >
                  Messages
                </button>
                <button
                  className={
                    mode === "seller"
                      ? "header-action-button mode-active"
                      : "header-action-button sell"
                  }
                  type="button"
                  data-testid="sell-button"
                  onClick={() => switchMode(mode === "seller" ? "marketplace" : "seller")}
                  aria-pressed={mode === "seller"}
                >
                  {mode === "seller" ? "Shop" : "Sell"}
                </button>
                {session === null ? (
                  <>
                    <button
                      className="header-auth-button secondary"
                      type="button"
                      data-testid="header-signup-button"
                      onClick={() => openAuth("signup")}
                    >
                      Sign up
                    </button>
                    <button
                      className="header-auth-button"
                      type="button"
                      data-testid="header-login-button"
                      onClick={() => openAuth("login")}
                    >
                      Log in
                    </button>
                  </>
                ) : null}
                {business !== null && mode === "seller" ? (
                  <button
                    className="header-action-button"
                    type="button"
                    onClick={() => setIsWorkspacePanelOpen(true)}
                    aria-haspopup="dialog"
                  >
                    Workspace
                  </button>
                ) : null}
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => {
                    if (business === null) {
                      openAuth();
                    } else {
                      openAgentProfile();
                    }
                  }}
                  aria-label={business === null ? "Owner login" : "Account and agent settings"}
                  data-testid={business === null ? undefined : "agent-profile-link"}
                  onPointerEnter={() => prefetchOwnerView("agent", business?.id ?? null)}
                  onFocus={() => prefetchOwnerView("agent", business?.id ?? null)}
                >
                  <span aria-hidden="true">{userLabel.slice(0, 1).toUpperCase()}</span>
                </button>
              </div>
            ) : null}
          </header>

          {!isAuthScreen &&
          statusMessage.length > 0 &&
          !isRedundantAgentErrorMessage(statusMessage) ? (
            <div className="app-action-notice" role="status" aria-live="polite">
              {hasPending ? "Working…" : <AuthenticationActionMessage message={statusMessage} />}
            </div>
          ) : null}

          {authBootstrapPending ? (
            <NativeLaunchScreen
              message={bootstrapProgressMessage(
                authBootstrapState,
                business !== null,
                agentSettings.name.trim().length > 0
              )}
            />
          ) : shouldShowAuth && authenticationView === "signup" ? (
            <PhoneSignup
              onAuthenticated={(response) => void completePhoneFirstAuthentication(response)}
              onLogIn={() => openAuth("login")}
              onCancel={browseAsGuest}
            />
          ) : shouldShowAuth ? (
            <PhoneFirstAuthentication
              key={authenticationView}
              remembered={rememberedAccount}
              onAuthenticated={(response) => void completePhoneFirstAuthentication(response)}
              onSignUp={() => openAuth("signup")}
              onForgetRemembered={forgetRememberedOwnerAuth}
              onCancel={browseAsGuest}
            />
          ) : isAccountRestorationOpen && session !== null ? (
            <Suspense fallback={<NativeLaunchScreen message="Opening account restoration…" />}>
              <AccountRestorationPanel
                onRestored={completeAccountRestoration}
                onCancel={() => {
                  setIsAccountRestorationOpen(false);
                  navigateToOwnerRoute({ mode: "marketplace", view: "chat" }, { replace: true });
                  setStatusMessage("Account restoration cancelled.");
                }}
              />
            </Suspense>
          ) : isBusinessSetupOpen && business === null ? (
            <BusinessSetupPanel
              step={businessSetupStep}
              businessName={businessName}
              language={language}
              phoneCountryCode={shopPhoneCountryCode}
              phoneNumber={shopPhoneNumber}
              statusMessage={statusMessage}
              isPending={isPending("business-create") || isPending("owner-phone-save")}
              onBusinessNameChange={setBusinessName}
              onLanguageChange={setLanguage}
              onPhoneCountryCodeChange={setShopPhoneCountryCode}
              onPhoneNumberChange={setShopPhoneNumber}
              onContinuePhone={(phoneNumber, country) =>
                void runAction("owner-phone-save", () =>
                  saveOwnerPhoneForShop(phoneNumber, country)
                )
              }
              onEditPhone={() => setBusinessSetupStep("phone")}
              onBackToLoginOptions={() => {
                setIsBusinessSetupOpen(false);
                openAuth();
              }}
              onCancel={() => {
                setIsBusinessSetupOpen(false);
                setStatusMessage(
                  "Business setup cancelled. You can keep browsing the marketplace."
                );
              }}
              onCreateBusiness={() => void runAction("business-create", createBusiness)}
            />
          ) : view === "agent" && business !== null ? (
            <AgentProfileSurface
              agent={agentSettings}
              accountId={session?.account.id ?? ""}
              identityLevel={session?.account.identityLevel ?? "device"}
              business={business}
              oauthProviders={oauthProviders}
              ownerLabel={userLabel}
              ownerUser={session?.user ?? null}
              registeredEmail={
                session?.user.emailAddress ??
                (session?.account.primaryAuthChannel === "email"
                  ? session.account.primaryAuthDestination
                  : null)
              }
              storefrontUrl={publicStorefrontUrl}
              shops={sokoSessionContext?.shops ?? []}
              onSwitchBusiness={switchActiveBusiness}
              onAgentChange={setAgentSettings}
              onIdentityLevelChange={(identityLevel) =>
                setSession((current) =>
                  current === null
                    ? current
                    : { ...current, account: { ...current.account, identityLevel } }
                )
              }
              onAccountMerged={(response) => {
                acceptAuthenticatedSession(response);
                setStatusMessage("Accounts joined after identity verification.");
              }}
              onOwnerUserChange={(user) =>
                setSession((current) => (current === null ? current : { ...current, user }))
              }
              onBack={returnToChat}
              onEnableNotifications={requestMessagingNotifications}
              onDisableNotifications={disableMessagingNotifications}
              onEnsureRuntimeSession={() => ensureRuntimeSession(setRuntimeSessionId)}
              onLogout={() => void runAction("logout", logout)}
              onLogoutAll={() => void runAction("logout-all", () => logout(true))}
              onScheduleAccountDeletion={scheduleAccountDeletion}
              isLoggingOut={isPending("logout") || isPending("logout-all")}
            />
          ) : (
            <main
              className={`chat-workspace-shell ${
                business !== null && mode === "seller" ? "with-primary-navigation" : ""
              }`}
            >
              {business !== null && mode === "seller" ? (
                <PrimaryNavigation
                  activeView={view}
                  notificationCount={notificationInbox.summary.unread}
                  onNavigate={navigateToView}
                  onPrefetch={(nextView) => prefetchOwnerView(nextView, business.id)}
                />
              ) : null}
              {deviceCloudFallbackModelId !== null ? (
                <section
                  className="device-model-fallback-notice"
                  aria-labelledby="device-model-fallback-title"
                >
                  <div>
                    <strong id="device-model-fallback-title">
                      Use your selected OpenAI fallback here?
                    </strong>
                    <p>
                      This device does not have a ready copy of your preferred local model. Soko can
                      use the OpenAI model you explicitly selected while leaving the downloaded
                      model on the other device unchanged.
                    </p>
                  </div>
                  <div className="device-model-fallback-actions">
                    <button type="button" onClick={enableDeviceCloudFallback}>
                      Allow OpenAI fallback here
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={declineDeviceCloudFallback}
                    >
                      Keep OpenAI off
                    </button>
                  </div>
                  <small>
                    OpenAI receives chat context only after this explicit approval and only when no
                    downloaded model is ready on this device. You can turn it off in Agent settings.
                  </small>
                </section>
              ) : null}
              <ChatSurface
                chatDraft={chatDraft}
                initialEmailSubject={
                  activeConversation?.messages
                    .slice()
                    .reverse()
                    .find((message) => message.provider === "email" && message.subject)?.subject ??
                  ""
                }
                customerCount={customers.length}
                invoiceCount={invoices.length}
                invoices={invoices}
                messages={chatMessages}
                conversations={conversationInbox}
                activeConversationId={activeConversationId}
                isInboxOpen={isMessagingInboxOpen}
                isContactTyping={isContactTyping}
                isConfirming={isPending("runtime-confirm")}
                isSending={isPending("chat-send")}
                isBrowserGenerating={isBrowserGenerating}
                securityLabel={
                  isBrowserGenerating
                    ? "On-device · generating"
                    : session === null
                      ? "Sign in for end-to-end encrypted messaging"
                      : isHumanDirectConversation(activeConversation, session)
                        ? "End-to-end encrypted"
                        : "Messages are processed by the Soko agent"
                }
                replyToMessageId={replyToMessageId}
                networkGraph={networkGraph}
                notificationCount={notificationInbox.summary.unread}
                oauthProviders={oauthProviders}
                oauthProvidersLoaded={oauthProvidersLoaded}
                pendingAttachments={pendingAttachments}
                productForm={productForm}
                productFields={productFields}
                productCount={products.length}
                products={products}
                publicStorefronts={publicStorefronts}
                publicStorefrontsLoading={publicStorefrontsLoading}
                report={reportSummary}
                shopPresenceStatus={shopPresenceStatus}
                workspaceOpen={isWorkspacePanelOpen}
                syncSummary={syncSummary}
                buyFeed={buyFeed}
                isSearchingBuyFeed={isPending("buy-search")}
                buyCart={buyCart}
                isCheckingOut={isPending("buy-checkout")}
                onAttachmentChange={handleChatAttachmentChange}
                onSellerPhotoCapture={(file) => void handleSellerPhotoCapture(file)}
                onStatusBroadcastPosted={handleStatusBroadcastPosted}
                onSearchBuyFeed={(query) => void handleSearchBuyFeed(query)}
                onAddToCart={handleAddToCart}
                onRemoveFromCart={handleRemoveFromCart}
                onCheckout={() => void handleCheckout()}
                onBackToChat={returnToChat}
                onConfirm={(token) =>
                  void runAction("runtime-confirm", () => confirmRuntimeAction(token))
                }
                onDraftChange={(draft) => void signalTyping(draft)}
                onSelectConversation={(conversationId) => void selectConversation(conversationId)}
                onCreateConversation={(recipient, title) =>
                  void runAction("conversation-create", () =>
                    createDirectConversation(recipient, title)
                  )
                }
                onRequireSignIn={requireMessagingSignIn}
                onBrowseAsGuest={browseAsGuest}
                onSignUp={() => openAuth("signup")}
                onLogIn={() => openAuth("login")}
                onRefreshPublicStorefronts={() => void loadPublicStorefronts()}
                onConversationPreference={(conversationId, preference) =>
                  void runAction("conversation-preference", () =>
                    updateConversationPreference(conversationId, preference)
                  )
                }
                onEnableNotifications={() =>
                  void runAction("push-notifications", requestMessagingNotifications)
                }
                onInboxOpenChange={setIsMessagingInboxOpen}
                onReply={setReplyToMessageId}
                onCancelReply={() => setReplyToMessageId(null)}
                onEditMessage={(messageId, text) =>
                  void runAction("message-edit", () => updateMessageAction(messageId, { text }))
                }
                onDeleteMessage={(messageId) =>
                  void runAction("message-delete", () =>
                    updateMessageAction(messageId, { deleted: true })
                  )
                }
                onReactMessage={(messageId, reaction) =>
                  void runAction(`message-reaction-${messageId}`, () =>
                    updateMessageAction(messageId, { reaction })
                  )
                }
                onAgentFeedback={(messageId, correct) =>
                  void runAction(`agent-feedback-${messageId}`, () =>
                    submitAgentResponseFeedback(messageId, correct)
                  )
                }
                onForwardMessage={(messageId, conversationId) =>
                  void runAction("message-forward", () => forwardMessage(messageId, conversationId))
                }
                onRetryMessages={() => void runAction("message-retry", retryQueuedMessages)}
                onCloseWorkspace={() => setIsWorkspacePanelOpen(false)}
                onOpenWorkspace={() => setIsWorkspacePanelOpen(true)}
                onNavigate={navigateToView}
                onModeChange={switchMode}
                onProductEdit={(product) => {
                  setProductForm({
                    id: product.id,
                    name: product.name,
                    sku: product.sku ?? "",
                    unit: product.unit,
                    quantity: String(product.quantity),
                    buyingPrice: product.buyingPrice === null ? "" : String(product.buyingPrice),
                    sellingPrice: product.sellingPrice === null ? "" : String(product.sellingPrice)
                  });
                  setStockProductId(product.id);
                  setStockQuantityAfter(String(product.quantity));
                }}
                onProductFieldsSave={(fields) =>
                  void runAction("product-fields-save", () => saveProductFieldStructure(fields))
                }
                onProductFormChange={setProductForm}
                onProductRemove={(productId) =>
                  void runAction("product-delete", () => deleteProduct(productId))
                }
                onProductReset={() => setProductForm(emptyProductForm)}
                onProductSave={async () => (await runAction("product-save", saveProduct)) ?? false}
                onNetworkDisconnectSource={(sourceId) =>
                  void runAction("network-disconnect", () => disconnectNetworkSource(sourceId))
                }
                onNetworkPhoneContactsSync={syncSelectedNetworkPhoneContacts}
                onNetworkInviteContacts={(contacts) =>
                  runAction("network-invite", () => inviteNetworkContacts(contacts)).then(
                    (count) => count ?? 0
                  )
                }
                onNetworkProviderOAuth={authenticateSocialProfile}
                onNetworkRefresh={() => void loadNetworkGraph()}
                onRemoveAttachment={removePendingAttachment}
                onStatusChange={updateShopPresenceStatus}
                onOpenAgentProfile={() => openAgentProfile()}
                onCompleteMarketplaceIntro={() => void completeMarketplaceIntro()}
                marketplaceIntroComplete={isMarketplaceIntroComplete}
                marketplaceShortcutOpen={isMarketplaceShortcutOpen || session === null}
                onSend={(draft, provider, subject, invoiceId) =>
                  void runAction("chat-send", () =>
                    sendChatDraft(draft, provider, subject, invoiceId)
                  )
                }
                channelEndpoints={activeConversation?.channels ?? []}
                onCancelGeneration={() => void cancelBrowserGeneration()}
                onSmsHandoff={recordSmsHandoff}
                onPlatformHandoff={recordPlatformHandoff}
              >
                {renderActiveWorkspace()}
              </ChatSurface>
            </main>
          )}
          <footer className="app-credits">
            <span>Karibu Soko</span>
            <BuildIdentity />
          </footer>
        </div>
      </Surface>
    </OwnerCoreProvider>
  );
}
