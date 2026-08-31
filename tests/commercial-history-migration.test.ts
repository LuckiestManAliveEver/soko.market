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

const migrationSql = readFileSync("infra/db/migrations/078_commercial_history.sql", "utf8");

describe("078 commercial history migration", () => {
  it(
    "does not cast a JSON timestamp string to timestamptz inside an index expression " +
      "(regression for Postgres error 42P17: functions in index expression must be marked " +
      "IMMUTABLE - text-to-timestamptz casts are timezone-dependent, so Postgres refuses to " +
      "index them)",
    () => {
      expect(migrationSql).not.toMatch(/::timestamptz/);
    }
  );

  it(
    "backfills effectiveFrom/createdAt in the same ISO-8601 text format the app writes via " +
      "Date#toISOString, not Postgres's native now()::text format, since the commercial-records " +
      "store sorts these fields with String#localeCompare",
    () => {
      expect(migrationSql).not.toContain("now()::text");
      expect(migrationSql).toContain(
        "to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"
      );
    }
  );

  const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
  const describePostgres = databaseUrl === undefined ? describe.skip : describe;

  describePostgres("against a live Postgres instance", () => {
    it(
      "applies cleanly and builds every effective-date index (regression for the Render deploy " +
        "crash: error: functions in index expression must be marked IMMUTABLE, code 42P17)",
      async () => {
        const connectionString = databaseUrl ?? "";
        const pool = new Pool({ connectionString });
        try {
          // If migration 078 still cast a JSON timestamp string to timestamptz inside an index
          // expression, this call would reject with Postgres error 42P17 - exactly the deploy
          // crash this test guards against.
          await pool.query(migrationSql);

          const indexes = await pool.query<{ indexname: string }>(
            `
              select indexname from pg_indexes
              where schemaname = 'public'
                and indexname in (
                  'cp2_purchase_price_product_effective_idx',
                  'cp2_purchase_price_supplier_effective_idx',
                  'cp2_purchase_records_supplier_date_idx',
                  'cp2_sale_records_customer_date_idx',
                  'cp2_delivery_routes_created_idx'
                )
            `
          );
          const found = indexes.rows.map((row) => row.indexname).sort();
          expect(found).toEqual(
            [
              "cp2_delivery_routes_created_idx",
              "cp2_purchase_price_product_effective_idx",
              "cp2_purchase_price_supplier_effective_idx",
              "cp2_purchase_records_supplier_date_idx",
              "cp2_sale_records_customer_date_idx"
            ].sort()
          );
        } finally {
          await pool.end();
        }
      }
    );

    it("backfills effectiveFrom as a value new Date(...).getTime() can parse without NaN", async () => {
      const connectionString = databaseUrl ?? "";
      const pool = new Pool({ connectionString });
      try {
        const rows = await pool.query<{ effective_from: string; created_at: string }>(
          `
            select record ->> 'effectiveFrom' as effective_from, record ->> 'createdAt' as created_at
            from cp2_purchase_price_history
            where record ->> 'source' = 'LEGACY_BACKFILL'
          `
        );

        for (const row of rows.rows) {
          expect(Number.isNaN(new Date(row.effective_from).getTime())).toBe(false);
          expect(Number.isNaN(new Date(row.created_at).getTime())).toBe(false);
          expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        }
      } finally {
        await pool.end();
      }
    });
  });
});
