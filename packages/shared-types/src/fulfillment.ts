/**
 * Wire/record shapes for the corridor-fulfillment domain (docs/architecture/
 * corridor-fulfillment.md). Every gram value is a `GramsString` (see ./grams.ts); `bigint` never
 * appears in these types because they cross JSON boundaries.
 */
import type { GramsString } from "./grams.js";

export type WeightStatus = "RESOLVED" | "UNRESOLVED";

/**
 * Why a line (or an order) has no authoritative weight. Unknown is never zero:
 * - MISSING_UNIT_WEIGHT: the product had no `unitWeightGrams` when the order was confirmed.
 * - NON_INTEGRAL_WEIGHT: quantity x unit weight is not a whole number of grams.
 * - NOT_SNAPSHOTTED: the line was confirmed before weight snapshots existed.
 */
export type WeightUnresolvedReason =
  "MISSING_UNIT_WEIGHT" | "NON_INTEGRAL_WEIGHT" | "NOT_SNAPSHOTTED";

export type OrderFulfillmentWeightSummary =
  | { status: "RESOLVED"; totalWeightGrams: GramsString }
  | {
      status: "UNRESOLVED";
      unresolvedLineIds: string[];
      unresolvedLines: Array<{ lineId: string; reason: WeightUnresolvedReason }>;
    };

export interface VehicleSummary {
  id: string;
  businessId: string;
  name: string;
  registration: string | null;
  capacityGrams: GramsString;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type DispatchFallbackAction =
  "TRY_SMALLER_VEHICLE" | "TRY_COMPATIBLE_CORRIDOR" | "REQUIRE_DISPATCH_APPROVAL";

export type DispatchOverflowStrategy = "NEXT_MANIFEST";

/**
 * One immutable policy version. Editing a policy appends a new version (same `policyId`, higher
 * `version`) and deactivates the previous one, so a manifest that references
 * `(policyId, version)` keeps its original interpretation forever (A9).
 */
export interface DispatchPolicySummary {
  id: string;
  policyId: string;
  businessId: string;
  version: number;
  name: string;
  isBusinessDefault: boolean;
  targetLoadGrams: GramsString;
  minimumDispatchLoadGrams: GramsString | null;
  maxDiversionMeters: number;
  /** Business-local wall-clock time, `HH:MM` (24h). Interpreted in the business timezone. */
  cutoffLocalTime: string;
  maxWaitHours: number;
  fulfillmentLeadDays: number;
  underThresholdFallback: DispatchFallbackAction[];
  overflowStrategy: DispatchOverflowStrategy;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export type ShopLocationStatus = "RESOLVED" | "UNRESOLVED";

/** One captured delivery point for a shop (a business's `CustomerSummary`). Append-only. */
export interface ShopLocationSummary {
  id: string;
  businessId: string;
  customerId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
  capturedBy: string;
  supersededAt: string | null;
}

/**
 * A shop's current delivery-point state. `current` carries precise coordinates only for actors
 * holding `shop_location:read_precise`; everyone else sees status and capture metadata with
 * `coordinatesRedacted: true` (A6).
 */
export interface ShopLocationStatusSummary {
  businessId: string;
  customerId: string;
  locationStatus: ShopLocationStatus;
  coordinatesRedacted: boolean;
  current:
    | ShopLocationSummary
    | (Omit<ShopLocationSummary, "latitude" | "longitude" | "accuracyMeters"> & {
        latitude: null;
        longitude: null;
        accuracyMeters: null;
      })
    | null;
}

export interface FulfillmentSettingsSummary {
  businessId: string;
  /** IANA timezone, or null when the business has not configured one yet. */
  timezone: string | null;
}
