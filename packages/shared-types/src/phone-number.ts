import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
  type PhoneNumber
} from "libphonenumber-js";

export type PhoneNormalizationError =
  "EMPTY" | "INVALID_CHARACTERS" | "INVALID_NUMBER" | "COUNTRY_MISMATCH" | "TOO_SHORT" | "TOO_LONG";

export interface NormalizePhoneInput {
  rawInput: string;
  selectedCountry: string;
  selectedCallingCode: string;
}

export type NormalizePhoneResult =
  | {
      valid: true;
      e164: string;
      nationalNumber: string;
      country: CountryCode;
      callingCode: string;
      nationalFormat: string;
      internationalFormat: string;
      adjustedDuplicatePrefix: boolean;
    }
  | { valid: false; error: PhoneNormalizationError };

const presentationCharacters = /[\s\-().]/gu;
const supportedInputCharacters = /^[0-9+\s\-().]+$/u;

/**
 * Parses a phone field into one canonical identity. International input wins over
 * the selected country so a pasted foreign number can safely synchronize the UI.
 */
export function normalizePhoneInput(input: NormalizePhoneInput): NormalizePhoneResult {
  const raw = input.rawInput.trim();
  if (raw.length === 0) return { valid: false, error: "EMPTY" };
  if (!supportedInputCharacters.test(raw)) {
    return { valid: false, error: "INVALID_CHARACTERS" };
  }

  const selectedCountry = input.selectedCountry.trim().toUpperCase();
  if (!isSupportedCountry(selectedCountry)) {
    return { valid: false, error: "COUNTRY_MISMATCH" };
  }
  const country = selectedCountry as CountryCode;
  const expectedCallingCode = getCountryCallingCode(country);
  const suppliedCallingCode = input.selectedCallingCode.replace(/\D/gu, "");
  if (suppliedCallingCode !== expectedCallingCode) {
    return { valid: false, error: "COUNTRY_MISMATCH" };
  }

  let compact = raw.replace(presentationCharacters, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;

  // A second plus is only safely recoverable when it separates two copies of the
  // selected calling code, such as +254+254712345678.
  const duplicatedPlusPrefix = `+${expectedCallingCode}+${expectedCallingCode}`;
  if (compact.startsWith(duplicatedPlusPrefix)) {
    compact = `+${expectedCallingCode}${compact.slice(duplicatedPlusPrefix.length)}`;
    compact = `+${expectedCallingCode}${expectedCallingCode}${compact.slice(expectedCallingCode.length + 1)}`;
  }
  if (compact.slice(1).includes("+") || (!compact.startsWith("+") && compact.includes("+"))) {
    return { valid: false, error: "INVALID_CHARACTERS" };
  }

  const international = compact.startsWith("+");
  const digits = compact.replace(/^\+/u, "");
  if (digits.length > 15) return { valid: false, error: "TOO_LONG" };

  if (international || digits.startsWith(expectedCallingCode)) {
    const parsed = findValidInternationalCandidate(digits, expectedCallingCode);
    if (parsed !== null) return phoneResult(parsed.phone, parsed.adjustedDuplicatePrefix);
    return { valid: false, error: lengthError(`+${digits}`) };
  }

  const parsed = parsePhoneNumberFromString(compact, country);
  if (parsed?.isValid()) return phoneResult(parsed, false);
  return { valid: false, error: lengthError(compact, country) };
}

/** Normalizes an already international value without trusting its formatting. */
export function normalizeInternationalPhoneInput(rawInput: string): NormalizePhoneResult {
  const raw = rawInput.trim();
  if (raw.length === 0) return { valid: false, error: "EMPTY" };
  if (!supportedInputCharacters.test(raw)) {
    return { valid: false, error: "INVALID_CHARACTERS" };
  }
  const compact = raw.replace(presentationCharacters, "");
  const international = compact.startsWith("00")
    ? `+${compact.slice(2)}`
    : compact.startsWith("+")
      ? compact
      : `+${compact}`;
  const preliminary = parsePhoneNumberFromString(international);
  const duplicatedPrefixCountry = getCountries().find((country) => {
    const callingCode = getCountryCallingCode(country);
    return international.startsWith(`+${callingCode}+${callingCode}`);
  });
  const detectedCountry = preliminary?.country ?? duplicatedPrefixCountry;
  if (detectedCountry === undefined) {
    return { valid: false, error: lengthError(international) };
  }
  return normalizePhoneInput({
    rawInput,
    selectedCountry: detectedCountry,
    selectedCallingCode: getCountryCallingCode(detectedCountry)
  });
}

export function phoneNormalizationErrorMessage(error: PhoneNormalizationError): string {
  switch (error) {
    case "EMPTY":
      return "Enter your phone number to continue.";
    case "INVALID_CHARACTERS":
      return "Use only digits, spaces, +, hyphens, or parentheses.";
    case "COUNTRY_MISMATCH":
      return "This number uses a different country code.";
    case "TOO_SHORT":
      return "The phone number is too short.";
    case "TOO_LONG":
      return "The phone number is too long.";
    default:
      return "Enter a valid phone number.";
  }
}

function findValidInternationalCandidate(
  originalDigits: string,
  selectedCallingCode: string
): { phone: PhoneNumber; adjustedDuplicatePrefix: boolean } | null {
  let digits = originalDigits;
  let adjustedDuplicatePrefix = false;

  for (;;) {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (parsed?.isValid() && parsed.country !== undefined) {
      return { phone: parsed, adjustedDuplicatePrefix };
    }
    if (!digits.startsWith(selectedCallingCode + selectedCallingCode)) return null;
    digits = digits.slice(selectedCallingCode.length);
    adjustedDuplicatePrefix = true;
  }
}

function phoneResult(phone: PhoneNumber, adjustedDuplicatePrefix: boolean): NormalizePhoneResult {
  if (phone.country === undefined) return { valid: false, error: "INVALID_NUMBER" };
  return {
    valid: true,
    e164: phone.number,
    nationalNumber: phone.nationalNumber,
    country: phone.country,
    callingCode: phone.countryCallingCode,
    nationalFormat: phone.formatNational(),
    internationalFormat: phone.formatInternational(),
    adjustedDuplicatePrefix
  };
}

function lengthError(value: string, country?: CountryCode): PhoneNormalizationError {
  const reason = validatePhoneNumberLength(value, country);
  if (reason === "TOO_SHORT") return "TOO_SHORT";
  if (reason === "TOO_LONG") return "TOO_LONG";
  return "INVALID_NUMBER";
}
