import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("101_multi_provider_inference migration", () => {
  it("is additive and idempotent", async () => {
    const sql = await readFile("infra/db/migrations/101_multi_provider_inference.sql", "utf8");
    const executable = sql.replace(/--.*$/gmu, "");
    for (const table of [
      "inference_providers",
      "inference_provider_credentials",
      "inference_runs",
      "inference_policies"
    ]) {
      expect(executable).toContain(`create table if not exists ${table} (`);
    }
    expect(executable).not.toMatch(/\b(?:drop|truncate|delete|update)\b/iu);
    expect(executable).not.toMatch(/alter table (?!inference_)/iu);
    // No second agents or models table.
    expect(executable).not.toMatch(/create table if not exists (?:agents|models|cp2_[a-z_]*)\b/iu);
    for (const statement of executable.match(/create (?:unique )?index[^;]+;/giu) ?? []) {
      expect(statement).toMatch(/if not exists/iu);
    }
  });

  it("stores secrets only as encrypted envelopes and erases them on revocation", async () => {
    const sql = await readFile("infra/db/migrations/101_multi_provider_inference.sql", "utf8");
    expect(sql).toContain("encrypted_secret text");
    expect(sql).not.toMatch(/\bapi_key text\b|\bsecret text\b|\bplaintext\b text/iu);
    expect(sql).toContain("status <> 'REVOKED' or encrypted_secret is null");
    expect(sql).toMatch(/encrypted_secret is null or encrypted_secret ~ '\^v\[0-9\]\+:/u);
    // Telemetry has no prompt/output columns.
    const runs = sql.slice(sql.indexOf("create table if not exists inference_runs"));
    const runsTable = runs.slice(0, runs.indexOf(");"));
    expect(runsTable).not.toMatch(/\b(?:prompt|messages|output|completion_text|content)\b/iu);
  });

  it("has a rollback that drops exactly what it created", async () => {
    const rollback = await readFile(
      "infra/db/rollbacks/101_multi_provider_inference.down.sql",
      "utf8"
    );
    const statements =
      rollback.replace(/--.*$/gmu, "").match(/drop table if exists [a-z_]+/gu) ?? [];
    expect(statements.sort()).toEqual(
      [
        "drop table if exists inference_policies",
        "drop table if exists inference_provider_credentials",
        "drop table if exists inference_providers",
        "drop table if exists inference_runs"
      ].sort()
    );
  });
});
