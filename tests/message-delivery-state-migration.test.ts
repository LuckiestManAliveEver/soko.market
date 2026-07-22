import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("message delivery state migration", () => {
  it("adds durable idempotency, lifecycle metadata, and account-scoped attempts", async () => {
    const sql = await readFile("infra/db/migrations/031_message_delivery_state.sql", "utf8");
    const schema = await readFile("infra/db/schema.ts", "utf8");
    const postgresStore = await readFile("services/api/src/cp2/postgres-store.ts", "utf8");

    expect(sql).toContain("idempotency_key text");
    expect(sql).toContain("conversation_messages_idempotency_idx");
    expect(sql).toContain("message_delivery_attempts");
    expect(sql).toContain("account_id uuid not null");
    expect(sql).toContain("'queued'");
    expect(sql).toContain("'retrying'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain("provider_response_reference");
    expect(schema).toContain('idempotencyKey: text("idempotency_key")');
    expect(schema).toContain("export const messageDeliveryAttempts = pgTable(");
    expect(postgresStore).toContain(
      'requiredMigrationFilename = "038_auth_retention_policy.sql"'
    );
    expect(postgresStore).toContain('tableName: "cp2_message_delivery_attempts"');
  });

  it("provides a scoped rollback", async () => {
    const sql = await readFile("infra/db/rollbacks/031_message_delivery_state.down.sql", "utf8");

    expect(sql).toContain("drop table if exists cp2_message_delivery_attempts");
    expect(sql).toContain("drop table if exists message_delivery_attempts");
    expect(sql).toContain("drop column if exists idempotency_key");
  });
});
