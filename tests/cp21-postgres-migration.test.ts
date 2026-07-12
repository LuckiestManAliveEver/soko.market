import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "infra/db/migrations/018_cp21_account_sync_changes.sql"
);
const rollbackPath = resolve(
  process.cwd(),
  "infra/db/rollbacks/018_cp21_account_sync_changes.down.sql"
);

describe("CP21 Postgres migration", () => {
  it("creates an account-scoped ordered journal with valid tombstone constraints", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("create table if not exists account_sync_changes");
    expect(sql).toContain("primary key (account_id, sequence)");
    expect(sql).toContain("cursor uuid not null unique");
    expect(sql).toContain("operation = 'delete' and entity is null");
    expect(sql).toContain("tombstone_expires_at is not null");
    expect(sql).toContain("account_sync_changes_account_sequence_idx");
  });

  it("provides an explicit rollback", async () => {
    const sql = await readFile(rollbackPath, "utf8");
    expect(sql).toContain("drop table if exists account_sync_changes");
  });
});
