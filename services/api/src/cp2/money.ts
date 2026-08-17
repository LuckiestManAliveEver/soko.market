/**
 * Split out of store.ts (same reasoning as cp2-error.ts/text-normalization.ts) so domain modules
 * can round money values without a circular value-import back into store.ts. Re-exported from
 * store.ts for existing consumers.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
