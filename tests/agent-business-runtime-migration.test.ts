import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("agent business runtime migration", () => {
  it("adds normalized tenant-scoped runtime persistence", async () => {
    const sql = await readFile("infra/db/migrations/039_agent_business_runtime.sql", "utf8");
    const store = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");

    for (const table of [
      "cp2_agent_runtime_versions",
      "cp2_agent_context_sources",
      "cp2_agent_evaluation_events",
      "cp2_agent_owner_corrections"
    ]) {
      expect(sql).toContain(`create table if not exists ${table}`);
      expect(sql).toContain(`references cp2_businesses(entity_id) on delete cascade`);
      expect(store).toContain(`tableName: "${table}"`);
    }
    expect(sql).toContain("business_version_idx");
    expect(sql).toContain("business_created_idx");
    expect(store).toContain('requiredMigrationFilename = "046_disable_sms_verification.sql"');
  });

  it("provides a scoped rollback for only the new runtime tables", async () => {
    const sql = await readFile("infra/db/rollbacks/039_agent_business_runtime.down.sql", "utf8");

    expect(sql).toContain("drop table if exists cp2_agent_owner_corrections");
    expect(sql).toContain("drop table if exists cp2_agent_evaluation_events");
    expect(sql).toContain("drop table if exists cp2_agent_context_sources");
    expect(sql).toContain("drop table if exists cp2_agent_runtime_versions");
    expect(sql).not.toContain("cp2_businesses");
  });
});
