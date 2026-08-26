import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("execution fabric entities migration", () => {
  it("adds three purely additive tables, following the existing normalized-store convention", async () => {
    const sql = await readFile(
      "infra/db/migrations/060_execution_fabric_entities.sql",
      "utf8"
    );

    for (const table of [
      "cp2_model_preferences",
      "cp2_runtime_hosts",
      "cp2_runtime_model_installations"
    ]) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }

    // Additive, not destructive: no existing table is altered or dropped.
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("drop column");

    // ModelPreference is business-scoped (an agent's preference belongs to one shop).
    expect(sql).toContain("references cp2_businesses(entity_id) on delete cascade");
    // RuntimeHost and RuntimeModelInstallation are account-scoped, not business-scoped - the
    // Phase 0 audit found no existing "agent belongs to a device" coupling to mirror, and Phase 1's
    // brief explicitly asked for RuntimeHost as a net-new, account-owned concept.
    expect(sql).toContain("references cp2_accounts(entity_id) on delete cascade");

    // RuntimeModelInstallation belongs to a RuntimeHost via parent_id.
    expect(sql).toContain("parent_id text references cp2_runtime_hosts(entity_id) on delete cascade");

    // No persistent heartbeat/liveness column anywhere (docs/inference/owner-node.md:32) - only an
    // identity pointer (brokerNodeId) that a caller resolves against OwnerNodeBroker at read time.
    expect(sql).not.toContain("last_heartbeat");
    expect(sql).not.toMatch(/\bonline\s+boolean\b/);
    expect(sql).not.toContain("lastHeartbeatAt");
    expect(sql).toContain("brokerNodeId");

    // One preference per (tenant, scope, scopeId) - matches the planner's precedence model.
    expect(sql).toContain("cp2_model_preferences_scope_idx");
  });

  it("provides a scoped rollback for only the three new tables", async () => {
    const sql = await readFile(
      "infra/db/rollbacks/060_execution_fabric_entities.down.sql",
      "utf8"
    );

    expect(sql).toContain("drop table if exists cp2_model_preferences");
    expect(sql).toContain("drop table if exists cp2_runtime_hosts");
    expect(sql).toContain("drop table if exists cp2_runtime_model_installations");
    expect(sql).not.toContain("cp2_businesses");
    expect(sql).not.toContain("cp2_accounts");
    expect(sql).not.toContain("alter table");
  });

  it("is not yet wired into Cp2Store/postgres-store.ts - stays a standalone store for this phase", async () => {
    const store = await readFile("services/api/src/cp2/store.ts", "utf8");
    const postgresStore = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");
    const routes = await readFile("services/api/src/cp2/routes.ts", "utf8");

    expect(store).not.toContain("execution-fabric");
    expect(store).not.toContain("ExecutionFabricStore");
    expect(postgresStore).not.toContain("cp2_model_preferences");
    expect(postgresStore).not.toContain("cp2_runtime_hosts");
    expect(postgresStore).not.toContain("cp2_runtime_model_installations");
    expect(routes).not.toContain("execution-fabric");
  });
});
