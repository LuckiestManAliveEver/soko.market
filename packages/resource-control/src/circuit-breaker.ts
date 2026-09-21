export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerEvent =
  | { type: "opened"; name: string; consecutiveFailures: number }
  | { type: "closed"; name: string }
  | { type: "half_open_probe"; name: string };

export class CircuitOpenError extends Error {
  constructor(readonly circuitName: string) {
    super(`Circuit breaker "${circuitName}" is open; failing fast without calling the dependency.`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  name: string;
  /** Consecutive failures required to trip from closed to open. Must be a positive integer. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing one probe attempt (half-open). */
  resetTimeoutMs: number;
  /** Concurrent probe attempts allowed while half-open. Default 1 - the conservative, standard
   *  choice; a failed probe reopens the circuit immediately. */
  halfOpenMaxAttempts?: number;
  onEvent?: (event: CircuitBreakerEvent) => void;
}

export interface CircuitBreaker {
  readonly name: string;
  /** Current state, resolving an elapsed open→half_open transition first if due. */
  state(): CircuitState;
  /** Throws `CircuitOpenError` without calling `fn` when open (or when half-open capacity is
   *  already spent). Otherwise calls `fn`, closing the circuit on success and counting toward
   *  `failureThreshold` on failure. Always rethrows whatever `fn` throws. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** Standard CLOSED → OPEN → HALF_OPEN → CLOSED|OPEN circuit breaker (resource-isolation.md §7). */
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  if (!Number.isSafeInteger(options.failureThreshold) || options.failureThreshold < 1) {
    throw new Error(
      `Circuit breaker "${options.name}": failureThreshold must be a positive integer.`
    );
  }
  if (!Number.isSafeInteger(options.resetTimeoutMs) || options.resetTimeoutMs <= 0) {
    throw new Error(
      `Circuit breaker "${options.name}": resetTimeoutMs must be a positive integer.`
    );
  }
  const halfOpenMaxAttempts = options.halfOpenMaxAttempts ?? 1;
  if (!Number.isSafeInteger(halfOpenMaxAttempts) || halfOpenMaxAttempts < 1) {
    throw new Error(
      `Circuit breaker "${options.name}": halfOpenMaxAttempts must be a positive integer.`
    );
  }

  const { name, failureThreshold, resetTimeoutMs, onEvent } = options;
  let state: CircuitState = "closed";
  let consecutiveFailures = 0;
  let openedAt = 0;
  let halfOpenInFlight = 0;

  function toOpen(): void {
    state = "open";
    openedAt = Date.now();
    halfOpenInFlight = 0;
    onEvent?.({ type: "opened", name, consecutiveFailures });
  }

  function toClosed(): void {
    state = "closed";
    consecutiveFailures = 0;
    halfOpenInFlight = 0;
    onEvent?.({ type: "closed", name });
  }

  function settle(): void {
    if (state === "open" && Date.now() - openedAt >= resetTimeoutMs) {
      state = "half_open";
      halfOpenInFlight = 0;
    }
  }

  return {
    name,
    state() {
      settle();
      return state;
    },
    async run(fn) {
      settle();
      if (state === "open") {
        throw new CircuitOpenError(name);
      }
      if (state === "half_open") {
        if (halfOpenInFlight >= halfOpenMaxAttempts) {
          throw new CircuitOpenError(name);
        }
        halfOpenInFlight += 1;
        onEvent?.({ type: "half_open_probe", name });
      }
      try {
        const result = await fn();
        toClosed();
        return result;
      } catch (error) {
        if (state === "half_open") {
          toOpen();
          throw error;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= failureThreshold) {
          toOpen();
        }
        throw error;
      }
    }
  };
}
