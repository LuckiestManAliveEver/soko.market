import type { LocalDatabase } from "../db/client.js";
import { OfflineError, type OfflineOrderIntent, type Scope } from "../types.js";

const MAX_ITEMS_PER_INTENT = 50;
const MAX_PENDING_ORDERS = 500;

/** Records one order intent captured over BLE or SMS into local storage only. Never touches
 *  `rows` (the product mirror), so it can never decrement committed stock - the server's
 *  reconciliation endpoint is the only thing allowed to turn an intent into a real sale. */
export async function recordPendingOfflineOrder(
  db: LocalDatabase,
  scope: Scope,
  intent: OfflineOrderIntent
): Promise<void> {
  validateOfflineOrderIntent(intent);
  return db.transaction(scope, (state) => {
    const existing = (state.pendingOfflineOrders ??= []);
    if (existing.some((entry) => entry.intent.id === intent.id)) return;
    if (existing.length >= MAX_PENDING_ORDERS)
      throw new OfflineError("OFFLINE_ORDERS_FULL", "Too many unsynced offline orders. Sync soon.");
    existing.push({
      intent,
      status: "pending_sync",
      createdAtLocal: new Date().toISOString(),
      syncedAt: null,
      outcome: null
    });
  });
}

/** Shared by local recording (this file) and PeerProvider's BLE order_intent frames - one
 *  validation path for every place an OfflineOrderIntent enters the client. */
export function validateOfflineOrderIntent(intent: OfflineOrderIntent): void {
  if (
    !intent ||
    typeof intent !== "object" ||
    [intent.id, intent.accountId, intent.storeId].some(
      (value) => typeof value !== "string" || !value || value.length > 200
    ) ||
    (intent.transport !== "ble" && intent.transport !== "sms") ||
    !Array.isArray(intent.items) ||
    intent.items.length < 1 ||
    intent.items.length > MAX_ITEMS_PER_INTENT
  )
    throw new Error("Invalid offline order intent.");
  for (const item of intent.items)
    if (
      typeof item.name !== "string" ||
      !item.name ||
      item.name.length > 200 ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > 100_000
    )
      throw new Error("Invalid offline order item.");
  const claim = intent.customerClaim;
  if (
    !claim ||
    (claim.type === "account" && (typeof claim.accountId !== "string" || !claim.accountId)) ||
    (claim.type === "phone" && (typeof claim.phone !== "string" || !claim.phone)) ||
    (claim.type !== "account" && claim.type !== "phone")
  )
    throw new Error(
      "Offline order intents must carry a real customer claim, not a device identity."
    );
}
