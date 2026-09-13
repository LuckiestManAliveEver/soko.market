import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const requireApi = createRequire(resolve("services/api/package.json"));
interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}
const { Pool } = requireApi("pg") as {
  Pool: new (options: { connectionString: string | undefined }) => {
    connect(): Promise<QueryClient>;
    end(): Promise<void>;
  };
};
const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("runtime transfer migration on isolated PostgreSQL schema", () => {
  it("upgrades the existing protocol, replays safely, and enforces foreign keys, lifecycle and single active transfer", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    const schema = `handoff_test_${Date.now()}`;
    try {
      await client.query("begin");
      await client.query(`create schema ${schema}`);
      await client.query(`set local search_path to ${schema}`);
      for (const table of [
        "cp2_native_runtime_agents",
        "cp2_native_runtime_models",
        "cp2_native_execution_hosts"
      ])
        await client.query(`create table ${table}(entity_id text primary key)`);
      for (const name of [
        "083_runtime_handoff_protocol.sql",
        "084_runtime_handoff_created_at_index.sql",
        "085_runtime_transfers.sql",
        "085_runtime_transfers.sql"
      ])
        await client.query(readFileSync(`infra/db/migrations/${name}`, "utf8"));
      await client.query("insert into cp2_native_runtime_agents values ('agent')");
      await client.query("insert into cp2_native_runtime_models values ('model')");
      await client.query("insert into cp2_native_execution_hosts values ('hosted'), ('local')");
      const cp = {
        taskId: "task",
        conversationId: "task",
        goal: "Continue",
        currentState: "Pending tool",
        runtime: { agentId: "agent", modelId: "model", executionHostId: "hosted" },
        schemaVersion: 1,
        checkpointVersion: 1,
        createdAt: new Date().toISOString()
      };
      await client.query(
        "insert into cp2_runtime_handoffs(entity_id, record) values ('checkpoint', $1)",
        [cp]
      );
      const transfer = {
        taskId: "task",
        accountId: "account",
        deviceId: "device",
        idempotencyKey: "key",
        sourceHandoffId: "checkpoint",
        checkpointId: "checkpoint",
        sourceHostId: "hosted",
        targetHostId: "local",
        status: "TARGET_ACTIVATING",
        expiresAt: new Date().toISOString()
      };
      await client.query(
        "insert into cp2_runtime_transfers(entity_id, record) values ('transfer', $1)",
        [transfer]
      );
      for (const [record, code] of [
        [{ ...transfer, targetHostId: "missing", taskId: "other" }, "23503"],
        [{ ...transfer, status: "ARBITRARY", taskId: "other" }, "23514"],
        [{ ...transfer, idempotencyKey: "other" }, "23505"]
      ] as const) {
        await client.query("savepoint invalid_record");
        await expect(
          client.query(
            "insert into cp2_runtime_transfers(entity_id, record) values ('invalid', $1)",
            [record]
          )
        ).rejects.toMatchObject({ code });
        await client.query("rollback to savepoint invalid_record");
      }
      await client.query(
        'update cp2_runtime_transfers set record = record || \'{"status":"FAILED","failureCode":"RESTORE_FAILED"}\'::jsonb where entity_id = \'transfer\''
      );
      await client.query(
        "insert into cp2_runtime_transfers(entity_id, record) values ('retry', $1)",
        [{ ...transfer, idempotencyKey: "retry" }]
      );
      expect(
        (await client.query("select count(*)::int as count from cp2_runtime_transfers")).rows[0]
          .count
      ).toBe(2);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  });
});
