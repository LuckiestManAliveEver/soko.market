/**
 * Split out of store.ts (same reasoning as cp2-error.ts) so domain modules can validate text
 * fields without a circular value-import back into store.ts. These are generic, stateless string
 * validators used across many domains, not commerce-specific - kept here rather than in a
 * commerce-only shared module.
 */
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
