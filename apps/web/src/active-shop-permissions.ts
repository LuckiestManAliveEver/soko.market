// The viewer's permissions in the shop that is open on screen, from the session context the
// server computed (docs/architecture/corridor-fulfillment.md §16). Those permissions describe the
// context's own active shop and mode, which the client updates a moment after switching (and not
// at all while offline), so they are used only when they describe exactly this shop in seller
// mode. Otherwise the answer is "unknown" (empty), and screens show everything as before; the
// server still authorizes every request.
export function permissionsForOpenShop(
  context: { mode: string; activeShopId: string | null; permissions: readonly string[] } | null,
  businessId: string | null
): readonly string[] {
  if (context === null || businessId === null) return [];
  if (context.mode !== "seller" || context.activeShopId !== businessId) return [];
  return context.permissions;
}
