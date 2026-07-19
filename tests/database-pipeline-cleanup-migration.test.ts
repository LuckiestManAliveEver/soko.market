import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("database pipeline cleanup migration", () => {
  it("removes the redundant sync index and validates every deferred constraint", async () => {
    const sql = await readFile("infra/db/migrations/033_database_pipeline_cleanup.sql", "utf8");

    expect(sql).toContain("drop index if exists account_sync_changes_account_sequence_idx");
    expect(sql.match(/validate constraint/g)).toHaveLength(15);
  });

  it("restores the removed index on rollback", async () => {
    const sql = await readFile("infra/db/rollbacks/033_database_pipeline_cleanup.down.sql", "utf8");

    expect(sql).toContain("create index if not exists account_sync_changes_account_sequence_idx");
  });
});
