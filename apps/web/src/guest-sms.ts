export const maxGuestSmsMessageLength = 480;

export interface GuestSmsLinkInput {
  recipient: string;
  message: string;
  joinUrl: string;
}

export function createGuestSmsLink(input: GuestSmsLinkInput): string {
  const recipient = normalizeSmsRecipient(input.recipient);
  const body = createGuestSmsBody(input.message, input.joinUrl);
  return `sms:${recipient}?body=${encodeURIComponent(body)}`;
}

export function createGuestSmsBody(message: string, joinUrl: string): string {
  const normalizedMessage = message.trim();

  if (normalizedMessage.length === 0) {
    throw new Error("Write a message before opening your messaging app.");
  }

  if (normalizedMessage.length > maxGuestSmsMessageLength) {
    throw new Error(`Keep the message to ${maxGuestSmsMessageLength} characters or fewer.`);
  }

  const url = new URL(joinUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The Soko join link must use HTTP or HTTPS.");
  }

  return `${normalizedMessage}\n\n— via Soko Messenger\nTry Soko: ${url.toString()}`;
}

export function normalizeSmsRecipient(value: string): string {
  const compact = value.trim().replace(/[\s().-]/gu, "");

  if (!/^\+?[0-9]{7,15}$/u.test(compact)) {
    throw new Error("Enter one valid mobile number, preferably with its country code.");
  }

  return compact;
}
