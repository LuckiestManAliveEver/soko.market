/**
 * Split out of store.ts so domain modules (services/api/src/cp2/domains/*) can throw the same
 * error type without a circular value-import back into store.ts. store.ts re-exports this for
 * every existing external consumer (routes.ts, tests) that imports Cp2Error from "./store.js".
 */
export class Cp2Error extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable?: boolean,
    readonly details?: Record<string, string | number | boolean | null>
  ) {
    super(message);
  }
}
