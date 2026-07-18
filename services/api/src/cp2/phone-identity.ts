import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js";

export type PhoneIdentityErrorCode =
  "phone_country_invalid" | "phone_number_invalid" | "phone_number_required";

export class PhoneIdentityError extends Error {
  constructor(
    readonly code: PhoneIdentityErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface NormalizedOwnerPhoneIdentity {
  country: CountryCode;
  e164: string;
  nationalNumber: string;
}

export function normalizeOwnerPhoneNumber(
  phoneNumber: string,
  country: string
): NormalizedOwnerPhoneIdentity {
  const rawPhoneNumber = phoneNumber.trim();
  if (rawPhoneNumber.length === 0) {
    throw new PhoneIdentityError("phone_number_required", "Enter your phone number to continue.");
  }

  const normalizedCountry = country.trim().toUpperCase();
  if (!isSupportedCountry(normalizedCountry)) {
    throw new PhoneIdentityError("phone_country_invalid", "Select a valid country to continue.");
  }

  const countryCode = normalizedCountry as CountryCode;
  const digits = rawPhoneNumber.replace(/\D/g, "");
  const callingCode = getCountryCallingCode(countryCode);
  const candidate = rawPhoneNumber.startsWith("+")
    ? `+${digits}`
    : digits.startsWith(callingCode)
      ? `+${digits}`
      : rawPhoneNumber;
  const parsed = parsePhoneNumberFromString(candidate, countryCode);

  if (!parsed?.isValid() || parsed.country !== countryCode) {
    throw new PhoneIdentityError(
      "phone_number_invalid",
      "Enter a valid phone number for the selected country."
    );
  }

  return {
    country: countryCode,
    e164: parsed.number,
    nationalNumber: parsed.nationalNumber
  };
}

export function normalizeInternationalOwnerPhoneNumber(
  phoneNumber: string
): NormalizedOwnerPhoneIdentity {
  const parsed = parsePhoneNumberFromString(phoneNumber.trim());

  if (!parsed?.isValid() || parsed.country === undefined) {
    throw new PhoneIdentityError(
      "phone_number_invalid",
      "Enter a valid phone number for the selected country."
    );
  }

  return {
    country: parsed.country,
    e164: parsed.number,
    nationalNumber: parsed.nationalNumber
  };
}

export function maskPhoneNumber(phoneNumber: string | null | undefined): string | null {
  if (phoneNumber === null || phoneNumber === undefined) return null;

  const visiblePrefixLength = Math.min(4, Math.max(2, phoneNumber.length - 6));
  const hiddenLength = Math.max(3, phoneNumber.length - visiblePrefixLength - 3);
  return `${phoneNumber.slice(0, visiblePrefixLength)}${"*".repeat(hiddenLength)}${phoneNumber.slice(-3)}`;
}
