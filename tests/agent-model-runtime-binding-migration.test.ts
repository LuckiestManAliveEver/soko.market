import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("agent model runtime binding migration", () => {
  it("persists one active verified binding per agent and migrates ready assignments", async () => {
    const sql = await readFile("infra/db/migrations/040_agent_model_runtime_bindings.sql", "utf8");

    expect(sql).toContain("create table if not exists cp2_agent_model_bindings");
    expect(sql).toContain("cp2_agent_model_bindings_one_active_per_agent_idx");
    expect(sql).toContain("where record ->> 'status' = 'active'");
    expect(sql).toContain("from cp2_agent_model_assignments");
    expect(sql).toContain("record ->> 'readinessStatus' = 'READY'");
    expect(sql).toContain("on conflict (entity_id) do nothing");
  });

  it("has a rollback", async () => {
    const sql = await readFile(
      "infra/db/rollbacks/040_agent_model_runtime_bindings.down.sql",
      "utf8"
    );
    expect(sql).toContain("drop table if exists cp2_agent_model_bindings");
  });
});
