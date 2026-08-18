/**
 * Split out of store.ts (same reasoning as cp2-error.ts) so domain modules can validate text
 * fields without a circular value-import back into store.ts. These are generic, stateless string
 * validators used across many domains, not commerce-specific - kept here rather than in a
 * commerce-only shared module.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountSummary, SupportedLanguage } from "@soko/shared-types";
import { Cp2Error } from "./cp2-error.js";

export function normalizeRequiredBoundedText(
  value: string,
  label: string,
  maximumLength: number
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Cp2Error(400, `${label.replaceAll(" ", "_")}_required`, `${label} is required.`);
  }
  if (normalized.length > maximumLength) {
    throw new Cp2Error(
      400,
      `${label.replaceAll(" ", "_")}_too_long`,
      `${label} must be ${maximumLength} characters or fewer.`
    );
  }
  return normalized;
}

export function normalizeOptionalBoundedText(
  value: string | null,
  maximumLength: number
): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximumLength) {
    throw new Cp2Error(
      400,
      "value_too_long",
      `Value must be ${maximumLength} characters or fewer.`
    );
  }
  return normalized;
}

export function normalizeStorefrontLookupId(value: string): string {
  return value.trim().toLowerCase().replace(/^\+/, "").replace("-", "");
}

export function destinationAccountKey(
  channel: AccountSummary["primaryAuthChannel"],
  destination: string
): string {
  return `${channel}:${destination}`;
}

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return value === "en" || value === "sw";
}

export function readBoundedSecurityInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const configured = process.env[name]?.trim();
  if (configured === undefined || configured.length === 0) return fallback;
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

/** Shared between the OAuth domain (`beginOAuthSession`) and OTP challenges (`requestOtp`). */
export const otpTtlMs = 5 * 60 * 1000;

/**
 * Shared between the OTP-request rate limiter (`otpRequestHistory`, in the OTP domain) and the
 * failed-PIN-attempt tracker (`failedPinAttempts`, which stays on `Cp2Store` as core-kernel
 * state) - both are bounded in-memory `Map`s evicting their oldest entry at this same capacity.
 */
export const pinAttemptTrackerMaximumEntries = 10_000;

/**
 * Shared between the OTP domain (`requestOtp`/`verifyOtp`) and three `Cp2Store` methods
 * (`verifyEmailRecovery`, `verifyEmailIdentityMerge`, `verifyPendingEmail`) that validate an OTP
 * code against an `otpChallenges` record with their own inlined checks rather than going through
 * the OTP domain's `validateOtpChallenge`/`completeOtpVerification`.
 */
export function hashOtp(challengeId: string, code: string): string {
  return createHmac("sha256", otpHmacSecret()).update(`${challengeId}:${code}`).digest("hex");
}

export function otpHmacSecret(): string {
  const configured = process.env.OTP_HMAC_SECRET?.trim();
  if (configured !== undefined && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Cp2Error(
      503,
      "otp_secret_unconfigured",
      "Verification codes are temporarily unavailable."
    );
  }
  return "soko-market-local-otp-hmac-secret";
}

/**
 * Generic constant-time hex-digest comparison. Shared between the OTP domain and the legacy
 * SHA-256 PIN-hash fallback comparison on `Cp2Store` (`resolvePinHashOutcome`), so it lives here
 * rather than in either domain's own `shared.ts`.
 */
export function hashMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
