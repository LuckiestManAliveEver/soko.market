import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CP27 account purge migration", () => {
  it("persists non-identifying purge proofs", () => {
    const sql = readFileSync("infra/db/migrations/022_account_deletion_purge.sql", "utf8");
    expect(sql).toContain("cp2_account_deletion_proofs");
    expect(sql).toContain("record jsonb not null");
    expect(sql).not.toContain("references accounts");
  });

  it("provides a rollback", () => {
    const sql = readFileSync("infra/db/rollbacks/022_account_deletion_purge.down.sql", "utf8");
    expect(sql).toContain("drop table if exists cp2_account_deletion_proofs");
  });

  it("removes the relational account graph and obsolete monolithic snapshots", () => {
    const source = readFileSync("services/api/src/cp2/postgres-store.ts", "utf8");
    for (const statement of [
      "delete from conversations",
      "delete from connected_channels",
      "delete from auth_audit_events",
      "delete from business_events",
      "delete from document_import_rows",
      "delete from inventory_movements",
      "delete from users",
      "delete from businesses",
      "delete from accounts",
      "delete from cp2_store_snapshots"
    ]) {
      expect(source).toContain(statement);
    }
  });
});
