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

// ---------------------------------------------------------------------------------------------
// Phase 1b: corridors and resolution provenance (A14-A16)
// ---------------------------------------------------------------------------------------------

export interface CorridorLineString {
  type: "LineString";
  /** `[longitude, latitude]` pairs, origin first. */
  coordinates: Array<[number, number]>;
}

export interface CorridorSummary {
  id: string;
  businessId: string;
  name: string;
  originLabel: string;
  destinationLabel: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  routeGeometry: CorridorLineString;
  /** Server-computed route length. A distance, not a physical quantity: metres, 3 decimals. */
  distanceMeters: number;
  geometryVersion: number;
  priority: number;
  /** Policy lineage whose active version overrides the business default for this corridor. */
  policyOverrideId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CorridorGeometryVersionSummary {
  corridorId: string;
  version: number;
  routeGeometry: CorridorLineString;
  distanceMeters: number;
  createdBy: string;
  createdAt: string;
}

export type CorridorUnresolvedReasonCode =
  | "NO_LOCATION"
  | "NO_ACTIVE_CORRIDOR"
  | "NO_DISPATCH_POLICY"
  | "OUTSIDE_TOLERANCE"
  | "INVALID_GEOMETRY";

export type CorridorSelectionReasonCode =
  "ONLY_CANDIDATE" | "SMALLEST_DIVERSION" | "PRIORITY_TIE_BREAK" | "ID_TIE_BREAK";

export interface CorridorMatchSummary {
  corridorId: string;
  corridorName: string;
  geometryVersion: number;
  diversionMeters: number;
  distanceAlongMeters: number;
  segmentIndex: number;
  maxDiversionMeters: number;
}

/** A computed (not persisted) corridor match for a shop's current delivery point. */
export type CorridorMatchResultSummary =
  | {
      status: "RESOLVED";
      shopLocationId: string;
      selected: CorridorMatchSummary;
      alternatives: CorridorMatchSummary[];
      reason: CorridorSelectionReasonCode;
    }
  | {
      status: "UNRESOLVED";
      shopLocationId: string | null;
      reason: CorridorUnresolvedReasonCode;
      nearest: CorridorMatchSummary | null;
    };

export type CorridorResolutionMethod = "AUTO" | "MANUAL";

/** One append-only provenance record: why an order was associated with a corridor (A16). */
export interface CorridorResolutionSummary {
  id: string;
  businessId: string;
  fulfillmentOrderId: string;
  invoiceId: string;
  corridorId: string;
  corridorGeometryVersion: number;
  shopLocationId: string;
  diversionMeters: number;
  distanceAlongMeters: number;
  segmentIndex: number;
  maxDiversionMeters: number;
  resolutionMethod: CorridorResolutionMethod;
  resolvedBy: string;
  resolvedAt: string;
  supersededAt: string | null;
}

export type CorridorResolutionStaleReason = "GEOMETRY_CHANGED" | "LOCATION_CHANGED";

export interface CorridorResolutionStatusSummary {
  businessId: string;
  invoiceId: string;
  resolutionStatus: "RESOLVED" | "UNRESOLVED";
  current: CorridorResolutionSummary | null;
  /** Computed, never repaired silently: a stale order must be re-resolved or confirmed. */
  stale: boolean;
  staleReasons: CorridorResolutionStaleReason[];
  history: CorridorResolutionSummary[];
}

export type ResolveOrderCorridorResultSummary =
  | {
      outcome: "RESOLVED";
      resolution: CorridorResolutionSummary;
      alternatives: CorridorMatchSummary[];
      reason: CorridorSelectionReasonCode | "MANUAL_ASSIGNMENT";
    }
  | {
      outcome: "UNRESOLVED";
      reason: CorridorUnresolvedReasonCode;
      nearest: CorridorMatchSummary | null;
      /** The previous resolution, if any, is left untouched (and may now be stale). */
      current: CorridorResolutionSummary | null;
    };
