import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface TestPool {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

const requireApiDependency = createRequire(resolve(process.cwd(), "services/api/package.json"));
const { Pool } = requireApiDependency("pg") as {
  Pool: new (options: { connectionString: string }) => TestPool;
};

const migrationSql = readFileSync("infra/db/migrations/083_runtime_handoff_protocol.sql", "utf8");

describe("083 runtime handoff protocol migration", () => {
  it(
    "indexes the createdAt JSON field directly rather than a non-existent created_at column " +
      '(regression for Postgres error 42703: column "created_at" does not exist - the table ' +
      "definition only ever generated task_id/updated_at, never a plain created_at column, so " +
      "the original index definition failed at deploy time)",
    () => {
      expect(migrationSql).toContain(
        "on cp2_runtime_handoffs (task_id, (record ->> 'createdAt') desc);"
      );
      expect(migrationSql).not.toMatch(/\btask_id,\s*created_at desc/);
    }
  );

  it(
    "does not cast the JSON createdAt string to timestamp with time zone inside a generated " +
      "column (text-to-timestamptz casts are STABLE, not IMMUTABLE, in Postgres - a generated " +
      "column requires an immutable expression, so this pattern fails with 'generation " +
      "expression is not immutable' the same way 078_commercial_history.sql already avoids " +
      "casting to ::timestamptz inside an index expression)",
    () => {
      expect(migrationSql).not.toMatch(/generated always as[\s\S]{0,80}::timestamp with time zone/);
    }
  );

  it("requires createdAt to be present on every handoff record", () => {
    expect(migrationSql).toContain("and record ->> 'createdAt' is not null");
  });

  const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
  const describePostgres = databaseUrl === undefined ? describe.skip : describe;

  describePostgres("against a live Postgres instance", () => {
    it(
      "applies cleanly and builds the task/created_at index (regression for the Render deploy " +
        'crash: error: column "created_at" does not exist, code 42703)',
      async () => {
        const connectionString = databaseUrl ?? "";
        const pool = new Pool({ connectionString });
        try {
          // If migration 083 still referenced a non-existent created_at column in its index,
          // this call would reject with Postgres error 42703 - exactly the deploy crash this
          // test guards against.
          await pool.query(migrationSql);

          const indexes = await pool.query<{ indexname: string }>(
            `
              select indexname from pg_indexes
              where schemaname = 'public'
                and tablename = 'cp2_runtime_handoffs'
                and indexname = 'cp2_runtime_handoffs_task_created_idx'
            `
          );
          expect(indexes.rows.map((row) => row.indexname)).toEqual([
            "cp2_runtime_handoffs_task_created_idx"
          ]);
        } finally {
          await pool.end();
        }
      }
    );

    it("rejects a handoff record with no createdAt", async () => {
      const connectionString = databaseUrl ?? "";
      const pool = new Pool({ connectionString });
      try {
        await pool.query(migrationSql);

        await expect(
          pool.query(
            `
              insert into cp2_runtime_handoffs (entity_id, record)
              values (
                'test-missing-created-at',
                jsonb_build_object(
                  'taskId', 'task-1',
                  'conversationId', 'conversation-1',
                  'goal', 'goal',
                  'currentState', 'state',
                  'schemaVersion', 1,
                  'runtime', jsonb_build_object(
                    'agentId', 'agent-1',
                    'modelId', 'model-1',
                    'executionHostId', 'host-1'
                  )
                )
              )
            `
          )
        ).rejects.toThrow(/cp2_runtime_handoffs_record_check/);
      } finally {
        await pool.end();
      }
    });
  });
});
