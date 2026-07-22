import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("auth retention policy migration", () => {
  it("prevents stale writers from restoring expired authentication state", async () => {
    const sql = await readFile("infra/db/migrations/038_auth_retention_policy.sql", "utf8");

    expect(sql).toContain("otp_challenges_retention_trigger");
    expect(sql).toContain("verification_challenges_retention_trigger");
    expect(sql).toContain("cp2_otp_challenges_retention_trigger");
    expect(sql).toContain("cp2_passkey_ceremonies_retention_trigger");
    expect(sql).toContain("sessions_retention_trigger");
    expect(sql).toContain("cp2_sessions_retention_trigger");
    expect(sql).toContain("delete from otp_challenges");
    expect(sql).toContain("delete from cp2_passkey_ceremonies");
    expect(sql).toContain("revocation_reason = 'expired'");
  });

  it("provides a trigger-only rollback without attempting to restore expired secrets", async () => {
    const sql = await readFile("infra/db/rollbacks/038_auth_retention_policy.down.sql", "utf8");

    expect(sql).toContain("drop trigger if exists sessions_retention_trigger on sessions");
    expect(sql).not.toContain("insert into");
  });
});
