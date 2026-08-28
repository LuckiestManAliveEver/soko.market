import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native runtime binding migration", () => {
  it("contains the authoritative FKs, uniqueness guards, conversation binding, and rollback", async () => {
    const migration = await readFile(
      new URL("../infra/db/migrations/063_native_runtime_bindings.sql", import.meta.url),
      "utf8"
    );
    const rollback = await readFile(
      new URL("../infra/db/rollbacks/063_native_runtime_bindings.down.sql", import.meta.url),
      "utf8"
    );
    expect(migration).toContain("cp2_native_runtime_bindings_one_global_default_idx");
    expect(migration).toContain("cp2_native_runtime_binding_models_one_primary_idx");
    expect(migration).toContain("cp2_native_runtime_binding_models_fallback_priority_idx");
    expect(migration).toContain("foreign key (model_id)");
    expect(migration).toContain("references cp2_native_execution_hosts(entity_id)");
    expect(migration).toContain(
      "active runtime binding % must have exactly one enabled primary model"
    );
    expect(migration).toContain("add column if not exists runtime_binding_id");
    expect(migration).toContain("builtin:soko-default-runtime:v1");
    expect(rollback).toContain("drop table if exists cp2_native_runtime_binding_models");
  });

  it("archives retired rows, drops their tables, and installs an unverified generative default", async () => {
    const migration = await readFile(
      new URL("../infra/db/migrations/065_retire_execution_fabric.sql", import.meta.url),
      "utf8"
    );
    const verifier = await readFile(
      new URL("../services/api/scripts/verify-db-schema.mjs", import.meta.url),
      "utf8"
    );
    expect(migration).toContain("'status', 'unavailable'");
    expect(migration).toContain("'status', 'draft'");
    expect(migration).toContain("drop table cp2_model_preferences");
    expect(migration).toContain("drop table cp2_runtime_hosts");
    expect(migration).toContain("drop table cp2_runtime_model_installations");
    expect(migration).toContain("'openai-fast'");
    expect(migration).toContain("'activationRequired', true");
    expect(verifier).toContain('process.env.REQUIRE_NEON_DATABASE === "true"');
    expect(verifier).toContain("Retired runtime tables remain");
  });
});
