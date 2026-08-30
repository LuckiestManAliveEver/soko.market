import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("browser inference assignment migration", () => {
  it("creates a device-scoped portable-contract table with bounded contract checks", async () => {
    const sql = await readFile("infra/db/migrations/041_browser_inference_assignments.sql", "utf8");
    expect(sql).toContain("create table if not exists cp2_browser_inference_assignments");
    expect(sql).toContain("cp2_browser_inference_assignments_device_idx");
    expect(sql).toContain("cp2_browser_inference_assignments_identity_check");
    expect(sql).toContain("cp2_browser_inference_assignments_model_contract_check");
    expect(sql).toContain("cp2_browser_inference_assignments_contract_check");
    expect(sql).toContain("cp2_browser_inference_assignments_checkpoint_check");
    expect(sql).toContain("'transformers-js', 'webllm'");
    expect(sql).toContain("'browser-webgpu', 'browser-wasm'");
    expect(sql).toContain(`'["task-state"]'::jsonb`);
  });

  it("provides a rollback and advances the production schema requirement", async () => {
    const [rollback, postgresStore] = await Promise.all([
      readFile("infra/db/rollbacks/041_browser_inference_assignments.down.sql", "utf8"),
      readFile("services/api/src/cp2/postgres-store.ts", "utf8")
    ]);
    expect(rollback).toContain("drop table if exists cp2_browser_inference_assignments");
    expect(postgresStore).toContain(
      'requiredMigrationFilename = "051_single_identity_single_store.sql"'
    );
  });

  it("is finally dropped by migration 075, once it had been fully dead for good", async () => {
    const sql = await readFile(
      "infra/db/migrations/075_drop_dead_runtime_assignment_tables.sql",
      "utf8"
    );
    expect(sql).toContain("drop table cp2_browser_inference_assignments");
  });
});
