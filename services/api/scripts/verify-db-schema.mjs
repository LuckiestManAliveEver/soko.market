import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";
import {
  databasePoolConfig,
  isAcceptedMigrationChecksum,
  readDatabaseUrl
} from "./database-connection.mjs";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const databaseUrl = readDatabaseUrl();
const migrationsDir = resolve(rootDir, "infra/db/migrations");
const migrationFilenames = (await readdir(migrationsDir))
  .filter((filename) => filename.endsWith(".sql"))
  .sort();

if (databaseUrl === null) {
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
      "created_by_session_id",
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
      const sql = await readFile(resolve(migrationsDir, filename), "utf8");
      return [filename, createHash("sha256").update(sql).digest("hex")];
    })
  )
);
const pool = new Pool(
  databasePoolConfig(databaseUrl, {
    applicationName: "soko-market-verify-schema",
    max: 1
  })
);
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
    if (!isAcceptedMigrationChecksum(filename, migration.rows[0]?.checksum, expectedChecksum)) {
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

  const invalidConstraints = await client.query(
    `
      select conrelid::regclass::text as table_name, conname
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and not convalidated
      order by conrelid::regclass::text, conname
    `
  );
  if (invalidConstraints.rows.length > 0) {
    throw new Error(
      `Unvalidated constraints remain: ${invalidConstraints.rows
        .map((row) => `${row.table_name}.${row.conname}`)
        .join(", ")}`
    );
  }

  const invalidIndexes = await client.query(
    `
      select indexrelid::regclass::text as index_name
      from pg_index
      where indrelid in (
        select oid from pg_class where relnamespace = 'public'::regnamespace
      )
        and (not indisvalid or not indisready)
      order by indexrelid::regclass::text
    `
  );
  if (invalidIndexes.rows.length > 0) {
    throw new Error(
      `Invalid indexes remain: ${invalidIndexes.rows.map((row) => row.index_name).join(", ")}`
    );
  }

  const duplicateIndexes = await client.query(
    `
      select first_index::regclass::text as first_index,
             second_index::regclass::text as second_index
      from (
        select i1.indexrelid as first_index, i2.indexrelid as second_index
        from pg_index i1
        join pg_index i2
          on i1.indrelid = i2.indrelid
         and i1.indexrelid < i2.indexrelid
         and i1.indkey = i2.indkey
         and i1.indclass = i2.indclass
         and i1.indcollation = i2.indcollation
         and i1.indoption = i2.indoption
         and i1.indexprs is not distinct from i2.indexprs
         and i1.indpred is not distinct from i2.indpred
        join pg_class table_class on table_class.oid = i1.indrelid
        where table_class.relnamespace = 'public'::regnamespace
      ) duplicates
      order by first_index::regclass::text, second_index::regclass::text
    `
  );
  if (duplicateIndexes.rows.length > 0) {
    throw new Error(
      `Duplicate indexes remain: ${duplicateIndexes.rows
        .map((row) => `${row.first_index}/${row.second_index}`)
        .join(", ")}`
    );
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
