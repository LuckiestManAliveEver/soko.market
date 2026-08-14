import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const purgeScriptPath = new URL("../scripts/purge-all-users.sql", import.meta.url);
const postgresStorePath = new URL("../services/api/src/cp2/postgres-store.ts", import.meta.url);

describe("registered-user purge script", () => {
  it("classifies every normalized PostgreSQL collection and preserves only reviewed globals", async () => {
    const [script, postgresStore] = await Promise.all([
      readFile(purgeScriptPath, "utf8"),
      readFile(postgresStorePath, "utf8")
    ]);
    const plan = new Map(
      [...script.matchAll(/\('([^']+)', '(DELETE|PRESERVE)',/g)].map((match) => [
        match[1],
        match[2]
      ])
    );
    const normalizedTables = [...postgresStore.matchAll(/tableName: "([a-z0-9_]+)"/g)].map(
      (match) => match[1]
    );

    expect(plan.size).toBe(148);
    expect([...plan.values()].filter((value) => value === "DELETE")).toHaveLength(143);
    expect(
      [...plan.entries()]
        .filter(([, classification]) => classification === "PRESERVE")
        .map(([tableName]) => tableName)
        .sort()
    ).toEqual(
      [
        "database_backup_runs",
        "database_health_checks",
        "database_restore_drills",
        "identity_providers",
        "soko_schema_migrations"
      ].sort()
    );
    expect(normalizedTables.length).toBeGreaterThan(0);
    for (const tableName of normalizedTables) {
      expect(plan.get(tableName), `${tableName} must be deleted`).toBe("DELETE");
    }
  });

  it("defaults to audit-only and retains transactional safety checks", async () => {
    const script = await readFile(purgeScriptPath, "utf8");

    expect(script).toContain("\\set execute_purge 'NO'");
    expect(script).toContain("051_single_identity_single_store.sql");
    expect(script).toContain("purge_unclassified_tables");
    expect(script).toContain("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    expect(script).toContain("ACCESS EXCLUSIVE MODE");
    expect(script).toContain("ROLLBACK;");
    expect(script).toContain("COMMIT;");
    expect(script).toContain("PRE-PURGE ROW COUNTS FOR EVERY AFFECTED TABLE");
    expect(script).toContain("POST-PURGE ROW COUNTS FOR EVERY AFFECTED TABLE");
    expect(script).toContain("REQUIRED ORPHAN/RESIDUAL CHECKS");
    expect(script).toContain("EXTERNAL REFERENCES (reported only");
    expect(script).not.toMatch(/^\s*(DROP|TRUNCATE)\b/m);
    expect(script).not.toMatch(/^\s*ALTER\s+TABLE.*DISABLE\b/m);
    expect(script).not.toContain("session_replication_role");
  });
});
