import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("phone PIN recovery migration", () => {
  it("stores only a nullable recovery-code hash for legacy-safe rollout", async () => {
    const sql = await readFile("infra/db/migrations/030_phone_pin_recovery_code.sql", "utf8");
    const schema = await readFile("infra/db/schema.ts", "utf8");
    const postgresStore = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");

    expect(sql).toContain("recovery_code_hash text");
    expect(sql).toContain("recovery_code_hash is null");
    expect(sql).toContain("^[a-f0-9]{64}$");
    expect(sql).not.toContain("recovery_code text");
    expect(schema).toContain('recoveryCodeHash: text("recovery_code_hash")');
    expect(postgresStore).toContain("recovery_code_hash");
    expect(postgresStore).toContain(
      'requiredMigrationFilename = "041_browser_inference_assignments.sql"'
    );
  });
});
