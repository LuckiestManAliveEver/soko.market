import { useEffect, useRef, useState } from "react";

import type { CountryCode } from "libphonenumber-js";
import type { Scope } from "@soko/offline-runtime";
import type {
  ChannelEndpointSummary,
  ChannelProvider,
  MessageHandoffStatus
} from "@soko/shared-types";

import type { SmsHandoffRequest } from "../messaging/SmsHandoffDialog";
import { normalizeSmsRecipient } from "../messaging/sms-handoff";
import { shareMessageExternally } from "../messaging/platform-handoff";
import { getErrorMessage } from "../chat-message-plumbing";
import {
  peerMessagingEnabled,
  peerMessagingSupported,
  nearbyConnectionStatus,
  onNearbyStatusChange,
  connectNearbyDevice,
  sendNearbyMessage,
  type NearbyConnectionStatus
} from "../peer-messaging";

interface ChatComposerStateInput {
  activeConversationId: string | null;
  channelEndpoints: ChannelEndpointSummary[];
  chatDraft: string;
  initialEmailSubject: string;
  nearbyScope: Scope | null;
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
  const [selectedProvider, setSelectedProviderState] = useState<ChannelProvider | null>(null);
  const [sendViaBluetooth, setSendViaBluetooth] = useState(false);
  const [bluetoothStatus, setBluetoothStatus] =
    useState<NearbyConnectionStatus>(nearbyConnectionStatus());
  const [bluetoothBusy, setBluetoothBusy] = useState(false);
  const [bluetoothError, setBluetoothError] = useState<string | null>(null);
  const bluetoothAvailable =
    input.nearbyScope !== null && peerMessagingEnabled && peerMessagingSupported();

  useEffect(() => onNearbyStatusChange(setBluetoothStatus), []);

  function setSelectedProvider(provider: ChannelProvider | null) {
    setSendViaBluetooth(false);
    setBluetoothError(null);
    setSelectedProviderState(provider);
  }

  function selectBluetooth() {
    const scope = input.nearbyScope;
    if (scope === null || !bluetoothAvailable) return;
    setSelectedProviderState(null);
    setSendViaBluetooth(true);
    setBluetoothError(null);
    if (bluetoothStatus === "connected") return;
    setBluetoothBusy(true);
    void connectNearbyDevice(scope)
      .catch((error: unknown) => setBluetoothError(getErrorMessage(error)))
      .finally(() => setBluetoothBusy(false));
  }

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
    if (sendViaBluetooth) {
      const scope = input.nearbyScope;
      if (scope === null) return;
      setBluetoothBusy(true);
      setBluetoothError(null);
      void sendNearbyMessage(scope, liveDraft)
        .then(() => {
          setLiveDraft("");
          input.onDraftChange("");
        })
        .catch((error: unknown) => setBluetoothError(getErrorMessage(error)))
        .finally(() => setBluetoothBusy(false));
      return;
    }
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
    bluetoothAvailable,
    bluetoothBusy,
    bluetoothError,
    bluetoothStatus,
    commitDraft,
    emailInvoiceId,
    emailSubject,
    externalShareNotice,
    fileInputRef,
    liveDraft,
    openPlatformHandoff,
    openSmsHandoff,
    selectBluetooth,
    selectedProvider,
    sellerPhotoInputRef,
    sendLiveDraft,
    sendViaBluetooth,
    setEmailInvoiceId,
    setEmailSubject,
    setSelectedProvider,
    setSmsHandoffRequest,
    smsHandoffRequest,
    updateLiveDraft
  };
}

export type ChatComposerState = ReturnType<typeof useChatComposerState>;
