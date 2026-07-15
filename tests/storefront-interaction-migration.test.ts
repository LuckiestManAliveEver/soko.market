import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("storefront interaction persistence migration", () => {
  it("creates and rolls back every compatibility collection", () => {
    const migration = readFileSync(
      "infra/db/migrations/023_storefront_interaction_contracts.sql",
      "utf8"
    );
    const rollback = readFileSync(
      "infra/db/rollbacks/023_storefront_interaction_contracts.down.sql",
      "utf8"
    );
    for (const table of [
      "cp2_shop_presences",
      "cp2_network_invites",
      "cp2_public_customer_care_requests",
      "cp2_public_storefront_messages",
      "cp2_public_orders"
    ]) {
      expect(migration).toContain(table);
      expect(rollback).toContain(`drop table if exists ${table}`);
    }
  });
});
