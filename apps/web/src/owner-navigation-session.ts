import type { ChatMessage } from "./app-shell";

const storagePrefix = "soko.market.owner-navigation.v1";
const maxPersistedMessages = 80;

export interface OwnerNavigationSession {
  activeConversationId: string | null;
  runtimeSessionId: string | null;
  chatDraft: string;
  chatMessages: ChatMessage[];
}

export function readOwnerNavigationSession(
  accountId: string | null,
  storage: Storage | undefined = browserSessionStorage()
): OwnerNavigationSession | null {
  if (storage === undefined) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKey(accountId)) ?? "null") as unknown;
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<OwnerNavigationSession>;
    return {
      activeConversationId: optionalString(candidate.activeConversationId),
      runtimeSessionId: optionalString(candidate.runtimeSessionId),
      chatDraft: typeof candidate.chatDraft === "string" ? candidate.chatDraft : "",
      chatMessages: Array.isArray(candidate.chatMessages)
        ? candidate.chatMessages.filter(isChatMessage).slice(-maxPersistedMessages)
        : []
    };
  } catch {
    storage.removeItem(storageKey(accountId));
    return null;
  }
}

export function writeOwnerNavigationSession(
  accountId: string | null,
  value: OwnerNavigationSession,
  storage: Storage | undefined = browserSessionStorage()
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(
      storageKey(accountId),
      JSON.stringify({
        ...value,
        chatMessages: value.chatMessages.slice(-maxPersistedMessages).map((message) => ({
          ...message,
          attachments: message.attachments?.map((attachment) => ({
            ...attachment,
            dataUrl: undefined
          }))
        }))
      })
    );
  } catch {
    // Navigation must remain usable when storage is unavailable or full.
  }
}

export function clearOwnerNavigationSession(
  accountId: string | null,
  storage: Storage | undefined = browserSessionStorage()
): void {
  storage?.removeItem(storageKey(accountId));
}

function browserSessionStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.sessionStorage;
}

function storageKey(accountId: string | null): string {
  return `${storagePrefix}:${accountId?.trim() || "anonymous"}`;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === "string" &&
    typeof message.body === "string" &&
    (message.author === "merchant" || message.author === "sokoclaw" || message.author === "contact")
  );
}
