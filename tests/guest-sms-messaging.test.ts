import { describe, expect, it } from "vitest";
import {
  createGuestSmsBody,
  createGuestSmsLink,
  maxGuestSmsMessageLength,
  normalizeSmsRecipient
} from "../apps/web/src/guest-sms";
import { readOwnerRoute, routes } from "../apps/web/src/routes";

describe("guest cellular messaging", () => {
  it("creates a normal SMS handoff with subtle Soko attribution and a working try link", () => {
    const link = createGuestSmsLink({
      recipient: "+254 700-123-456",
      message: "Can you bring the order at 5?",
      joinUrl: "https://soko.market/join"
    });

    expect(link).toMatch(/^sms:\+254700123456\?body=/u);
    const body = decodeURIComponent(link.split("?body=")[1] ?? "");
    expect(body).toBe(
      "Can you bring the order at 5?\n\n— via Soko Messenger\nTry Soko: https://soko.market/join"
    );
    expect(readOwnerRoute(routes.join)).toEqual({ mode: "marketplace", view: "chat" });
  });

  it("accepts one plausible mobile recipient and rejects unsafe or multiple recipients", () => {
    expect(normalizeSmsRecipient("(0700) 123-456")).toBe("0700123456");
    expect(() => normalizeSmsRecipient("+254700123456,+254711123456")).toThrow(
      "one valid mobile number"
    );
    expect(() => normalizeSmsRecipient("javascript:alert(1)")).toThrow("one valid mobile number");
  });

  it("requires a bounded message and an HTTP Soko link", () => {
    expect(() => createGuestSmsBody("", "https://soko.market/join")).toThrow("Write a message");
    expect(() =>
      createGuestSmsBody("x".repeat(maxGuestSmsMessageLength + 1), "https://soko.market/join")
    ).toThrow(`${maxGuestSmsMessageLength} characters`);
    expect(() => createGuestSmsBody("Hello", "javascript:alert(1)")).toThrow("HTTP or HTTPS");
  });
});
