import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("account AI asset migration", () => {
  it("stores account manifests and chunked GGUF bytes in Postgres with cascade cleanup", async () => {
    const migration = await readFile(
      new URL("../infra/db/migrations/066_account_ai_assets.sql", import.meta.url),
      "utf8"
    );
    const postgresStore = await readFile(
      new URL("../services/api/src/cp2/postgres-store.ts", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("cp2_installed_oss_agent_manifests");
    expect(migration).toContain("cp2_model_artifacts");
    expect(migration).toContain("cp2_model_artifact_chunks");
    expect(migration).toContain("content bytea not null");
    expect(migration.match(/on delete cascade/g)?.length).toBeGreaterThanOrEqual(3);
    expect(postgresStore).toContain('"066_account_ai_assets.sql"');
    expect(postgresStore).toContain("createPostgresAccountAiAssetStore(pool)");
  });
});
