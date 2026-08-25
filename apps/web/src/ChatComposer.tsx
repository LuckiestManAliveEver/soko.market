import { useRef, useState, type ChangeEvent } from "react";

import type { ChannelEndpointSummary, ChannelProvider } from "@soko/shared-types";
import { runtimeHashtagCapabilities, runtimeHashtagQuery } from "@soko/tool-core";

import type { ChatAttachment, SokoMode } from "./app-shell";
import { type InvoiceSummary, chatAttachmentAccept } from "./soko-application-shared";
import { formatAttachmentCategory, formatChannelProvider, formatFileSize } from "./formatters";
import { chatModuleCommands } from "./chat-module-commands";
import { isExtractableChatAttachment, startVoiceInput } from "./chat-message-plumbing";
import type { ChatComposerState } from "./hooks/useChatComposerState";
import { ChatComposerActions } from "./ChatComposerActions";
import { ChatHashtagCapabilityPicker } from "./ChatHashtagCapabilityPicker";

interface ChatComposerProps {
  channelEndpoints: ChannelEndpointSummary[];
  composer: ChatComposerState;
  invoices: InvoiceSummary[];
  isAuthenticated: boolean;
  isBrowserGenerating: boolean;
  isSending: boolean;
  mode: SokoMode;
  activeAgentName: string;
  pendingAttachments: ChatAttachment[];
  replyToMessageId: string | null;
  selectedConversationTitle: string;
  selectedEmailCustomerId: string | null | undefined;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCancelGeneration: () => void;
  onCancelReply: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRequireSignIn: () => void;
  onSellerPhotoCapture: (file: File) => void;
}

export function ChatComposer({
  channelEndpoints,
  composer,
  invoices,
  isAuthenticated,
  isBrowserGenerating,
  isSending,
  mode,
  activeAgentName,
  pendingAttachments,
  replyToMessageId,
  selectedConversationTitle,
  selectedEmailCustomerId,
  onAttachmentChange,
  onCancelGeneration,
  onCancelReply,
  onRemoveAttachment,
  onRequireSignIn,
  onSellerPhotoCapture
}: ChatComposerProps) {
  const {
    commitDraft,
    emailInvoiceId,
    emailSubject,
    externalShareNotice,
    fileInputRef,
    liveDraft,
    openPlatformHandoff,
    openSmsHandoff,
    selectedProvider,
    sellerPhotoInputRef,
    sendLiveDraft,
    setEmailInvoiceId,
    setEmailSubject,
    setSelectedProvider,
    updateLiveDraft
  } = composer;
  const [messageActionsOpen, setMessageActionsOpen] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const hashtagQuery = mode === "seller" ? runtimeHashtagQuery(liveDraft) : null;
  const sellerHashtagCapabilities = [...chatModuleCommands, ...runtimeHashtagCapabilities];
  const matchingHashtagCapabilities =
    hashtagQuery === null
      ? []
      : sellerHashtagCapabilities.filter(
          (capability) =>
            capability.toolName.includes(hashtagQuery) || capability.module.includes(hashtagQuery)
        );

  function openMessageActions() {
    messageInputRef.current?.blur();
    setMessageActionsOpen(true);
  }

  function runMessageAction(action: () => void) {
    setMessageActionsOpen(false);
    window.setTimeout(action, 0);
  }

  return (
    <>
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
          {hashtagQuery !== null ? (
            <ChatHashtagCapabilityPicker
              capabilities={matchingHashtagCapabilities}
              query={hashtagQuery}
              onSelect={updateLiveDraft}
            />
          ) : null}
          <small className="composer-agent-indicator">{activeAgentName} will answer</small>
          <button
            className="icon-button composer-icon-button composer-more-button"
            type="button"
            aria-label="Open message actions"
            aria-haspopup="dialog"
            aria-expanded={messageActionsOpen}
            onClick={openMessageActions}
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
              ref={messageInputRef}
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
                  ? "Ask your agent, or type # to call a capability"
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
          <ChatComposerActions
            draftHasText={liveDraft.trim().length > 0}
            mode={mode}
            open={messageActionsOpen}
            onClose={() => setMessageActionsOpen(false)}
            onAttachFiles={() => runMessageAction(() => fileInputRef.current?.click())}
            onOpenCommand={() => runMessageAction(() => updateLiveDraft("#"))}
            onRecordVoice={() => runMessageAction(() => startVoiceInput(commitDraft))}
            onSendSms={() =>
              runMessageAction(() =>
                openSmsHandoff(
                  selectedConversationTitle,
                  selectedConversationTitle || "SMS recipient"
                )
              )
            }
            onShareApps={() =>
              runMessageAction(() => void openPlatformHandoff(selectedConversationTitle))
            }
            onTakePhoto={() => runMessageAction(() => sellerPhotoInputRef.current?.click())}
          />
        </div>
      )}
    </>
  );
}
