import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("owner phone identity migration", () => {
  it("adds private normalized phone metadata without forcing nullable legacy rows", async () => {
    const sql = await readFile("infra/db/migrations/029_owner_phone_identity.sql", "utf8");
    const schema = await readFile("infra/db/schema.ts", "utf8");
    const postgresStore = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");

    expect(sql).toContain("phone_number_e164 text");
    expect(sql).toContain("phone_country_code text");
    expect(sql).toContain("phone_national_number text");
    expect(sql).toContain("phone_verification_status text");
    expect(sql).toContain("phone_source text");
    expect(sql).toContain("public_phone_enabled boolean not null default false");
    expect(sql).toContain("phone_verification_status = 'unverified'");
    expect(sql).not.toContain("phone_verification_status = 'verified'");
    expect(sql).toContain("users_phone_number_e164_unique_idx");
    expect(sql).toContain("where phone_number_e164 is not null");
    expect(sql).not.toMatch(/phone_number_e164 text not null/i);

    expect(schema).toContain('phoneNumberE164: text("phone_number_e164")');
    expect(schema).toContain('publicPhoneEnabled: boolean("public_phone_enabled")');
    expect(postgresStore).toContain(
      'requiredMigrationFilename = "046_disable_sms_verification.sql"'
    );
    expect(postgresStore).toContain("phone_number_e164");
    expect(postgresStore).toContain('"updateOwnerPhone"');
  });
});
