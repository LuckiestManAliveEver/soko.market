import type { DevicePhonebookContact } from "./phonebook-directory";

/**
 * The contacts the owner picked, with their raw numbers, kept on this device only so the invite
 * list survives a reload. The server stores hashes, never these numbers (see
 * docs/architecture/phonebook-identity-resolution.md). Scoped per Soko user and cleared on
 * logout. Storage can be missing or throw (private window, blocked site data): every access
 * degrades to "nothing cached".
 */
const storagePrefix = "soko.phonebook.v1:";

export function readDevicePhonebook(userId: string): DevicePhonebookContact[] {
  try {
    const raw = localStorage.getItem(storagePrefix + userId);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDevicePhonebookContact) : [];
  } catch {
    return [];
  }
}

export function writeDevicePhonebook(userId: string, contacts: DevicePhonebookContact[]): void {
  try {
    localStorage.setItem(storagePrefix + userId, JSON.stringify(contacts));
  } catch {
    // Quota or blocked storage: the list still works for this session.
  }
}

export function clearDevicePhonebooks(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(storagePrefix)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, nothing to clear.
  }
}

function isDevicePhonebookContact(value: unknown): value is DevicePhonebookContact {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const nullableString = (field: unknown) => field === null || typeof field === "string";
  return (
    typeof record.name === "string" &&
    nullableString(record.phone) &&
    nullableString(record.email) &&
    nullableString(record.nodeId)
  );
}
