import {
  Fragment,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from "react";

import type { CountryCode } from "libphonenumber-js";

import type {
  BuyFeedSummary,
  BuyResultSummary,
  ConversationInboxItem,
  ChannelEndpointSummary,
  ChannelProvider,
  MessageHandoffStatus,
  MessageDeliveryAttemptSummary,
  ProductFieldDefinition
} from "@soko/shared-types";
import { type ChatAttachment, type ChatMessage, type ShellView, type SokoMode } from "./app-shell";

import { detectCapabilitySettings } from "./capability-profile";
import { recordReadiness } from "./performance";

import type { SmsHandoffRequest } from "./messaging/SmsHandoffDialog";
import { normalizeSmsRecipient } from "./messaging/sms-handoff";
import { shareMessageExternally } from "./messaging/platform-handoff";

import { AuthenticationActionMessage } from "./AuthenticationActionMessage";
import { useOwnerCore } from "./hooks/OwnerCoreContext";

import {
  type BusinessReportSummary,
  type BuyCartItem,
  type ContactPickerContact,
  type InvoiceSummary,
  type NetworkGraphSummary,
  type OAuthProviderSummary,
  type ProductFieldDraft,
  type ProductFormState,
  type ProductSummary,
  type PublicStorefrontSummary,
  type ShopPresenceStatus,
  SmsHandoffDialog,
  type SocialSignupProvider,
  type SyncQueueSummary,
  chatAttachmentAccept
} from "./soko-application-shared";
import { renderGeneratedSurface } from "./generated-surface-registry";

import { getJson } from "./api-helpers";
import {
  formatMessageTime,
  formatFileSize,
  formatChannelProvider,
  formatAttachmentCategory
} from "./formatters";

import { viewLabel } from "./agent-command-engine";
import {
  conversationMessageText,
  isExtractableChatAttachment,
  startVoiceInput,
  isRedundantAgentErrorMessage,
  getErrorMessage
} from "./chat-message-plumbing";

import { ShopPresenceButtons } from "./ShopPresenceButtons";

import { MarketplaceModeCard } from "./MarketplaceModeCard";
import { StorefrontPreviewCard } from "./StorefrontPreviewCard";
import { ContextualBusinessCards } from "./ContextualBusinessCards";
import { NetworkSyncNestedCard } from "./NetworkSyncNestedCard";
import { CatalogueNestedCard } from "./CatalogueNestedCard";

export interface ChatSurfaceProps {
  activeConversationId: string | null;
  chatDraft: string;
  initialEmailSubject: string;
  channelEndpoints: ChannelEndpointSummary[];
  children: ReactNode;
  conversations: ConversationInboxItem[];
  customerCount: number;
  invoiceCount: number;
  invoices: InvoiceSummary[];
  messages: ChatMessage[];
  isInboxOpen: boolean;
  isContactTyping: boolean;
  isConfirming: boolean;
  isSending: boolean;
  isBrowserGenerating: boolean;
  securityLabel: string;
  replyToMessageId: string | null;
  marketplaceIntroComplete: boolean;
  marketplaceShortcutOpen: boolean;
  networkGraph: NetworkGraphSummary | null;
  notificationCount: number;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  pendingAttachments: ChatAttachment[];
  productForm: ProductFormState;
  productFields: ProductFieldDefinition[];
  productCount: number;
  products: ProductSummary[];
  publicStorefronts: PublicStorefrontSummary[];
  publicStorefrontsLoading: boolean;
  report: BusinessReportSummary | null;
  shopPresenceStatus: ShopPresenceStatus;
  syncSummary: SyncQueueSummary;
  workspaceOpen: boolean;
  buyFeed: BuyFeedSummary | null;
  isSearchingBuyFeed: boolean;
  buyCart: BuyCartItem[];
  isCheckingOut: boolean;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSellerPhotoCapture: (file: File) => void;
  onStatusBroadcastPosted: (statusBroadcastId: string) => void;
  onSearchBuyFeed: (query: string) => void;
  onAddToCart: (result: BuyResultSummary) => void;
  onRemoveFromCart: (cartItemId: string) => void;
  onCheckout: () => void;
  onBackToChat: () => void;
  onCloseWorkspace: () => void;
  onDraftChange: (draft: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: (recipient: string, title: string) => void;
  onRequireSignIn: () => void;
  onBrowseAsGuest: () => void;
  onSignUp: () => void;
  onLogIn: () => void;
  onRefreshPublicStorefronts: () => void;
  onConversationPreference: (
    conversationId: string,
    preference: "archive" | "mute" | "pin"
  ) => void;
  onEnableNotifications: () => void;
  onInboxOpenChange: (open: boolean) => void;
  onReply: (messageId: string) => void;
  onCancelReply: () => void;
  onEditMessage: (messageId: string, text: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onReactMessage: (messageId: string, reaction: string | null) => void;
  onAgentFeedback: (messageId: string, correct: boolean) => void;
  onForwardMessage: (messageId: string, conversationId: string) => void;
  onRetryMessages: () => void;
  onNavigate: (view: ShellView) => void;
  onOpenWorkspace: () => void;
  onModeChange: (mode: SokoMode) => void;
  onOpenAgentProfile: () => void;
  onCompleteMarketplaceIntro: () => void;
  onProductEdit: (product: ProductSummary) => void;
  onProductFieldsSave: (fields: ProductFieldDraft[]) => void;
  onProductFormChange: (form: ProductFormState) => void;
  onProductRemove: (productId: string) => void;
  onProductReset: () => void;
  onProductSave: () => Promise<boolean>;
  onNetworkDisconnectSource: (sourceId: string) => void;
  onNetworkPhoneContactsSync: (
    selectedContacts: ContactPickerContact[]
  ) => Promise<NetworkGraphSummary | null>;
  onNetworkInviteContacts: (selectedContacts: ContactPickerContact[]) => Promise<number>;
  onNetworkProviderOAuth: (provider: SocialSignupProvider) => Promise<void>;
  onNetworkRefresh: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onStatusChange: (status: ShopPresenceStatus) => void;
  onConfirm: (confirmationToken: string) => void;
  onSend: (draft: string, provider?: ChannelProvider, subject?: string, invoiceId?: string) => void;
  onCancelGeneration: () => void;
  onSmsHandoff: (status: MessageHandoffStatus, normalizedErrorCode: string | null) => void;
  onPlatformHandoff: (status: MessageHandoffStatus, normalizedErrorCode: string | null) => void;
}

export function ChatSurface({
  activeConversationId,
  chatDraft,
  initialEmailSubject,
  channelEndpoints,
  children,
  conversations,
  customerCount,
  invoiceCount,
  invoices,
  messages,
  isInboxOpen,
  isContactTyping,
  isConfirming,
  isSending,
  isBrowserGenerating,
  securityLabel,
  replyToMessageId,
  marketplaceIntroComplete,
  marketplaceShortcutOpen,
  networkGraph,
  notificationCount,
  oauthProviders,
  oauthProvidersLoaded,
  pendingAttachments,
  productForm,
  productFields,
  productCount,
  products,
  publicStorefronts,
  publicStorefrontsLoading,
  report,
  shopPresenceStatus,
  syncSummary,
  workspaceOpen,
  buyFeed,
  isSearchingBuyFeed,
  buyCart,
  isCheckingOut,
  onAttachmentChange,
  onSellerPhotoCapture,
  onStatusBroadcastPosted,
  onSearchBuyFeed,
  onAddToCart,
  onRemoveFromCart,
  onCheckout,
  onBackToChat,
  onCloseWorkspace,
  onDraftChange,
  onSelectConversation,
  onCreateConversation,
  onRequireSignIn,
  onBrowseAsGuest,
  onSignUp,
  onLogIn,
  onRefreshPublicStorefronts,
  onConversationPreference,
  onEnableNotifications,
  onInboxOpenChange,
  onReply,
  onCancelReply,
  onEditMessage,
  onDeleteMessage,
  onReactMessage,
  onAgentFeedback,
  onForwardMessage,
  onRetryMessages,
  onNavigate,
  onOpenWorkspace,
  onModeChange,
  onOpenAgentProfile,
  onCompleteMarketplaceIntro,
  onProductEdit,
  onProductFieldsSave,
  onProductFormChange,
  onProductRemove,
  onProductReset,
  onProductSave,
  onNetworkDisconnectSource,
  onNetworkPhoneContactsSync,
  onNetworkInviteContacts,
  onNetworkProviderOAuth,
  onNetworkRefresh,
  onRemoveAttachment,
  onStatusChange,
  onConfirm,
  onSend,
  onCancelGeneration,
  onSmsHandoff,
  onPlatformHandoff
}: ChatSurfaceProps) {
  // Identity/business/agent/nav state ChatSurface doesn't own itself but forwards to the domain
  // surfaces it wraps (renderActiveWorkspace()'s switch result renders inside ChatSurface's
  // children) - read directly from OwnerCoreContext instead of threading through OwnerApp's JSX
  // call site as props, since ChatSurface is the parent of those surfaces, not a peer of them.
  // Kept under the same local names the rest of this component already uses throughout.
  const { session, business, agentSettings, view, mode } = useOwnerCore();
  const activeView = view;
  const agent = agentSettings;
  const businessId = business?.id ?? null;
  const businessName = business?.name ?? "Your shop";
  const hasBusiness = business !== null;
  const isAuthenticated = session !== null;
  const sokoId = business?.sokoId ?? "Not set up yet";
  const smsDefaultCountry = (session?.user.phoneCountryCode as CountryCode | undefined) ?? "KE";

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sellerPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const defaultMessageWindow = useRef(detectCapabilitySettings().messageWindowSize).current;
  const [messageWindowSize, setMessageWindowSize] = useState(defaultMessageWindow);
  const [inboxSearch, setInboxSearch] = useState("");
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [newRecipient, setNewRecipient] = useState("");
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [activeMessageMenuId, setActiveMessageMenuId] = useState<string | null>(null);
  const [openDeliveryAttemptsMessageId, setOpenDeliveryAttemptsMessageId] = useState<string | null>(
    null
  );
  const [deliveryAttemptsByMessage, setDeliveryAttemptsByMessage] = useState<
    Record<string, MessageDeliveryAttemptSummary[]>
  >({});
  const [deliveryAttemptsLoading, setDeliveryAttemptsLoading] = useState<string | null>(null);
  const [deliveryAttemptsError, setDeliveryAttemptsError] = useState<string | null>(null);

  async function toggleDeliveryAttempts(messageId: string) {
    if (openDeliveryAttemptsMessageId === messageId) {
      setOpenDeliveryAttemptsMessageId(null);
      return;
    }
    setOpenDeliveryAttemptsMessageId(messageId);
    if (activeConversationId === null || deliveryAttemptsByMessage[messageId] !== undefined) return;
    setDeliveryAttemptsLoading(messageId);
    setDeliveryAttemptsError(null);
    try {
      const response = await getJson<{ attempts: MessageDeliveryAttemptSummary[] }>(
        `/v1/conversations/${encodeURIComponent(activeConversationId)}/messages/${encodeURIComponent(
          messageId
        )}/delivery-attempts`
      );
      setDeliveryAttemptsByMessage((current) => ({ ...current, [messageId]: response.attempts }));
    } catch (error) {
      setDeliveryAttemptsError(getErrorMessage(error));
    } finally {
      setDeliveryAttemptsLoading(null);
    }
  }
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [smsHandoffRequest, setSmsHandoffRequest] = useState<SmsHandoffRequest | null>(null);
  const [externalShareNotice, setExternalShareNotice] = useState<string | null>(null);
  const [liveDraft, setLiveDraft] = useState(chatDraft);
  const [emailSubject, setEmailSubject] = useState(initialEmailSubject);
  const [emailInvoiceId, setEmailInvoiceId] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ChannelProvider | null>(null);
  const draftSyncTimerRef = useRef<number | null>(null);
  const workspaceDialogRef = useRef<HTMLElement | null>(null);
  const workspaceReturnFocusRef = useRef<HTMLElement | null>(null);
  const [workspaceCardView, setWorkspaceCardView] = useState<
    | "cards"
    | "catalogue"
    | "addProduct"
    | "editProduct"
    | "deleteProduct"
    | "manageFields"
    | "networkSync"
    | "storefrontPreview"
  >("cards");
  const showMessageThread = activeView === "chat" || activeView === "home";
  const selectedConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId
  );
  const selectedEmailCustomerId = channelEndpoints.find(
    (endpoint) => endpoint.provider === "email"
  )?.customerId;
  const visibleConversations = showMessageThread
    ? conversations.filter((conversation) => {
        const query = inboxSearch.trim().toLowerCase();
        if (!query) return true;
        return (
          (conversation.title ?? "Soko agent").toLowerCase().includes(query) ||
          (conversation.lastMessage === null
            ? false
            : conversationMessageText(conversation.lastMessage).toLowerCase().includes(query))
        );
      })
    : [];
  const visibleMessages = showMessageThread
    ? messages.filter((message) => !isRedundantAgentErrorMessage(message.body))
    : [];
  const hiddenMessageCount = Math.max(0, visibleMessages.length - messageWindowSize);
  const windowedMessages = visibleMessages.slice(hiddenMessageCount);

  function clearDraftSyncTimer() {
    if (draftSyncTimerRef.current === null) return;
    window.clearTimeout(draftSyncTimerRef.current);
    draftSyncTimerRef.current = null;
  }

  function updateLiveDraft(nextDraft: string) {
    setLiveDraft(nextDraft);
    clearDraftSyncTimer();
    draftSyncTimerRef.current = window.setTimeout(() => {
      draftSyncTimerRef.current = null;
      onDraftChange(nextDraft);
    }, 120);
  }

  function commitDraft(nextDraft: string) {
    clearDraftSyncTimer();
    setLiveDraft(nextDraft);
    onDraftChange(nextDraft);
  }

  function sendLiveDraft() {
    clearDraftSyncTimer();
    onSend(
      liveDraft,
      selectedProvider ?? undefined,
      selectedProvider === "email" ? emailSubject : undefined,
      selectedProvider === "email" && emailInvoiceId !== "" ? emailInvoiceId : undefined
    );
  }

  function openSmsHandoff(recipient: string, label: string) {
    let normalizedCandidate = "";
    try {
      normalizedCandidate = normalizeSmsRecipient(recipient, smsDefaultCountry);
    } catch {
      // The confirmation sheet collects or corrects a missing contact number.
    }
    setSmsHandoffRequest({
      body: liveDraft,
      label: label.trim() || "SMS recipient",
      recipient: normalizedCandidate || recipient
    });
  }

  async function openPlatformHandoff(label: string) {
    const result = await shareMessageExternally({
      text: liveDraft,
      title: label.trim() ? `Message for ${label.trim()}` : "Message from Soko"
    });
    onPlatformHandoff(result.status, result.errorCode);
    setExternalShareNotice(
      result.status === "share_completed"
        ? "Handed to your selected app. Delivery status stays with that app."
        : result.status === "copied_to_clipboard"
          ? "Message copied. Paste it into any messaging app or connected-device service."
          : result.status === "share_unavailable"
            ? "External sharing is not available on this device. Use SMS or copy the message manually."
            : null
    );
  }

  useEffect(() => {
    setLiveDraft(chatDraft);
  }, [chatDraft]);

  useEffect(() => {
    setEmailSubject(initialEmailSubject);
    setEmailInvoiceId("");
  }, [activeConversationId, initialEmailSubject]);

  useEffect(() => {
    const available = channelEndpoints.find(
      (endpoint) =>
        endpoint.status === "available" &&
        endpoint.configured &&
        endpoint.authorized &&
        (endpoint.capabilities.includes("CAN_REPLY") ||
          endpoint.capabilities.includes("CAN_INITIATE"))
    );
    setSelectedProvider(available?.provider ?? null);
  }, [activeConversationId, channelEndpoints]);

  useEffect(
    () => () => {
      clearDraftSyncTimer();
    },
    []
  );

  useEffect(() => {
    if (!workspaceOpen) {
      setWorkspaceCardView("cards");
    }
  }, [workspaceOpen]);

  useEffect(() => {
    setWorkspaceCardView("cards");
  }, [mode]);

  useEffect(() => {
    if (!workspaceOpen) return;
    workspaceReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = workspaceDialogRef.current;
    dialog?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseWorkspace();
        return;
      }
      if (event.key !== "Tab" || dialog === null) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      workspaceReturnFocusRef.current?.focus();
    };
  }, [workspaceOpen, onCloseWorkspace]);

  useEffect(() => {
    setMessageWindowSize(defaultMessageWindow);
  }, [activeConversationId, defaultMessageWindow]);

  useEffect(() => {
    recordReadiness("composer");
  }, []);

  useEffect(() => {
    if (messages.length > 0) recordReadiness("chat-first-message");
  }, [messages.length]);

  useEffect(() => {
    function closeMessageMenu(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveMessageMenuId(null);
        setForwardingMessageId(null);
        setEditingMessageId(null);
        setDeletingMessageId(null);
      }
    }
    document.addEventListener("keydown", closeMessageMenu);
    return () => document.removeEventListener("keydown", closeMessageMenu);
  }, []);

  useEffect(() => {
    if (!showMessageThread) return;
    const frameId = window.requestAnimationFrame(() => {
      messageListRef.current?.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: "auto"
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeConversationId, messages.length, showMessageThread, workspaceCardView]);

  return (
    <div className={`chat-surface ${showMessageThread && isInboxOpen ? "inbox-open" : ""}`}>
      {showMessageThread ? (
        <aside
          className={`messenger-inbox ${isInboxOpen ? "open" : ""}`}
          aria-label="Conversations"
        >
          <div className="messenger-inbox-heading">
            <h2>Messages</h2>
            <button
              type="button"
              onClick={() =>
                isAuthenticated ? setIsNewConversationOpen((open) => !open) : onRequireSignIn()
              }
            >
              New
            </button>
          </div>
          <div className="messenger-inbox-tools">
            <label>
              <span className="visually-hidden">Search conversations</span>
              <input
                type="search"
                value={inboxSearch}
                onChange={(event) => setInboxSearch(event.target.value)}
                placeholder="Search messages"
              />
            </label>
            <button
              className="secondary"
              type="button"
              onClick={isAuthenticated ? onEnableNotifications : onRequireSignIn}
            >
              Notifications
            </button>
          </div>
          {isNewConversationOpen ? (
            <form
              className="new-conversation-form"
              onSubmit={(event) => {
                event.preventDefault();
                onCreateConversation(newRecipient, newConversationTitle);
                setNewRecipient("");
                setNewConversationTitle("");
                setIsNewConversationOpen(false);
              }}
            >
              <label>
                Phone number or email
                <input
                  required
                  value={newRecipient}
                  onChange={(event) => setNewRecipient(event.target.value)}
                  placeholder="+254 700 000 000 or name@example.com"
                />
              </label>
              <label>
                Name
                <input
                  value={newConversationTitle}
                  onChange={(event) => setNewConversationTitle(event.target.value)}
                  placeholder="Conversation name"
                />
              </label>
              <small>
                Soko chats require a registered user and are end-to-end encrypted. SMS and external
                apps use their own privacy and delivery rules.
              </small>
              <div className="new-conversation-actions">
                <button type="submit">Start encrypted chat</button>
                <button
                  className="secondary"
                  type="button"
                  disabled={newRecipient.trim().length === 0 || liveDraft.trim().length === 0}
                  onClick={() => openSmsHandoff(newRecipient, newConversationTitle)}
                >
                  Send as SMS
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={liveDraft.trim().length === 0}
                  onClick={() => void openPlatformHandoff(newConversationTitle)}
                >
                  Share to apps
                </button>
              </div>
            </form>
          ) : null}
          <div className="conversation-list">
            {visibleConversations.map((conversation) => (
              <article
                className={`conversation-item ${conversation.id === activeConversationId ? "active" : ""}`}
                key={conversation.id}
              >
                <button
                  className="conversation-select"
                  type="button"
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    onInboxOpenChange(false);
                  }}
                >
                  <span>
                    <strong>{conversation.title ?? "Soko agent"}</strong>
                    <small>
                      {conversation.lastMessage === null
                        ? "No messages yet"
                        : conversationMessageText(conversation.lastMessage)}
                    </small>
                  </span>
                  {conversation.unreadCount > 0 ? (
                    <b aria-label={`${conversation.unreadCount} unread`}>
                      {conversation.unreadCount}
                    </b>
                  ) : null}
                </button>
                <div className="conversation-actions" aria-label="Conversation actions">
                  <button
                    type="button"
                    onClick={() => onConversationPreference(conversation.id, "pin")}
                  >
                    {conversation.participant.pinnedAt ? "Unpin" : "Pin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onConversationPreference(conversation.id, "mute")}
                  >
                    {conversation.participant.mutedUntil ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onConversationPreference(conversation.id, "archive")}
                  >
                    Archive
                  </button>
                </div>
              </article>
            ))}
            {visibleConversations.length === 0 ? <p>No matching conversations.</p> : null}
          </div>
        </aside>
      ) : null}
      <section className="messenger-thread" aria-label={selectedConversation?.title ?? "Chat"}>
        {showMessageThread ? (
          <header className="messenger-thread-header">
            <div>
              <strong>{selectedConversation?.title ?? agent.name}</strong>
              <small>{isContactTyping ? "typing…" : securityLabel}</small>
            </div>
            <button className="secondary" type="button" onClick={onRetryMessages}>
              Retry failed
            </button>
          </header>
        ) : null}
        <div className="message-list" aria-live="polite" ref={messageListRef}>
          {hiddenMessageCount > 0 ? (
            <button
              className="load-older-messages"
              type="button"
              onClick={() => setMessageWindowSize((size) => size + defaultMessageWindow)}
            >
              Load {Math.min(hiddenMessageCount, defaultMessageWindow)} older messages
            </button>
          ) : null}
          {windowedMessages.map((message, index) => (
            <Fragment key={message.id}>
              <article
                className={`message ${message.author}`}
                data-testid={message.id === "welcome" ? "welcome-message" : undefined}
              >
                <span className="message-author">
                  {message.author === "merchant" ? (
                    "You"
                  ) : message.author === "contact" ? (
                    (message.authorLabel ?? "Contact")
                  ) : (
                    <>
                      <button
                        className="message-author-link"
                        type="button"
                        onClick={onOpenAgentProfile}
                        disabled={!hasBusiness}
                        aria-label={hasBusiness ? `Open ${agent.name} profile` : undefined}
                      >
                        {agent.name}
                      </button>
                      <ShopPresenceButtons
                        activeStatus={shopPresenceStatus}
                        onStatusChange={onStatusChange}
                      />
                    </>
                  )}
                </span>
                {message.replyToMessageId ? <small className="message-context">Reply</small> : null}
                {message.forwardedFromMessageId ? (
                  <small className="message-context">Forwarded</small>
                ) : null}
                <p className={message.deletedAt ? "deleted-message" : undefined}>
                  {message.author === "sokoclaw" ? (
                    <AuthenticationActionMessage message={message.body} />
                  ) : (
                    message.body
                  )}
                </p>
                {message.content?.type === "owner-controls" &&
                message.content.shopId === businessId ? (
                  <ContextualBusinessCards
                    productCount={productCount}
                    customerCount={customerCount}
                    invoiceCount={invoiceCount}
                    notificationCount={notificationCount}
                    report={report}
                    syncSummary={syncSummary}
                    onOpenCatalogue={() => {
                      setWorkspaceCardView("catalogue");
                      onOpenWorkspace();
                    }}
                    onOpenNetworkSync={() => {
                      setWorkspaceCardView("networkSync");
                      onOpenWorkspace();
                    }}
                    onPreviewStorefront={() => {
                      setWorkspaceCardView("storefrontPreview");
                      onOpenWorkspace();
                    }}
                    onNavigate={onNavigate}
                  />
                ) : null}
                {renderGeneratedSurface(message.content, {
                  businessId,
                  onStatusBroadcastPosted
                })}
                {message.id === "welcome" && !isAuthenticated ? (
                  <div className="welcome-auth-actions" aria-label="Account access">
                    <button type="button" data-testid="welcome-signup-button" onClick={onSignUp}>
                      Sign up
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      data-testid="welcome-login-button"
                      onClick={onLogIn}
                    >
                      Log in
                    </button>
                    <button className="secondary" type="button" onClick={onBrowseAsGuest}>
                      Browse as guest
                    </button>
                  </div>
                ) : null}
                {message.attachments !== undefined && message.attachments.length > 0 ? (
                  <div className="message-attachments" aria-label="Message attachments">
                    {message.attachments.map((attachment) => (
                      <a
                        className="message-attachment"
                        href={attachment.dataUrl}
                        download={attachment.name}
                        key={attachment.id}
                      >
                        {attachment.category === "image" && attachment.dataUrl ? (
                          <img
                            src={attachment.dataUrl}
                            alt={attachment.name}
                            width={160}
                            height={120}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : null}
                        <span>{attachment.name}</span>
                        <small>
                          {formatAttachmentCategory(attachment.category)} ·{" "}
                          {formatFileSize(attachment.size)}
                        </small>
                      </a>
                    ))}
                  </div>
                ) : null}
                <div className="message-meta">
                  {message.createdAt ? (
                    <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                  ) : null}
                  {message.editedAt ? <span>edited</span> : null}
                  {message.author === "merchant" && message.status ? (
                    <span>{message.status}</span>
                  ) : null}
                  {message.author === "merchant" && !message.id.startsWith("welcome") ? (
                    <button type="button" onClick={() => void toggleDeliveryAttempts(message.id)}>
                      {openDeliveryAttemptsMessageId === message.id
                        ? "Hide delivery attempts"
                        : "Delivery attempts"}
                    </button>
                  ) : null}
                </div>
                {openDeliveryAttemptsMessageId === message.id ? (
                  <div className="message-context" aria-label="Delivery attempts">
                    {deliveryAttemptsLoading === message.id ? (
                      <small>Loading delivery attempts…</small>
                    ) : deliveryAttemptsError !== null &&
                      deliveryAttemptsByMessage[message.id] === undefined ? (
                      <small>{deliveryAttemptsError}</small>
                    ) : (deliveryAttemptsByMessage[message.id] ?? []).length === 0 ? (
                      <small>No delivery attempts recorded for this message.</small>
                    ) : (
                      (deliveryAttemptsByMessage[message.id] ?? []).map((attempt) => (
                        <small key={attempt.id}>
                          #{attempt.attemptNumber} · {attempt.channel} via {attempt.provider} ·{" "}
                          {attempt.result.replace(/_/gu, " ")}
                          {attempt.normalizedFailureCode
                            ? ` (${attempt.normalizedFailureCode})`
                            : ""}{" "}
                          · {formatMessageTime(attempt.requestedAt)}
                        </small>
                      ))
                    )}
                  </div>
                ) : null}
                {message.reactions?.length ? (
                  <div className="message-reactions" aria-label="Reactions">
                    {message.reactions.map((reaction) => (
                      <span key={`${reaction.actorId}-${reaction.emoji}`}>{reaction.emoji}</span>
                    ))}
                  </div>
                ) : null}
                {!message.deletedAt && !message.id.startsWith("welcome") ? (
                  <div className="message-actions">
                    {message.author === "sokoclaw" ? (
                      <>
                        <button
                          type="button"
                          aria-label="Mark agent response correct"
                          onClick={() => onAgentFeedback(message.id, true)}
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          aria-label="Flag agent response as incorrect"
                          onClick={() => onAgentFeedback(message.id, false)}
                        >
                          Incorrect
                        </button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => onReply(message.id)}>
                      Reply
                    </button>
                    <button
                      type="button"
                      aria-expanded={activeMessageMenuId === message.id}
                      aria-haspopup="menu"
                      onClick={() =>
                        setActiveMessageMenuId(
                          activeMessageMenuId === message.id ? null : message.id
                        )
                      }
                    >
                      More
                    </button>
                    {activeMessageMenuId === message.id ? (
                      <div className="message-action-menu" role="menu">
                        {["👍", "❤️", "😂", "😮", "🙏"].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            aria-label={`React ${emoji}`}
                            onClick={() => {
                              setActiveMessageMenuId(null);
                              onReactMessage(message.id, emoji);
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                        {message.author === "merchant" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessageId(message.id);
                              setEditingMessageText(message.body);
                              setActiveMessageMenuId(null);
                            }}
                          >
                            Edit
                          </button>
                        ) : null}
                        {message.author === "merchant" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingMessageId(message.id);
                              setActiveMessageMenuId(null);
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                        <button type="button" onClick={() => setForwardingMessageId(message.id)}>
                          Forward
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {editingMessageId === message.id ? (
                  <form
                    className="message-inline-action"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = editingMessageText.trim();
                      if (text.length === 0) return;
                      onEditMessage(message.id, text);
                      setEditingMessageId(null);
                    }}
                  >
                    <label>
                      Edit message
                      <input
                        autoFocus
                        value={editingMessageText}
                        onChange={(event) => setEditingMessageText(event.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={editingMessageText.trim().length === 0}>
                      Save edit
                    </button>
                    <button type="button" onClick={() => setEditingMessageId(null)}>
                      Cancel
                    </button>
                  </form>
                ) : null}
                {deletingMessageId === message.id ? (
                  <div
                    className="message-inline-action"
                    role="alertdialog"
                    aria-label="Delete message?"
                  >
                    <span>Delete this message?</span>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => {
                        onDeleteMessage(message.id);
                        setDeletingMessageId(null);
                      }}
                    >
                      Delete message
                    </button>
                    <button type="button" onClick={() => setDeletingMessageId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                {forwardingMessageId === message.id ? (
                  <div className="forward-picker">
                    <span>Forward to:</span>
                    {conversations
                      .filter((conversation) => conversation.id !== activeConversationId)
                      .map((conversation) => (
                        <button
                          type="button"
                          key={conversation.id}
                          onClick={() => {
                            onForwardMessage(message.id, conversation.id);
                            setForwardingMessageId(null);
                          }}
                        >
                          {conversation.title ?? "Soko agent"}
                        </button>
                      ))}
                    <button type="button" onClick={() => setForwardingMessageId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                {message.confirmationToken !== undefined ? (
                  <button
                    type="button"
                    onClick={() => onConfirm(message.confirmationToken ?? "")}
                    disabled={isConfirming}
                    aria-busy={isConfirming}
                  >
                    {isConfirming ? "Confirming…" : "Confirm"}
                  </button>
                ) : null}
              </article>
              {index === 0 &&
              activeView === "chat" &&
              mode === "marketplace" &&
              marketplaceShortcutOpen ? (
                workspaceCardView === "storefrontPreview" ? (
                  <StorefrontPreviewCard
                    businessName={businessName}
                    products={products}
                    sokoId={sokoId}
                    onBack={() => setWorkspaceCardView("cards")}
                    onOpenProfile={onOpenAgentProfile}
                    onAddToOrder={(product) =>
                      commitDraft(`I'd like to request 1 ${product.unit} of ${product.name}.`)
                    }
                    onSell={() => onModeChange("seller")}
                    onMessage={() => commitDraft(`Hello ${businessName}, `)}
                  />
                ) : (
                  <MarketplaceModeCard
                    businessName={businessName}
                    hasBusiness={hasBusiness}
                    isAuthenticated={isAuthenticated}
                    isIntro={!marketplaceIntroComplete}
                    isLoadingStorefronts={publicStorefrontsLoading}
                    productCount={productCount}
                    publicStorefronts={publicStorefronts}
                    sokoId={sokoId}
                    buyFeed={buyFeed}
                    isSearchingBuyFeed={isSearchingBuyFeed}
                    buyCart={buyCart}
                    isCheckingOut={isCheckingOut}
                    onCompleteIntro={onCompleteMarketplaceIntro}
                    onOpenStore={() => setWorkspaceCardView("storefrontPreview")}
                    onPrompt={commitDraft}
                    onRefreshStorefronts={onRefreshPublicStorefronts}
                    onSell={() => onModeChange("seller")}
                    onSearchBuyFeed={onSearchBuyFeed}
                    onAddToCart={onAddToCart}
                    onRemoveFromCart={onRemoveFromCart}
                    onCheckout={onCheckout}
                  />
                )
              ) : null}
            </Fragment>
          ))}
          {activeView !== "chat" && activeView !== "home" ? (
            <section className="generated-card-detail" aria-label={viewLabel(activeView)}>
              <div className="generated-card-header">
                <button className="secondary" type="button" onClick={onBackToChat}>
                  Close
                </button>
              </div>
              {children}
            </section>
          ) : null}
        </div>
        {workspaceOpen ? (
          <div className="workspace-panel-backdrop" role="presentation">
            <section
              className="workspace-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Workspace cards"
              tabIndex={-1}
              ref={workspaceDialogRef}
            >
              <div className="workspace-panel-heading">
                <h2>{workspacePanelTitle(workspaceCardView)}</h2>
                <button type="button" onClick={onCloseWorkspace} aria-label="Close workspace">
                  ×
                </button>
              </div>
              {workspaceCardView === "cards" ? (
                <ContextualBusinessCards
                  productCount={productCount}
                  customerCount={customerCount}
                  invoiceCount={invoiceCount}
                  notificationCount={notificationCount}
                  report={report}
                  syncSummary={syncSummary}
                  onOpenCatalogue={() => setWorkspaceCardView("catalogue")}
                  onOpenNetworkSync={() => setWorkspaceCardView("networkSync")}
                  onPreviewStorefront={() => setWorkspaceCardView("storefrontPreview")}
                  onNavigate={(nextView) => {
                    onNavigate(nextView);
                    onCloseWorkspace();
                  }}
                />
              ) : workspaceCardView === "networkSync" ? (
                <NetworkSyncNestedCard
                  graph={networkGraph}
                  oauthProviders={oauthProviders}
                  oauthProvidersLoaded={oauthProvidersLoaded}
                  onBack={() => setWorkspaceCardView("cards")}
                  onDisconnectSource={onNetworkDisconnectSource}
                  onOAuthProvider={onNetworkProviderOAuth}
                  onPhoneContactsSync={onNetworkPhoneContactsSync}
                  onInviteContacts={onNetworkInviteContacts}
                  onRefresh={onNetworkRefresh}
                />
              ) : workspaceCardView === "storefrontPreview" ? (
                <StorefrontPreviewCard
                  businessName={businessName}
                  products={products}
                  sokoId={sokoId}
                  onBack={() => setWorkspaceCardView("cards")}
                  onOpenProfile={onOpenAgentProfile}
                  onAddToOrder={(product) =>
                    commitDraft(`I'd like to request 1 ${product.unit} of ${product.name}.`)
                  }
                  onSell={() => onModeChange("marketplace")}
                  onMessage={() => commitDraft(`Hello ${businessName}, `)}
                />
              ) : (
                <CatalogueNestedCard
                  form={productForm}
                  fields={productFields}
                  products={products}
                  view={workspaceCardView}
                  onBack={() =>
                    setWorkspaceCardView(workspaceCardView === "catalogue" ? "cards" : "catalogue")
                  }
                  onChangeForm={onProductFormChange}
                  onDeleteProduct={onProductRemove}
                  onEditProduct={onProductEdit}
                  onOpenAdd={() => {
                    onProductReset();
                    setWorkspaceCardView("addProduct");
                  }}
                  onOpenDelete={() => setWorkspaceCardView("deleteProduct")}
                  onOpenEdit={() => {
                    if (products[0] !== undefined) {
                      onProductEdit(products[0]);
                    }
                    setWorkspaceCardView("editProduct");
                  }}
                  onOpenFields={() => setWorkspaceCardView("manageFields")}
                  onOpenProduct={(product) => {
                    onProductEdit(product);
                    setWorkspaceCardView("editProduct");
                  }}
                  onSaveFields={onProductFieldsSave}
                  onSaveProduct={async () => {
                    if (await onProductSave()) setWorkspaceCardView("catalogue");
                  }}
                />
              )}
            </section>
          </div>
        ) : null}
        {!isAuthenticated ? (
          <div className="composer composer-card-lock">
            <span>Sign in to send and receive end-to-end encrypted messages.</span>
            <button type="button" onClick={onRequireSignIn}>
              Sign in to message
            </button>
          </div>
        ) : (
          <div className="composer">
            {replyToMessageId ? (
              <div className="composer-reply">
                <span>Replying to a message</span>
                <button type="button" onClick={onCancelReply}>
                  Cancel
                </button>
              </div>
            ) : null}
            <button
              className="icon-button composer-icon-button"
              type="button"
              aria-label="Voice input"
              title="Voice input"
              onClick={() => startVoiceInput(commitDraft)}
            >
              <span className="mic-icon" aria-hidden="true" />
            </button>
            <button
              className="icon-button composer-icon-button"
              type="button"
              aria-label="Attach file"
              title="Attach file"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="attach-icon" aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              className="chat-file-input"
              type="file"
              multiple
              accept={chatAttachmentAccept}
              onChange={onAttachmentChange}
            />
            {mode === "seller" ? (
              <>
                <button
                  className="icon-button composer-icon-button"
                  type="button"
                  aria-label="Add product from photo"
                  title="Add product from photo"
                  data-testid="seller-photo-button"
                  onClick={() => sellerPhotoInputRef.current?.click()}
                >
                  <span className="camera-icon" aria-hidden="true" />
                </button>
                <input
                  ref={sellerPhotoInputRef}
                  className="chat-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  data-testid="seller-photo-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) onSellerPhotoCapture(file);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
            {pendingAttachments.length > 0 ? (
              <div className="attachment-workbench">
                <div className="attachment-tray" aria-label="Selected attachments">
                  {pendingAttachments.map((attachment) => (
                    <span className="attachment-chip" key={attachment.id}>
                      <span>
                        <strong>{attachment.name}</strong>
                        <small>
                          {formatAttachmentCategory(attachment.category)} ·{" "}
                          {formatFileSize(attachment.size)}
                        </small>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => onRemoveAttachment(attachment.id)}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                {pendingAttachments.some(isExtractableChatAttachment) ? (
                  <div className="document-instructions" aria-label="Document instructions">
                    <span>OCR ready for scans and images</span>
                    <button type="button" onClick={() => commitDraft("Extract all readable text")}>
                      Extract text
                    </button>
                    <button
                      type="button"
                      onClick={() => commitDraft("Summarize this document in simple bullet points")}
                    >
                      Summarize
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commitDraft("Extract names, dates, totals, and line items into a table")
                      }
                    >
                      Extract fields
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {channelEndpoints.length > 0 ? (
              <label className="composer-channel-selector">
                <span>Send via</span>
                <select
                  aria-label="Send message via"
                  value={selectedProvider ?? ""}
                  onChange={(event) =>
                    setSelectedProvider(
                      event.target.value === "" ? null : (event.target.value as ChannelProvider)
                    )
                  }
                >
                  <option value="" disabled>
                    No available channel
                  </option>
                  {channelEndpoints.map((endpoint) => {
                    const available =
                      (endpoint.status === "available" ||
                        (endpoint.status === "offline" &&
                          endpoint.capabilities.includes("SUPPORTS_OFFLINE"))) &&
                      endpoint.configured &&
                      endpoint.authorized &&
                      (endpoint.capabilities.includes("CAN_REPLY") ||
                        endpoint.capabilities.includes("CAN_INITIATE"));
                    return (
                      <option
                        key={endpoint.channelId}
                        value={endpoint.provider}
                        disabled={!available}
                      >
                        {formatChannelProvider(endpoint.provider)} ·{" "}
                        {endpoint.provider === "native_sms" && endpoint.status === "offline"
                          ? "queued — waiting for Android device"
                          : available
                            ? endpoint.provider === "native_sms"
                              ? "via Android device"
                              : "available"
                            : endpoint.status}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
            {selectedProvider === "email" ? (
              <>
                <label className="composer-input">
                  <span>Subject</span>
                  <input
                    aria-label="Email subject"
                    required
                    maxLength={200}
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                    placeholder="Required for email"
                  />
                </label>
                <label className="composer-input">
                  <span>Trusted attachment</span>
                  <select
                    aria-label="Attach a confirmed invoice"
                    value={emailInvoiceId}
                    onChange={(event) => setEmailInvoiceId(event.target.value)}
                  >
                    <option value="">No attachment</option>
                    {invoices
                      .filter(
                        (invoice) =>
                          invoice.status === "confirmed" &&
                          invoice.customerId === selectedEmailCustomerId
                      )
                      .map((invoice) => (
                        <option value={invoice.id} key={invoice.id}>
                          Invoice {invoice.invoiceNumber} · {invoice.customerName ?? "Customer"}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="composer-input">
              <span>Message</span>
              <textarea
                aria-label="Message"
                rows={1}
                value={liveDraft}
                onChange={(event) => updateLiveDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !isSending) {
                    event.preventDefault();
                    sendLiveDraft();
                  }
                }}
                placeholder={
                  mode === "seller"
                    ? "Ask your agent to manage the shop"
                    : "What are you looking for?"
                }
              />
            </label>
            <div className="composer-send-actions">
              {isBrowserGenerating ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={onCancelGeneration}
                  aria-label="Cancel on-device generation"
                >
                  Cancel
                </button>
              ) : null}
              <button
                className="sms-send-button"
                type="button"
                disabled={liveDraft.trim().length === 0}
                onClick={() =>
                  openSmsHandoff(
                    selectedConversation?.title ?? "",
                    selectedConversation?.title ?? "SMS recipient"
                  )
                }
              >
                Send as SMS
              </button>
              <button
                className="share-send-button"
                type="button"
                disabled={liveDraft.trim().length === 0}
                title="Share outside Soko using an installed app or connected-device service"
                onClick={() => void openPlatformHandoff(selectedConversation?.title ?? "")}
              >
                Share to apps
              </button>
              <button
                className="send-button"
                type="button"
                onClick={sendLiveDraft}
                disabled={
                  isSending ||
                  (selectedProvider === "email" && emailSubject.trim().length === 0) ||
                  (liveDraft.trim().length === 0 && pendingAttachments.length === 0)
                }
                aria-busy={isSending}
              >
                <span className="send-icon" aria-hidden="true" />
                <span className="visually-hidden">Send</span>
              </button>
            </div>
            {externalShareNotice !== null ? (
              <small className="external-share-notice" role="status">
                {externalShareNotice}
                {pendingAttachments.length > 0
                  ? " Attachments remain in Soko and were not shared."
                  : " External messages are not covered by Soko end-to-end encryption."}
              </small>
            ) : null}
          </div>
        )}
        {smsHandoffRequest !== null ? (
          <Suspense fallback={null}>
            <SmsHandoffDialog
              key={`${smsHandoffRequest.recipient}:${smsHandoffRequest.body}`}
              {...smsHandoffRequest}
              defaultCountry={smsDefaultCountry}
              hasAttachments={pendingAttachments.length > 0}
              onClose={() => setSmsHandoffRequest(null)}
              onRecord={onSmsHandoff}
            />
          </Suspense>
        ) : null}
      </section>
    </div>
  );
}

export function workspacePanelTitle(
  view:
    | "cards"
    | "catalogue"
    | "addProduct"
    | "editProduct"
    | "deleteProduct"
    | "manageFields"
    | "networkSync"
    | "storefrontPreview"
): string {
  if (view === "cards") {
    return "Workspace";
  }

  if (view === "networkSync") {
    return "My Network";
  }

  if (view === "storefrontPreview") {
    return "Public shop view";
  }

  return "Catalogue";
}
