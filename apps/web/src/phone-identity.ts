import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js";

export function normalizeOwnerPhoneInput(phoneNumber: string, country: CountryCode): string {
  const rawPhoneNumber = phoneNumber.trim();
  if (rawPhoneNumber.length === 0) {
    throw new Error("Enter your phone number to continue.");
  }

  const digits = rawPhoneNumber.replace(/\D/g, "");
  const callingCode = getCountryCallingCode(country);
  const candidate = rawPhoneNumber.startsWith("+")
    ? `+${digits}`
    : digits.startsWith(callingCode)
      ? `+${digits}`
      : rawPhoneNumber;
  const parsed = parsePhoneNumberFromString(candidate, country);

  if (!parsed?.isValid() || parsed.country !== country) {
    throw new Error("Enter a valid phone number for the selected country.");
  }

  return parsed.number;
}
