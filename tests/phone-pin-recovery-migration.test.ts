import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("phone PIN recovery migration", () => {
  it("drops the retired recovery-code credential", async () => {
    const sql = await readFile(
      "infra/db/migrations/047_remove_phone_pin_recovery_codes.sql",
      "utf8"
    );
    const rollback = await readFile(
      "infra/db/rollbacks/047_remove_phone_pin_recovery_codes.down.sql",
      "utf8"
    );
    const schema = await readFile("infra/db/schema.ts", "utf8");
    const postgresStore = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");

    expect(sql).toContain("drop column if exists recovery_code_hash");
    expect(rollback).toContain("add column if not exists recovery_code_hash text");
    expect(rollback).toContain("cannot be reconstructed");
    expect(schema).not.toContain('recoveryCodeHash: text("recovery_code_hash")');
    expect(postgresStore).not.toContain("recovery_code_hash");
    expect(postgresStore).toContain(
      'requiredMigrationFilename = "047_remove_phone_pin_recovery_codes.sql"'
    );
  });
});
