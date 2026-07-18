import { describe, expect, it } from "vitest";
import { normalizeOwnerPhoneInput } from "../apps/web/src/phone-identity";
import { maskPhoneNumber, normalizeOwnerPhoneNumber } from "../services/api/src/cp2/phone-identity";

describe("owner phone identity normalization", () => {
  it.each(["0712345678", "712345678", "+254712345678", "254712345678"])(
    "normalizes Kenyan input %s without duplicating the calling code",
    (input) => {
      expect(normalizeOwnerPhoneInput(input, "KE")).toBe("+254712345678");
      expect(normalizeOwnerPhoneNumber(input, "KE")).toMatchObject({
        country: "KE",
        e164: "+254712345678",
        nationalNumber: "712345678"
      });
    }
  );

  it("rejects empty, invalid, and mismatched-country values", () => {
    expect(() => normalizeOwnerPhoneInput("", "KE")).toThrow(
      "Enter your phone number to continue."
    );
    expect(() => normalizeOwnerPhoneInput("123", "KE")).toThrow(
      "Enter a valid phone number for the selected country."
    );
    expect(() => normalizeOwnerPhoneInput("+14155552671", "KE")).toThrow(
      "Enter a valid phone number for the selected country."
    );
  });

  it("masks phone numbers before they enter audit metadata", () => {
    const phone = "+254712345678";
    const masked = maskPhoneNumber(phone);

    expect(masked).toBe("+254******678");
    expect(masked).not.toContain(phone);
  });
});
