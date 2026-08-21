import { useEffect, useRef, useState } from "react";

import type { CountryCode } from "libphonenumber-js";
import type {
  ChannelEndpointSummary,
  ChannelProvider,
  MessageHandoffStatus
} from "@soko/shared-types";

import type { SmsHandoffRequest } from "../messaging/SmsHandoffDialog";
import { normalizeSmsRecipient } from "../messaging/sms-handoff";
import { shareMessageExternally } from "../messaging/platform-handoff";

interface ChatComposerStateInput {
  activeConversationId: string | null;
  channelEndpoints: ChannelEndpointSummary[];
  chatDraft: string;
  initialEmailSubject: string;
  smsDefaultCountry: CountryCode;
  onDraftChange: (draft: string) => void;
  onPlatformHandoff: (status: MessageHandoffStatus, normalizedErrorCode: string | null) => void;
  onSend: (draft: string, provider?: ChannelProvider, subject?: string, invoiceId?: string) => void;
}

export function useChatComposerState(input: ChatComposerStateInput) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sellerPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const draftSyncTimerRef = useRef<number | null>(null);
  const [smsHandoffRequest, setSmsHandoffRequest] = useState<SmsHandoffRequest | null>(null);
  const [externalShareNotice, setExternalShareNotice] = useState<string | null>(null);
  const [liveDraft, setLiveDraft] = useState(input.chatDraft);
  const [emailSubject, setEmailSubject] = useState(input.initialEmailSubject);
  const [emailInvoiceId, setEmailInvoiceId] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ChannelProvider | null>(null);

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
      input.onDraftChange(nextDraft);
    }, 120);
  }

  function commitDraft(nextDraft: string) {
    clearDraftSyncTimer();
    setLiveDraft(nextDraft);
    input.onDraftChange(nextDraft);
  }

  function sendLiveDraft() {
    clearDraftSyncTimer();
    input.onSend(
      liveDraft,
      selectedProvider ?? undefined,
      selectedProvider === "email" ? emailSubject : undefined,
      selectedProvider === "email" && emailInvoiceId !== "" ? emailInvoiceId : undefined
    );
  }

  function openSmsHandoff(recipient: string, label: string) {
    let normalizedCandidate = "";
    try {
      normalizedCandidate = normalizeSmsRecipient(recipient, input.smsDefaultCountry);
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
    input.onPlatformHandoff(result.status, result.errorCode);
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

  useEffect(() => setLiveDraft(input.chatDraft), [input.chatDraft]);

  useEffect(() => {
    setEmailSubject(input.initialEmailSubject);
    setEmailInvoiceId("");
  }, [input.activeConversationId, input.initialEmailSubject]);

  useEffect(() => {
    const available = input.channelEndpoints.find(
      (endpoint) =>
        endpoint.status === "available" &&
        endpoint.configured &&
        endpoint.authorized &&
        (endpoint.capabilities.includes("CAN_REPLY") ||
          endpoint.capabilities.includes("CAN_INITIATE"))
    );
    setSelectedProvider(available?.provider ?? null);
  }, [input.activeConversationId, input.channelEndpoints]);

  useEffect(() => () => clearDraftSyncTimer(), []);

  return {
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
    setSmsHandoffRequest,
    smsHandoffRequest,
    updateLiveDraft
  };
}

export type ChatComposerState = ReturnType<typeof useChatComposerState>;
