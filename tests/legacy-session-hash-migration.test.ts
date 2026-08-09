import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("legacy session hash repair migration", () => {
  it("backfills both session stores and prevents future empty security fields", async () => {
    const [migration, rollback, postgresStore] = await Promise.all([
      readFile("infra/db/migrations/043_legacy_session_hashes.sql", "utf8"),
      readFile("infra/db/rollbacks/043_legacy_session_hashes.down.sql", "utf8"),
      readFile("services/api/src/cp2/postgres-store.ts", "utf8")
    ]);

    expect(migration).toContain("update sessions");
    expect(migration).toContain("update cp2_sessions");
    expect(migration).toContain("legacy-unavailable:");
    expect(migration).toContain("nullif(btrim(new.user_agent_hash), '')");
    expect(migration).toContain("sessions_user_agent_hash_nonempty_check");
    expect(migration).toContain("sessions_refresh_token_hash_nonempty_check");
    expect(rollback).toContain("drop constraint if exists");
    expect(postgresStore).toContain(
      'requiredMigrationFilename = "049_platform_chat_commerce_foundation.sql"'
    );
  });
});
