import type { LocalDatabase } from "../client.js";
import type { Scope } from "../../types.js";
export async function migrateLocalDatabase(db: LocalDatabase, scope: Scope): Promise<void> {
  await db.transaction(scope, (state) => {
    if (state.schemaVersion !== 1) throw new Error("Unsupported offline database version.");
  });
}
