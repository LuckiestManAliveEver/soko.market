import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent profile persistence migration", () => {
  it("creates and rolls back the business-scoped profile collection", () => {
    const migration = readFileSync("infra/db/migrations/024_agent_profiles.sql", "utf8");
    const rollback = readFileSync("infra/db/rollbacks/024_agent_profiles.down.sql", "utf8");

    expect(migration).toContain("create table if not exists cp2_agent_profiles");
    expect(migration).toContain("cp2_agent_profiles_business_idx");
    expect(rollback).toContain("drop table if exists cp2_agent_profiles");
  });
});
