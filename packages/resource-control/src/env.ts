/**
 * Shared env-var parsing for resource-control settings (concurrency, queue depth, circuit-breaker
 * thresholds). Mirrors the fail-closed style already used by services/api/src/config.ts
 * (`numberFromEnv`) and services/api/scripts/database-connection.mjs (`positiveIntegerFromEnv`)
 * so a bad value is a startup error, never a silently-ignored default.
 */
export function positiveIntegerFromEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function nonNegativeIntegerFromEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

// Bulkhead/circuit-breaker budget validation (maxConcurrency >= 1, maxQueue >= 0,
// failureThreshold >= 1, resetTimeoutMs > 0) lives in `createBulkhead`/`createCircuitBreaker`
// themselves (bulkhead.ts/circuit-breaker.ts) - every construction site already goes through one
// of those two constructors, so validating the same numbers again here would just be a second,
// driftable copy of the same checks. A queue shallower than the concurrency budget is not flagged
// as unsafe: maxQueue: 0 ("reject immediately once full, never queue") is a deliberate, correct,
// and commonly-used policy - see the `queueTimeoutMs` doc comment on `BulkheadOptions`.
