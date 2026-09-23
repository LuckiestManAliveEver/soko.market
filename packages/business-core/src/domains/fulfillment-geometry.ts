/**
 * Pure corridor geometry (docs/architecture/corridor-fulfillment.md A14/A15). No I/O, no clock,
 * no framework: deterministic numbers in, deterministic numbers out, so the API, tests and any
 * agent tool see exactly the same corridor matching.
 *
 * Geometry is a GeoJSON LineString with `[lng, lat]` positions. Distances use, per segment, a
 * local equirectangular plane centred on the segment's midpoint latitude with the mean Earth
 * radius R = 6,371,008.8 m. For the owner's 30-50 km routes the error against a great-circle
 * reference is far below a metre per kilometre (see tests/fulfillment-geometry.test.ts).
 *
 * Tolerances (documented, deterministic):
 * - Eligibility is inclusive: `diversionMeters <= maxDiversionMeters` qualifies.
 * - Ties compare diversion after rounding to the millimetre, then corridor `priority` (lower
 *   wins), then corridor id (lexical, lower wins).
 * - Within one corridor, equal-distance segments resolve to the lower segment index.
 */

export const EARTH_RADIUS_METERS = 6_371_008.8;

export type Position = [number, number];

export interface LineStringGeometry {
  type: "LineString";
  coordinates: Position[];
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface CorridorProjection {
  diversionMeters: number;
  distanceAlongMeters: number;
  segmentIndex: number;
}

export type GeometryValidation =
  | { ok: true; geometry: LineStringGeometry; distanceMeters: number }
  | { ok: false; errors: string[] };

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Longitude difference normalized into [-180, 180) so a segment never wraps the long way. */
function longitudeDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta >= 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/** Local plane offset (metres) of `point` from `origin`, scaled at `referenceLatitude`. */
function planeOffset(
  origin: Position,
  point: Position,
  referenceLatitude: number
): { x: number; y: number } {
  return {
    x:
      EARTH_RADIUS_METERS *
      radians(longitudeDelta(origin[0], point[0])) *
      Math.cos(radians(referenceLatitude)),
    y: EARTH_RADIUS_METERS * radians(point[1] - origin[1])
  };
}

function segmentLength(start: Position, end: Position): number {
  const { x, y } = planeOffset(start, end, (start[1] + end[1]) / 2);
  return Math.hypot(x, y);
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/**
 * Validates untrusted geometry (A14): a GeoJSON LineString, at least two positions, each a valid
 * `[lng, lat]`, and a non-zero total length. The length returned is computed here - a
 * client-supplied distance is never trusted.
 */
export function validateCorridorGeometry(value: unknown, maxPositions = 5000): GeometryValidation {
  const errors: string[] = [];
  const record = value as { type?: unknown; coordinates?: unknown } | null;
  if (record === null || typeof record !== "object" || record.type !== "LineString") {
    return { ok: false, errors: ["Route geometry must be a GeoJSON LineString."] };
  }
  if (!Array.isArray(record.coordinates)) {
    return { ok: false, errors: ["Route geometry coordinates must be an array of [lng, lat]."] };
  }
  const coordinates = record.coordinates as unknown[];
  if (coordinates.length < 2) {
    errors.push("Route geometry needs at least two points.");
  }
  if (coordinates.length > maxPositions) {
    errors.push(`Route geometry may have at most ${maxPositions} points.`);
  }
  coordinates.forEach((position, index) => {
    if (!isPosition(position)) {
      errors.push(`Point ${index + 1} must be a [longitude, latitude] pair of numbers.`);
      return;
    }
    if (position[0] < -180 || position[0] > 180) {
      errors.push(`Point ${index + 1} longitude must be between -180 and 180.`);
    }
    if (position[1] < -90 || position[1] > 90) {
      errors.push(`Point ${index + 1} latitude must be between -90 and 90.`);
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  const geometry: LineStringGeometry = {
    type: "LineString",
    coordinates: (coordinates as Position[]).map(([lng, lat]) => [lng, lat])
  };
  const distanceMeters = corridorLengthMeters(geometry);
  if (!(distanceMeters > 0)) {
    return { ok: false, errors: ["Route geometry must have a non-zero length."] };
  }
  return { ok: true, geometry, distanceMeters };
}

export function corridorLengthMeters(geometry: LineStringGeometry): number {
  let total = 0;
  for (let index = 0; index < geometry.coordinates.length - 1; index += 1) {
    total += segmentLength(
      geometry.coordinates[index] as Position,
      geometry.coordinates[index + 1] as Position
    );
  }
  return total;
}

/**
 * Nearest point on the corridor to `point`: how far off the road it is (`diversionMeters`), how
 * far along the road from the origin its nearest point lies (`distanceAlongMeters`), and which
 * segment that is. Points before the origin or past the destination clamp to the endpoints.
 */
export function projectPointOntoCorridor(
  point: GeoPoint,
  geometry: LineStringGeometry
): CorridorProjection {
  const target: Position = [point.longitude, point.latitude];
  let best: CorridorProjection | null = null;
  let travelled = 0;
  for (let index = 0; index < geometry.coordinates.length - 1; index += 1) {
    const start = geometry.coordinates[index] as Position;
    const end = geometry.coordinates[index + 1] as Position;
    const referenceLatitude = (start[1] + end[1]) / 2;
    const segment = planeOffset(start, end, referenceLatitude);
    const offset = planeOffset(start, target, referenceLatitude);
    const lengthSquared = segment.x * segment.x + segment.y * segment.y;
    const length = Math.sqrt(lengthSquared);
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, (offset.x * segment.x + offset.y * segment.y) / lengthSquared));
    const diversionMeters = Math.hypot(offset.x - t * segment.x, offset.y - t * segment.y);
    if (best === null || diversionMeters < best.diversionMeters) {
      best = { diversionMeters, distanceAlongMeters: travelled + t * length, segmentIndex: index };
    }
    travelled += length;
  }
  if (best === null) {
    throw new Error("Corridor geometry needs at least two points.");
  }
  return best;
}

export interface CorridorCandidate {
  id: string;
  priority: number;
  geometryVersion: number;
  geometry: unknown;
}

export interface CorridorMatch extends CorridorProjection {
  corridorId: string;
  geometryVersion: number;
  priority: number;
  maxDiversionMeters: number;
}

export type CorridorUnresolvedReason =
  | "NO_LOCATION"
  | "NO_ACTIVE_CORRIDOR"
  | "NO_DISPATCH_POLICY"
  | "OUTSIDE_TOLERANCE"
  | "INVALID_GEOMETRY";

export type CorridorSelectionReason =
  "ONLY_CANDIDATE" | "SMALLEST_DIVERSION" | "PRIORITY_TIE_BREAK" | "ID_TIE_BREAK";

export type CorridorResolution =
  | {
      status: "RESOLVED";
      selected: CorridorMatch;
      alternatives: CorridorMatch[];
      reason: CorridorSelectionReason;
    }
  | { status: "UNRESOLVED"; reason: CorridorUnresolvedReason; nearest: CorridorMatch | null };

/** Millimetre rounding used for deterministic diversion ties. */
function roundedMillimetres(meters: number): number {
  return Math.round(meters * 1000);
}

export function compareCorridorMatches(left: CorridorMatch, right: CorridorMatch): number {
  const diversion =
    roundedMillimetres(left.diversionMeters) - roundedMillimetres(right.diversionMeters);
  if (diversion !== 0) return diversion;
  if (left.priority !== right.priority) return left.priority - right.priority;
  return left.corridorId < right.corridorId ? -1 : left.corridorId > right.corridorId ? 1 : 0;
}

/**
 * A15 deterministic corridor selection. `maxDiversionFor` returns the effective policy's
 * `maxDiversionMeters` for a corridor (override ?? business default), or null when the corridor
 * has no effective policy - such a corridor cannot qualify.
 */
export function resolveCorridor(
  point: GeoPoint | null,
  corridors: readonly CorridorCandidate[],
  maxDiversionFor: (corridor: CorridorCandidate) => number | null
): CorridorResolution {
  if (point === null) return { status: "UNRESOLVED", reason: "NO_LOCATION", nearest: null };
  if (corridors.length === 0) {
    return { status: "UNRESOLVED", reason: "NO_ACTIVE_CORRIDOR", nearest: null };
  }
  const matches: CorridorMatch[] = [];
  let invalid = 0;
  let unpoliced = 0;
  for (const corridor of corridors) {
    const validation = validateCorridorGeometry(corridor.geometry);
    if (!validation.ok) {
      invalid += 1;
      continue;
    }
    const maxDiversionMeters = maxDiversionFor(corridor);
    if (maxDiversionMeters === null) {
      unpoliced += 1;
      continue;
    }
    matches.push({
      corridorId: corridor.id,
      geometryVersion: corridor.geometryVersion,
      priority: corridor.priority,
      maxDiversionMeters,
      ...projectPointOntoCorridor(point, validation.geometry)
    });
  }
  matches.sort(compareCorridorMatches);
  const qualifying = matches.filter((match) => match.diversionMeters <= match.maxDiversionMeters);
  const [selected, ...alternatives] = qualifying;
  if (selected === undefined) {
    const reason: CorridorUnresolvedReason =
      matches.length > 0
        ? "OUTSIDE_TOLERANCE"
        : unpoliced > 0
          ? "NO_DISPATCH_POLICY"
          : invalid > 0
            ? "INVALID_GEOMETRY"
            : "NO_ACTIVE_CORRIDOR";
    return { status: "UNRESOLVED", reason, nearest: matches[0] ?? null };
  }
  const runnerUp = alternatives[0];
  const reason: CorridorSelectionReason =
    runnerUp === undefined
      ? "ONLY_CANDIDATE"
      : roundedMillimetres(runnerUp.diversionMeters) !==
          roundedMillimetres(selected.diversionMeters)
        ? "SMALLEST_DIVERSION"
        : runnerUp.priority !== selected.priority
          ? "PRIORITY_TIE_BREAK"
          : "ID_TIE_BREAK";
  return { status: "RESOLVED", selected, alternatives, reason };
}
