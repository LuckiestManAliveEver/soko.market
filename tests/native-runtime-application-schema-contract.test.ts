import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkRetiredRuntimeReferences,
  productionScanRoots
} from "../scripts/check-retired-runtime-references.mjs";
import { normalizedCollections } from "../services/api/src/cp2/postgres-store";
import { RETIRED_EXECUTION_FABRIC_TABLES } from "../services/api/src/cp2/retired-execution-fabric-tables";

// Permanent regression coverage for the Render startup crash (relation "cp2_model_preferences"
// does not exist, code 42P01) documented in docs/architecture/native-runtime-deployment.md. The
// crash traced to a compiled-output orphan surviving a build that never cleaned dist, not to
// application source, so these tests check both the source-level contract (A, B, C) and, when a
// build artifact is present, the compiled output (D) - see services/api/dist checks below.

const distExists = existsSync(fileURLToPath(new URL("../services/api/dist", import.meta.url)));

describe("native runtime application/schema contract", () => {
  it("Test A: the normalized collection map never persists to a retired Execution Fabric table", () => {
    const tableNames = normalizedCollections.map((collection) => collection.tableName);
    for (const retiredTable of RETIRED_EXECUTION_FABRIC_TABLES) {
      expect(tableNames).not.toContain(retiredTable);
    }
  });

  it("Test B: the normalized collection map persists every native runtime table", () => {
    const tableNames = normalizedCollections.map((collection) => collection.tableName);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "cp2_native_runtime_agents",
        "cp2_native_runtime_models",
        "cp2_native_execution_hosts",
        "cp2_native_model_installations",
        "cp2_native_runtime_bindings",
        "cp2_native_runtime_binding_models"
      ])
    );
  });

  it("Test C: migration 065 drops the retired tables, and no production-reachable source references them", async () => {
    const migration = await readFile(
      new URL("../infra/db/migrations/065_retire_execution_fabric.sql", import.meta.url),
      "utf8"
    );
    for (const table of RETIRED_EXECUTION_FABRIC_TABLES) {
      expect(migration).toContain(`drop table ${table}`);
    }

    const sourceOnlyRoots = productionScanRoots.filter((root) => !root.endsWith("/dist"));
    const violations = checkRetiredRuntimeReferences({ scanRoots: sourceOnlyRoots });
    expect(violations).toEqual([]);
  });

  (distExists ? it : it.skip)(
    "Test D: compiled production output (services/api/dist) agrees with source - no retired " +
      "table references, only checked when a build artifact exists in this run",
    () => {
      const distOnlyRoots = productionScanRoots.filter((root) => root.endsWith("/dist"));
      const violations = checkRetiredRuntimeReferences({ scanRoots: distOnlyRoots });
      expect(violations).toEqual([]);
    }
  );
});
