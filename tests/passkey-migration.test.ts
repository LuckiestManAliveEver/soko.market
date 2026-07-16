import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("passkey persistence migration", () => {
  it("creates and rolls back passkey credentials and ceremonies", () => {
    const migration = readFileSync("infra/db/migrations/025_passkeys.sql", "utf8");
    const rollback = readFileSync("infra/db/rollbacks/025_passkeys.down.sql", "utf8");

    expect(migration).toContain("create table if not exists cp2_passkeys");
    expect(migration).toContain("create table if not exists cp2_passkey_ceremonies");
    expect(migration).toContain("cp2_passkeys_account_idx");
    expect(rollback).toContain("drop table if exists cp2_passkey_ceremonies");
    expect(rollback).toContain("drop table if exists cp2_passkeys");
  });
});
