import type { LocalDatabase } from "../db/client.js";
import type { OfflineOrderIntent, OfflineOrderIntentOutcome, Scope } from "../types.js";

const MAX_INTENTS_PER_PUSH = 25;

export interface OfflineOrderSyncTransport {
  pushOrderIntents(intents: OfflineOrderIntent[]): Promise<{ outcomes: OfflineOrderIntentOutcome[] }>;
}

/** Pushes every still-unsynced offline order intent to the server's reconciliation endpoint and
 *  applies the returned outcomes back locally. This never mutates local product stock itself -
 *  a confirmed/partial outcome's stock effect reaches this device through the normal
 *  SyncClient.pull() of the invoice/product it produced, the same as any other server mutation. */
export async function pushOfflineOrderIntents(
  db: LocalDatabase,
  scope: Scope,
  transport: OfflineOrderSyncTransport
): Promise<void> {
  for (let count = 0; count < 1_000; count++) {
    const state = await db.read(scope);
    const batch = (state.pendingOfflineOrders ?? [])
      .filter((entry) => entry.status === "pending_sync")
      .slice(0, MAX_INTENTS_PER_PUSH);
    if (batch.length === 0) return;
    const { outcomes } = await transport.pushOrderIntents(batch.map((entry) => entry.intent));
    if (outcomes.length !== batch.length)
      throw new Error("Offline order reconciliation returned the wrong number of outcomes.");
    await db.transaction(scope, (current) => {
      const orders = (current.pendingOfflineOrders ??= []);
      for (const outcome of outcomes) {
        const order = orders.find((entry) => entry.intent.id === outcome.id);
        if (!order) continue;
        order.status = outcome.status;
        order.outcome = outcome;
        order.syncedAt = new Date().toISOString();
      }
    });
  }
  throw new Error("Offline order sync exceeded its batch limit; pending intents were retained.");
}
