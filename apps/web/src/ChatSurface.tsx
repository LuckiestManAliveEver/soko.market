import { Fragment, Suspense, useEffect, useRef, useState } from "react";

import type { CountryCode } from "libphonenumber-js";

import type { MessageDeliveryAttemptSummary } from "@soko/shared-types";

import { detectCapabilitySettings } from "./capability-profile";
import { recordReadiness } from "./performance";

import { AuthenticationActionMessage } from "./AuthenticationActionMessage";
import { useOwnerCore } from "./hooks/OwnerCoreContext";
import { useChatComposerState } from "./hooks/useChatComposerState";
import { ChatComposer } from "./ChatComposer";

import { SmsHandoffDialog } from "./soko-application-shared";
import { renderGeneratedSurface } from "./generated-surface-registry";

import { getJson } from "./api-helpers";
import { formatMessageTime, formatFileSize, formatAttachmentCategory } from "./formatters";

import { viewLabel } from "./agent-command-engine";
import {
  conversationMessageText,
  isRedundantAgentErrorMessage,
  getErrorMessage
} from "./chat-message-plumbing";

import { ShopPresenceButtons } from "./ShopPresenceButtons";

import { MarketplaceModeCard } from "./MarketplaceModeCard";
import { StorefrontPreviewCard } from "./StorefrontPreviewCard";
import { ContextualBusinessCards } from "./ContextualBusinessCards";
import { NetworkSyncNestedCard } from "./NetworkSyncNestedCard";
import { CatalogueNestedCard } from "./CatalogueNestedCard";
import { StackedModule } from "./StackedModule";
import type { ChatSurfaceProps } from "./chat-surface-contracts";
export type { ChatSurfaceProps } from "./chat-surface-contracts";

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
  onCloseMarketplace,
  onCloseWorkspace,
  onDraftChange,
  onSelectConversation,
  onCreateConversation,
  onCreateAgentSession,
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
  // surfaces it wraps (renderOwnerWorkspace()'s switch result renders inside ChatSurface's
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

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const defaultMessageWindow = useRef(detectCapabilitySettings().messageWindowSize).current;
  const [messageWindowSize, setMessageWindowSize] = useState(defaultMessageWindow);
  const [inboxSearch, setInboxSearch] = useState("");
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [newRecipient, setNewRecipient] = useState("");
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");
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
  const showMessageThread = true;
  const activeModuleView = activeView === "chat" || activeView === "home" ? null : activeView;
  const isSessionListView = activeView === "home";
  const selectedConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId
  );
  const selectedEmailCustomerId = channelEndpoints.find(
    (endpoint) => endpoint.provider === "email"
  )?.customerId;
  const composer = useChatComposerState({
    activeConversationId,
    channelEndpoints,
    chatDraft,
    initialEmailSubject,
    smsDefaultCountry,
    onDraftChange,
    onPlatformHandoff,
    onSend
  });
  const {
    commitDraft,
    liveDraft,
    openPlatformHandoff,
    openSmsHandoff,
    setSmsHandoffRequest,
    smsHandoffRequest
  } = composer;
  const visibleConversations = showMessageThread
    ? conversations
        // Home is the account's own agent-session list (Phase 3), not the general messaging
        // inbox - a DM or storefront/order conversation never appears there. Selecting "chat"
        // keeps today's full inbox unchanged.
        .filter((conversation) =>
          isSessionListView
            ? conversation.kind === "personal" && !conversation.hasHumanRecipient
            : true
        )
        .filter((conversation) => {
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

  useEffect(() => {
    if (!workspaceOpen) {
      setWorkspaceCardView("cards");
    }
  }, [workspaceOpen]);

  useEffect(() => {
    setWorkspaceCardView("cards");
  }, [mode]);

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
            <h2>{isSessionListView ? "Sessions" : "Messages"}</h2>
            {isSessionListView ? (
              <button
                type="button"
                onClick={() =>
                  isAuthenticated ? setIsNewSessionOpen((open) => !open) : onRequireSignIn()
                }
              >
                New session
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  isAuthenticated ? setIsNewConversationOpen((open) => !open) : onRequireSignIn()
                }
              >
                New
              </button>
            )}
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
          {isNewConversationOpen && !isSessionListView ? (
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
          {isNewSessionOpen && isSessionListView ? (
            <form
              className="new-session-form"
              onSubmit={(event) => {
                event.preventDefault();
                onCreateAgentSession(newSessionTitle.trim() || undefined);
                setNewSessionTitle("");
                setIsNewSessionOpen(false);
              }}
            >
              <label>
                Name
                <input
                  value={newSessionTitle}
                  onChange={(event) => setNewSessionTitle(event.target.value)}
                  placeholder="e.g. Restock maize"
                />
              </label>
              <div className="new-conversation-actions">
                <button type="submit">Start session</button>
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
            {visibleConversations.length === 0 ? (
              <p>
                {isSessionListView
                  ? "No sessions yet. Start one to talk with your agent."
                  : "No matching conversations."}
              </p>
            ) : null}
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
          {windowedMessages.map((message) => (
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
            </Fragment>
          ))}
        </div>
        <StackedModule
          moduleId="owner-management"
          open={activeModuleView !== null}
          title={activeModuleView === null ? "Soko" : viewLabel(activeModuleView)}
          onClose={onBackToChat}
        >
          {children}
        </StackedModule>
        <StackedModule
          moduleId="marketplace"
          open={activeModuleView === null && mode === "marketplace" && marketplaceShortcutOpen}
          title="Marketplace"
          onClose={onCloseMarketplace}
        >
          {workspaceCardView === "storefrontPreview" ? (
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
          )}
        </StackedModule>
        <StackedModule
          moduleId="workspace"
          open={workspaceOpen}
          title={workspacePanelTitle(workspaceCardView)}
          onClose={onCloseWorkspace}
        >
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
        </StackedModule>
        <ChatComposer
          channelEndpoints={channelEndpoints}
          composer={composer}
          invoices={invoices}
          isAuthenticated={isAuthenticated}
          isBrowserGenerating={isBrowserGenerating}
          isSending={isSending}
          mode={mode}
          pendingAttachments={pendingAttachments}
          replyToMessageId={replyToMessageId}
          selectedConversationTitle={selectedConversation?.title ?? ""}
          selectedEmailCustomerId={selectedEmailCustomerId}
          onAttachmentChange={onAttachmentChange}
          onCancelGeneration={onCancelGeneration}
          onCancelReply={onCancelReply}
          onRemoveAttachment={onRemoveAttachment}
          onRequireSignIn={onRequireSignIn}
          onSellerPhotoCapture={onSellerPhotoCapture}
        />
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
