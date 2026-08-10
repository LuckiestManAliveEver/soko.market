import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("single identity and single store migration", () => {
  it("enforces canonical identities and one owned store per application user", async () => {
    const [sql, rollback, schema, store] = await Promise.all([
      readFile("infra/db/migrations/051_single_identity_single_store.sql", "utf8"),
      readFile("infra/db/rollbacks/051_single_identity_single_store.down.sql", "utf8"),
      readFile("infra/db/schema.ts", "utf8"),
      readFile("services/api/src/cp2/postgres-store.ts", "utf8")
    ]);

    expect(sql).toContain("count(distinct account_id) > 1");
    expect(sql).toContain("accounts_primary_auth_destination_canonical_check");
    expect(sql).toContain("users_phone_number_e164_canonical_check");
    expect(sql).toContain("account_identities_value_canonical_check");
    expect(sql).toContain("users_account_id_unique_idx");
    expect(sql).toContain("business_memberships_owner_user_unique_idx");
    expect(sql).toContain("where role = 'owner'");
    expect(sql).toContain("insert into account_identities");
    expect(schema).toContain('uniqueIndex("users_account_id_unique_idx")');
    expect(schema).toContain('uniqueIndex("business_memberships_owner_user_unique_idx")');
    expect(store).toContain('requiredMigrationFilename = "051_single_identity_single_store.sql"');

    expect(rollback).toContain("drop index if exists business_memberships_owner_user_unique_idx");
    expect(rollback).toContain("drop index if exists users_account_id_unique_idx");
  });
});
