import { useRef, useState } from "react";

import type { ChatMessage, ShellView, SokoMode } from "../app-shell";
import {
  canNavigateBackWithinApp,
  navigateToBrowserUrl,
  navigateToOwnerRoute,
  readSokoHistoryState
} from "../browser-navigation";
import { getErrorMessage } from "../chat-message-plumbing";
import { patchJson } from "../api-helpers";
import { markNavigationCommitted, startNavigationMeasurement } from "../performance";
import { authenticationRoute, pathForOwnerView } from "../routes";
import { createScreenStateCache, restoreScreenScroll } from "../screen-state-cache";
import type {
  ActiveBusiness,
  AgentSettings,
  ProductSummary,
  SessionResponse,
  ShopPresenceStatus,
  ShopPresenceSummary
} from "../soko-application-shared";
import { guestBrowsingStorageKey } from "../soko-application-shared";

interface UseNavigationStateDeps {
  business: ActiveBusiness | null;
  session: SessionResponse | null;
  mode: SokoMode;
  setMode: (mode: SokoMode) => void;
  view: ShellView;
  setView: (view: ShellView) => void;
  agentSettings: AgentSettings;
  isMarketplaceIntroComplete: boolean;
  preservedScreenLimit: number;
  initialRoutedProductId: string | null;
  populateProductForm: (product: ProductSummary) => void;
  setStatusMessage: (message: string) => void;
  setIsWorkspacePanelOpen: (open: boolean) => void;
  runAction: (key: string, action: () => Promise<void>) => Promise<void>;
  // Auth/BusinessSetup/Chat are called after Navigation (they depend on navigateToView/
  // requireMessagingSignIn at their own hook-call time), so Navigation can't take their setters as
  // plain deps without a TDZ error. Getters defer the read to when openAuth/browseAsGuest/switchMode
  // actually run (a click or an effect, always after every hook in this render has completed) - same
  // getter pattern established in Phase 9 for values, applied here to cross-domain setters instead.
  getAuthSetters: () => {
    setIsAuthOpen: (open: boolean) => void;
    setAuthenticationView: (view: "signup" | "login") => void;
    setIsAccountRestorationOpen: (open: boolean) => void;
  };
  getBusinessSetupSetters: () => {
    setIsBusinessSetupOpen: (open: boolean) => void;
    setBusinessSetupStep: (step: "phone" | "details") => void;
  };
  getChatSetters: () => {
    setIsMessagingInboxOpen: (open: boolean) => void;
    setChatMessages: (messages: (current: ChatMessage[]) => ChatMessage[]) => void;
  };
  registerReset: (domainKey: string, fn: () => void) => void;
}

export function useNavigationState(deps: UseNavigationStateDeps) {
  const screenStateCacheRef = useRef(createScreenStateCache(deps.preservedScreenLimit));
  const activeViewRef = useRef(deps.view);
  activeViewRef.current = deps.view;
  const [isMarketplaceShortcutOpen, setIsMarketplaceShortcutOpen] = useState(false);
  const [shopPresenceStatus, setShopPresenceStatus] = useState<ShopPresenceStatus>("online");
  const [routedProductId, setRoutedProductId] = useState<string | null>(
    deps.initialRoutedProductId
  );

  const {
    business,
    session,
    mode,
    setMode,
    setView,
    agentSettings,
    isMarketplaceIntroComplete,
    populateProductForm,
    setStatusMessage,
    setIsWorkspacePanelOpen,
    runAction
  } = deps;

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
    const { setIsBusinessSetupOpen } = deps.getBusinessSetupSetters();
    const { setIsAuthOpen, setAuthenticationView } = deps.getAuthSetters();
    sessionStorage.removeItem(guestBrowsingStorageKey);
    setIsBusinessSetupOpen(false);
    setIsAuthOpen(true);
    setAuthenticationView(intent);
    setStatusMessage(intent === "signup" ? "Create your Soko account." : "Log in to your account.");
    navigateToBrowserUrl(authenticationRoute(intent), { state: window.history.state });
  }

  function browseAsGuest() {
    const { setIsAuthOpen, setIsAccountRestorationOpen } = deps.getAuthSetters();
    const { setIsBusinessSetupOpen } = deps.getBusinessSetupSetters();
    const { setIsMessagingInboxOpen } = deps.getChatSetters();
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

  function switchMode(nextMode: SokoMode) {
    const { setIsBusinessSetupOpen, setBusinessSetupStep } = deps.getBusinessSetupSetters();

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

    const { setChatMessages } = deps.getChatSetters();
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

  deps.registerReset("navigation", () => {
    setIsMarketplaceShortcutOpen(false);
    setShopPresenceStatus("online");
    setRoutedProductId(null);
  });

  return {
    isMarketplaceShortcutOpen,
    setIsMarketplaceShortcutOpen,
    shopPresenceStatus,
    setShopPresenceStatus,
    routedProductId,
    setRoutedProductId,
    screenStateCacheRef,
    navigateToView,
    openProduct,
    openAgentProfile,
    returnToChat,
    requireMessagingSignIn,
    openAuth,
    browseAsGuest,
    switchMode,
    updateShopPresenceStatus
  };
}
