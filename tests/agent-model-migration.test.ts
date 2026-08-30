import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("agent model assignment migration", () => {
  it(
    "adds normalized installation persistence with owner indexes; the app retired per-device " +
      "model assignment long before cp2_agent_model_assignments itself was finally dropped by " +
      "migration 075 - postgres-store.ts never synced it",
    async () => {
      const sql = await readFile("infra/db/migrations/035_agent_model_assignments.sql", "utf8");
      const store = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");

      expect(sql).toContain("cp2_installed_agent_models");
      expect(sql).toContain("cp2_agent_model_assignments");
      expect(sql).toContain("(account_id, user_id)");
      expect(sql).toContain("(business_id)");
      expect(store).toContain('{ key: "installedAgentModels"');
      expect(store).not.toContain('{ key: "agentModelAssignments"');
    }
  );

  it("provides a scoped rollback", async () => {
    const sql = await readFile("infra/db/rollbacks/035_agent_model_assignments.down.sql", "utf8");
    expect(sql).toContain("drop table if exists cp2_agent_model_assignments");
    expect(sql).toContain("drop table if exists cp2_installed_agent_models");
  });

  it("is finally dropped by migration 075, once it had been fully dead for good", async () => {
    const sql = await readFile(
      "infra/db/migrations/075_drop_dead_runtime_assignment_tables.sql",
      "utf8"
    );
    expect(sql).toContain("drop table cp2_agent_model_assignments");
  });
});
