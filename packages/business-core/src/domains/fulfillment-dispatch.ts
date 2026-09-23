/**
 * Pure dispatch rules for corridor pools and manifests (docs/architecture/corridor-fulfillment.md
 * A10, A13, A21). No I/O and no clock of its own - callers pass `now` - so every surface computes
 * readiness, cutoff and allocation identically. Weights are exact `bigint` grams.
 */

export type PoolReadiness = "ACCUMULATING" | "DISPATCHABLE" | "DISPATCH_READY";

/**
 * A13 readiness from the allocatable (eligible, non-stale) weight `M`:
 * - `M >= target` -> DISPATCH_READY
 * - `min <= M < target` -> DISPATCHABLE (only when a minimum is configured)
 * - otherwise ACCUMULATING
 * Readiness never dispatches anything; it is a label for humans and Phase 2 policy.
 */
export function computePoolReadiness(
  allocatableGrams: bigint,
  targetLoadGrams: bigint,
  minimumDispatchLoadGrams: bigint | null
): PoolReadiness {
  if (allocatableGrams >= targetLoadGrams) return "DISPATCH_READY";
  if (minimumDispatchLoadGrams !== null && allocatableGrams >= minimumDispatchLoadGrams) {
    return "DISPATCHABLE";
  }
  return "ACCUMULATING";
}

/** Percentage of target, exact to two decimals (truncated), computed in integer space. */
export function percentOfTarget(grams: bigint, targetLoadGrams: bigint): number {
  if (targetLoadGrams <= 0n) return 0;
  return Number((grams * 10_000n) / targetLoadGrams) / 100;
}

// ---------------------------------------------------------------------------------------------
// A21 allocation
// ---------------------------------------------------------------------------------------------

export interface AllocationCandidate {
  id: string;
  weightGrams: bigint;
  /** ISO timestamp; ordering is confirmedAt ascending, then id. */
  confirmedAt: string;
}

export interface AutomaticAllocation<T extends AllocationCandidate> {
  allocated: T[];
  /** Fit-able orders that did not fit the remaining capacity; they stay pooled with their age. */
  skipped: T[];
  /** Orders heavier than the whole vehicle: never allocatable to this vehicle. */
  requiresPlanning: T[];
  totalWeightGrams: bigint;
}

export function compareAllocationOrder(
  left: AllocationCandidate,
  right: AllocationCandidate
): number {
  if (left.confirmedAt !== right.confirmedAt) return left.confirmedAt < right.confirmedAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * A21 automatic selection: walk candidates oldest first; allocate what fits, skip-and-continue
 * what does not. An order heavier than the vehicle's total capacity is REQUIRES_PLANNING.
 */
export function allocateAutomatically<T extends AllocationCandidate>(
  candidates: readonly T[],
  capacityGrams: bigint
): AutomaticAllocation<T> {
  const ordered = [...candidates].sort(compareAllocationOrder);
  const allocated: T[] = [];
  const skipped: T[] = [];
  const requiresPlanning: T[] = [];
  let total = 0n;
  for (const candidate of ordered) {
    if (candidate.weightGrams > capacityGrams) {
      requiresPlanning.push(candidate);
    } else if (total + candidate.weightGrams <= capacityGrams) {
      allocated.push(candidate);
      total += candidate.weightGrams;
    } else {
      skipped.push(candidate);
    }
  }
  return { allocated, skipped, requiresPlanning, totalWeightGrams: total };
}

export type ExplicitSelectionRejection =
  | "NOT_FOUND"
  | "NOT_POOLED"
  | "WEIGHT_UNRESOLVED"
  | "WRONG_CORRIDOR"
  | "STALE_RESOLUTION"
  | "ALREADY_ALLOCATED"
  | "DUPLICATE";

// ---------------------------------------------------------------------------------------------
// A11 cutoff in the business timezone
// ---------------------------------------------------------------------------------------------

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a business-local wall-clock time, with Temporal's "compatible"
 * disambiguation: in a DST overlap (the wall time happens twice) the earlier instant; in a DST
 * gap (the wall time never happens) the time shifted forward by the gap's length.
 */
export function zonedWallTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
): Date {
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const halfDay = 12 * 3_600_000;
  // Every offset in effect near this date (at most two: before and after a transition).
  const offsetBefore = zoneOffsetMs(new Date(wallAsUtc - halfDay), timeZone);
  const offsetAfter = zoneOffsetMs(new Date(wallAsUtc + halfDay), timeZone);
  const matches = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => wallAsUtc - offset)
    .filter((candidate) => candidate + zoneOffsetMs(new Date(candidate), timeZone) === wallAsUtc)
    .sort((left, right) => left - right);
  // Gap: no candidate reads back as this wall time; apply the pre-transition offset, which lands
  // the same distance past the gap.
  return new Date(matches[0] ?? wallAsUtc - offsetBefore);
}

/** The business-local calendar date of `instant` as `{year, month, day}`. */
export function localDate(
  instant: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const parts = localParts(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * The next cutoff strictly after `now`: today's `HH:MM` in the business timezone if it is still
 * ahead, otherwise tomorrow's. At exactly the cutoff instant, today's cutoff has passed.
 */
export function nextCutoff(
  now: Date,
  timeZone: string,
  cutoffLocalTime: string
): { at: Date; millisecondsUntil: number } {
  const [hour, minute] = cutoffLocalTime.split(":").map(Number) as [number, number];
  const today = localDate(now, timeZone);
  let at = zonedWallTimeToUtc({ ...today, hour, minute }, timeZone);
  if (at.getTime() <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    at = zonedWallTimeToUtc(
      {
        year: tomorrow.getUTCFullYear(),
        month: tomorrow.getUTCMonth() + 1,
        day: tomorrow.getUTCDate(),
        hour,
        minute
      },
      timeZone
    );
  }
  return { at, millisecondsUntil: at.getTime() - now.getTime() };
}
