/**
 * The one shared serializer/parser for physical mass in grams (docs/architecture/
 * corridor-fulfillment.md, A22). Authoritative weight is an integer number of grams stored as
 * PostgreSQL BIGINT. JavaScript `bigint` cannot cross `JSON.stringify`, and the in-memory Cp2Store
 * snapshot is JSON-serialized, so every JSON boundary (HTTP bodies, runtime tool payloads, Cp2Store
 * records) carries grams as a canonical decimal string such as `"6150000"`. Domain arithmetic
 * converts to `bigint` through `parseGrams` and back through `formatGrams`; nothing else may do
 * that conversion.
 */

/** A canonical non-negative integer gram count: digits only, no sign, no leading zeros. */
export type GramsString = string;

const canonicalGramsPattern = /^(?:0|[1-9][0-9]*)$/u;

/** PostgreSQL BIGINT upper bound; any larger value cannot be stored authoritatively. */
export const MAX_GRAMS = 9_223_372_036_854_775_807n;

export class GramsFormatError extends Error {
  readonly code = "grams_invalid";

  constructor(
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "GramsFormatError";
  }
}

export function isGramsString(value: unknown): value is GramsString {
  return (
    typeof value === "string" && canonicalGramsPattern.test(value) && BigInt(value) <= MAX_GRAMS
  );
}

/**
 * Parses a wire/record gram value. Accepts only a canonical decimal string. Numbers are rejected
 * outright - even safe integers - so a float can never silently become an authoritative weight.
 */
export function parseGrams(value: unknown, field = "grams"): bigint {
  if (typeof value !== "string") {
    throw new GramsFormatError(field, `${field} must be a decimal string of whole grams.`);
  }
  if (!canonicalGramsPattern.test(value)) {
    throw new GramsFormatError(
      field,
      `${field} must contain only digits (whole, non-negative grams, no leading zeros).`
    );
  }
  const parsed = BigInt(value);
  if (parsed > MAX_GRAMS) {
    throw new GramsFormatError(field, `${field} exceeds the largest storable weight.`);
  }
  return parsed;
}

/** Like `parseGrams`, but also rejects zero - for unit weights and capacities (`CHECK (> 0)`). */
export function parsePositiveGrams(value: unknown, field = "grams"): bigint {
  const parsed = parseGrams(value, field);
  if (parsed === 0n) {
    throw new GramsFormatError(field, `${field} must be greater than zero.`);
  }
  return parsed;
}

export function parseNullableGrams(value: unknown, field = "grams"): bigint | null {
  return value === null || value === undefined ? null : parseGrams(value, field);
}

export function formatGrams(value: bigint): GramsString {
  if (value < 0n) {
    throw new GramsFormatError("grams", "A weight cannot be negative.");
  }
  if (value > MAX_GRAMS) {
    throw new GramsFormatError("grams", "A weight exceeds the largest storable weight.");
  }
  return value.toString(10);
}

export function formatNullableGrams(value: bigint | null): GramsString | null {
  return value === null ? null : formatGrams(value);
}

/**
 * Presentation-only kilogram rendering (for example `"6,150 kg"`, `"0.9 kg"`). Exact: it splits the
 * integer gram count instead of dividing a float. Never feed the result back into arithmetic.
 */
export function formatKilogramsForDisplay(
  grams: GramsString | bigint,
  options: { locale?: string; maximumFractionDigits?: 0 | 1 | 2 | 3 } = {}
): string {
  const value = typeof grams === "bigint" ? grams : parseGrams(grams);
  const maximumFractionDigits = options.maximumFractionDigits ?? 3;
  const scale = 10n ** BigInt(3 - maximumFractionDigits);
  // Round half up at the requested precision, entirely in integer space.
  const rounded = (value + scale / 2n) / scale;
  const divisor = 10n ** BigInt(maximumFractionDigits);
  const whole = rounded / divisor;
  const fraction = rounded % divisor;
  const wholeText = new Intl.NumberFormat(options.locale ?? "en", {
    maximumFractionDigits: 0
  }).format(whole);
  if (maximumFractionDigits === 0 || fraction === 0n) {
    return `${wholeText} kg`;
  }
  const decimalSeparator =
    new Intl.NumberFormat(options.locale ?? "en")
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  const fractionText = fraction.toString().padStart(maximumFractionDigits, "0").replace(/0+$/u, "");
  return `${wholeText}${decimalSeparator}${fractionText} kg`;
}
