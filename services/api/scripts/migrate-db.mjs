import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const migrationsDir = resolve(rootDir, "infra/db/migrations");
const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
// Migration 014 originally copied orphaned compatibility PINs without resolving
// their account. Databases that completed that safe subset may retain its exact
// historical checksum; all other checksum drift still fails closed.
const legacyMigrationChecksums = new Map([
  [
    "014_cp2_phase1_auth_security_relational.sql",
    new Set(["bd441b79fc96f268acba7a251cb12d688a61b98b5d608809924ede780d84282a"])
  ]
]);

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to run database migrations.");
  process.exit(1);
}

const pool = new Pool(poolConfig(databaseUrl));

try {
  await ensureMigrationTable();
  const migrations = await listMigrations();

  await withAdvisoryLock(async () => {
    for (const migration of migrations) {
      const alreadyApplied = await pool.query(
        "select checksum from soko_schema_migrations where filename = $1",
        [migration.filename]
      );

      if (alreadyApplied.rows.length > 0) {
        const appliedChecksum = alreadyApplied.rows[0]?.checksum;

        if (!isAcceptedChecksum(migration.filename, appliedChecksum, migration.checksum)) {
          throw new Error(
            `Migration checksum mismatch for ${migration.filename}. Refusing to continue.`
          );
        }

        continue;
      }

      const startedAt = Date.now();
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query(migration.sql);
        await client.query(
          `
            insert into soko_schema_migrations (filename, checksum, applied_at, duration_ms)
            values ($1, $2, now(), $3)
          `,
          [migration.filename, migration.checksum, Date.now() - startedAt]
        );
        await client.query("commit");
        console.log(`Applied migration ${migration.filename}`);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${migration.filename} failed: ${detail}`, { cause: error });
      } finally {
        client.release();
      }
    }
  });

  console.log("Database migrations are up to date.");
} finally {
  await pool.end();
}

function isAcceptedChecksum(filename, appliedChecksum, currentChecksum) {
  return (
    appliedChecksum === currentChecksum ||
    legacyMigrationChecksums.get(filename)?.has(appliedChecksum) === true
  );
}

async function ensureMigrationTable() {
  await pool.query(`
    create table if not exists soko_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamp with time zone not null,
      duration_ms integer not null
    )
  `);
}

async function withAdvisoryLock(callback) {
  const client = await pool.connect();

  try {
    await client.query("select pg_advisory_lock(hashtext('soko.schema_migrations'))");
    return await callback();
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext('soko.schema_migrations'))")
      .catch(() => undefined);
    client.release();
  }
}

async function listMigrations() {
  const entries = await readdir(migrationsDir);
  const filenames = entries.filter((entry) => entry.endsWith(".sql")).sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(resolve(migrationsDir, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");

      return {
        checksum,
        filename,
        sql
      };
    })
  );
}

function poolConfig(connectionString) {
  const sslRequired =
    connectionString.includes("sslmode=require") ||
    connectionString.includes(".neon.tech") ||
    connectionString.includes(".neon.database");

  return {
    connectionString,
    max: 2,
    ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {})
  };
}
