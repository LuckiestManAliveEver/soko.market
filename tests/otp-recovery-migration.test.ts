import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OTP recovery purpose migration", () => {
  it("persists and rolls back the signup or recovery purpose", () => {
    const migration = readFileSync("infra/db/migrations/026_otp_recovery_purpose.sql", "utf8");
    const rollback = readFileSync("infra/db/rollbacks/026_otp_recovery_purpose.down.sql", "utf8");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS purpose");
    expect(migration).toContain("CHECK (purpose IN ('signup', 'recovery'))");
    expect(migration).toContain("otp_challenges_recovery_contact_idx");
    expect(rollback).toContain("DROP COLUMN IF EXISTS purpose");
  });
});
