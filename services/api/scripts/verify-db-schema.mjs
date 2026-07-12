import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const migrationFilenames = ["018_cp21_account_sync_changes.sql", "019_cp23_mcp_access_tokens.sql"];

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to verify the database schema.");
  process.exit(1);
}

const expectedTables = new Map([
  [
    "account_sync_changes",
    [
      "account_id",
      "sequence",
      "cursor",
      "collection",
      "entity_id",
      "operation",
      "shop_id",
      "entity",
      "changed_at",
      "tombstone_expires_at"
    ]
  ],
  [
    "mcp_access_tokens",
    [
      "id",
      "account_id",
      "user_id",
      "session_id",
      "token_hash",
      "name",
      "scopes",
      "shop_id",
      "created_at",
      "expires_at",
      "last_used_at",
      "revoked_at"
    ]
  ]
]);
const expectedMigrations = new Map(
  await Promise.all(
    migrationFilenames.map(async (filename) => {
      const sql = await readFile(resolve(rootDir, "infra/db/migrations", filename), "utf8");
      return [filename, createHash("sha256").update(sql).digest("hex")];
    })
  )
);
const pool = new Pool(poolConfig(databaseUrl));
const client = await pool.connect();

try {
  await client.query("begin transaction read only");
  const connection = await client.query(`
    select current_database() as database_name, current_user as database_user
  `);
  for (const [filename, expectedChecksum] of expectedMigrations) {
    const migration = await client.query(
      `select checksum from soko_schema_migrations where filename = $1`,
      [filename]
    );
    if (migration.rows[0]?.checksum !== expectedChecksum) {
      throw new Error(`${filename} is missing or its recorded checksum does not match.`);
    }
  }

  for (const [tableName, expectedColumns] of expectedTables) {
    const columns = await client.query(
      `
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = $1
      `,
      [tableName]
    );
    const actualColumns = new Set(columns.rows.map((row) => row.column_name));
    const missingColumns = expectedColumns.filter((column) => !actualColumns.has(column));
    if (missingColumns.length > 0) {
      throw new Error(`${tableName} is missing columns: ${missingColumns.join(", ")}`);
    }

    const constraints = await client.query(
      `
        select constraint_type
        from information_schema.table_constraints
        where table_schema = 'public' and table_name = $1
      `,
      [tableName]
    );
    const constraintTypes = new Set(constraints.rows.map((row) => row.constraint_type));
    for (const requiredType of ["PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK"]) {
      if (!constraintTypes.has(requiredType)) {
        throw new Error(`${tableName} is missing a ${requiredType} constraint.`);
      }
    }
  }

  await client.query("commit");
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "read-only",
        migrations: migrationFilenames,
        databaseName: connection.rows[0]?.database_name,
        databaseUser: connection.rows[0]?.database_user
      },
      null,
      2
    )
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

function poolConfig(connectionString) {
  const sslRequired =
    connectionString.includes("sslmode=require") ||
    connectionString.includes(".neon.tech") ||
    connectionString.includes(".neon.database");

  return {
    connectionString,
    connectionTimeoutMillis: numberFromEnv("DB_CONNECTION_TIMEOUT_MS", 5000),
    max: 1,
    query_timeout: numberFromEnv("DB_QUERY_TIMEOUT_MS", 15000),
    statement_timeout: numberFromEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
    ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {})
  };
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
