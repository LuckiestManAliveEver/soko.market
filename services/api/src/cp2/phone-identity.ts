import {
  normalizeInternationalPhoneInput,
  normalizePhoneInput,
  phoneNormalizationErrorMessage,
  type PhoneNormalizationError
} from "@soko/shared-types";
import { getCountryCallingCode, isSupportedCountry, type CountryCode } from "libphonenumber-js";

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
  if (phoneNumber.trim().length === 0) {
    throw new PhoneIdentityError("phone_number_required", "Enter your phone number to continue.");
  }

  const normalizedCountry = country.trim().toUpperCase();
  if (!isSupportedCountry(normalizedCountry)) {
    throw new PhoneIdentityError("phone_country_invalid", "Select a valid country to continue.");
  }

  const countryCode = normalizedCountry as CountryCode;
  const result = normalizePhoneInput({
    rawInput: phoneNumber,
    selectedCountry: countryCode,
    selectedCallingCode: getCountryCallingCode(countryCode)
  });
  if (!result.valid) throw invalidPhoneError(result.error);

  return {
    country: result.country,
    e164: result.e164,
    nationalNumber: result.nationalNumber
  };
}

export function normalizeInternationalOwnerPhoneNumber(
  phoneNumber: string
): NormalizedOwnerPhoneIdentity {
  const result = normalizeInternationalPhoneInput(phoneNumber);
  if (!result.valid) throw invalidPhoneError(result.error);

  return {
    country: result.country,
    e164: result.e164,
    nationalNumber: result.nationalNumber
  };
}

function invalidPhoneError(error: PhoneNormalizationError): PhoneIdentityError {
  return new PhoneIdentityError("phone_number_invalid", phoneNormalizationErrorMessage(error));
}

export function maskPhoneNumber(phoneNumber: string | null | undefined): string | null {
  if (phoneNumber === null || phoneNumber === undefined) return null;

  const visiblePrefixLength = Math.min(4, Math.max(2, phoneNumber.length - 6));
  const hiddenLength = Math.max(3, phoneNumber.length - visiblePrefixLength - 3);
  return `${phoneNumber.slice(0, visiblePrefixLength)}${"*".repeat(hiddenLength)}${phoneNumber.slice(-3)}`;
}
