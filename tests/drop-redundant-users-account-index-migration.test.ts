import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("drop redundant users account index migration", () => {
  it("drops the plain index made redundant by the unique index from migration 051", async () => {
    const sql = await readFile(
      "infra/db/migrations/064_drop_redundant_users_account_index.sql",
      "utf8"
    );

    expect(sql).toContain("drop index if exists users_account_idx");
  });

  it("restores the removed index on rollback", async () => {
    const sql = await readFile(
      "infra/db/rollbacks/064_drop_redundant_users_account_index.down.sql",
      "utf8"
    );

    expect(sql).toContain("create index if not exists users_account_idx");
    expect(sql).toContain("on users (account_id)");
  });
});
