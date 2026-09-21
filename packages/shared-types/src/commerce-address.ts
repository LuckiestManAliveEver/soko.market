/**
 * Pure derivation of a shop's public-facing commerce address ("handle@soko.market") from its
 * internal sokoId ("soko.handle"). Shared between the API (which is the source of truth for a
 * business's sokoId) and the web app (which needs to display/derive the same address for shops
 * it already has a sokoId for, without an extra round trip) so the two never drift apart.
 */
export function commerceAddressFromSokoId(sokoId: string): string {
  const handle = sokoId
    .trim()
    .toLowerCase()
    .replace(/^soko\./u, "");
  return `${handle}@soko.market`;
}

export function sokoIdFromCommerceAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  const handle = normalized.endsWith("@soko.market")
    ? normalized.slice(0, -"@soko.market".length)
    : normalized.replace(/^soko\./u, "");
  return `soko.${handle}`;
}

export function normalizeCommerceAddress(address: string): string {
  return commerceAddressFromSokoId(sokoIdFromCommerceAddress(address));
}
