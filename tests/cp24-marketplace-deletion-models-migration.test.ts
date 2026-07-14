import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("marketplace, deletion, and model migration", () => {
  it("creates persistence and quarantine archive tables", () => {
    const sql = readFileSync("infra/db/migrations/020_marketplace_deletion_models.sql", "utf8");
    expect(sql).toContain("cp2_marketplace_intro_states");
    expect(sql).toContain("cp2_active_ai_models");
    expect(sql).toContain("shop_deletion_archives");
    expect(sql).toContain("restore_until");
  });

  it("has a rollback for every new table", () => {
    const sql = readFileSync("infra/db/rollbacks/020_marketplace_deletion_models.down.sql", "utf8");
    expect(sql).toContain("drop table if exists shop_deletion_archives");
    expect(sql).toContain("drop table if exists cp2_active_ai_models");
    expect(sql).toContain("drop table if exists cp2_marketplace_intro_states");
  });
});
