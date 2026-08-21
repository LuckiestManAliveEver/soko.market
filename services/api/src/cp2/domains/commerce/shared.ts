import { randomUUID } from "node:crypto";
import type {
  ProductCaptureField,
  ProductCaptureItemSummary,
  ProductCaptureJobSummary
} from "@soko/shared-types";
import {
  normalizeOptionalBoundedText,
  normalizeRequiredBoundedText
} from "../../text-normalization.js";

export { normalizeOptionalBoundedText, normalizeRequiredBoundedText };

export function captureField<T>(
  value: T | null,
  confidence: number | null
): ProductCaptureField<T> {
  return {
    value,
    source: value === null ? "not_detected" : "vision_extraction",
    confidence: value === null ? null : confidence
  };
}

export function sellerCaptureField<T>(value: T | null): ProductCaptureField<T> {
  return {
    value,
    source: value === null ? "not_detected" : "seller",
    confidence: value === null ? null : 1
  };
}

/**
 * Builds the single-entry `items` array that mirrors a job's `fields`. Every capture produces
 * exactly one item today since no real vision/detection model is wired in (see
 * ProductCaptureItemSummary's doc comment) - this keeps `items` in sync with `fields` across
 * create/review/retry while preserving an existing item's id/status/boundingBox when supplied, so
 * a field edit does not reset an already-confirmed or already-rejected item back to pending.
 */
export function productCaptureItemsFromFields(
  fields: ProductCaptureJobSummary["fields"],
  existingItems?: ProductCaptureItemSummary[]
): ProductCaptureItemSummary[] {
  const existing = existingItems?.[0];
  return [
    {
      id: existing?.id ?? randomUUID(),
      fields,
      boundingBox: existing?.boundingBox ?? null,
      status: existing?.status ?? "pending_review",
      confirmedProductId: existing?.confirmedProductId ?? null
    }
  ];
}

/**
 * Text relevance for the unified buy feed - mirrors catalogueMatchScore's exact/prefix/substring
 * scale (packages/business-core/src/index.ts) but works on a plain title string, since contact
 * results only have StatusBroadcastItemSummary.title, not a full ProductSummary to score against.
 */
export function buyTextRelevanceScore(title: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return 1;
  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle === normalizedQuery) return 1000;
  if (normalizedTitle.startsWith(normalizedQuery)) return 800;
  if (normalizedTitle.includes(normalizedQuery)) return 600;
  return 0;
}

export function firstProductCaptureTitle(text: string): string | null {
  const firstUsefulLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .find(
      (line) =>
        line.length > 1 && !/^(?:ksh|kes|usd|tzs|ugx|zar|eur|gbp|\$|€|£)\s*[\d,.]+$/iu.test(line)
    );
  return firstUsefulLine === undefined ? null : firstUsefulLine.slice(0, 160);
}

export function visibleProductCapturePrice(text: string): number | null {
  const match = text.match(
    /(?:\b(?:ksh|kes|usd|tzs|ugx|zar|eur|gbp)\b|[$€£])\s*([0-9]+(?:[,.][0-9]{1,3})*)/iu
  );
  if (match?.[1] === undefined) return null;
  const normalized = match[1].replace(/,/gu, "");
  const price = Number(normalized);
  return Number.isFinite(price) && price >= 0 ? price : null;
}
