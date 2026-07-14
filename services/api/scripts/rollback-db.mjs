import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Pool } from "pg";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const rollbacksDir = resolve(rootDir, "infra/db/rollbacks");
const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const rollbackEnabled = process.env.ALLOW_DB_ROLLBACK?.trim().toLowerCase() === "true";
const requestedSteps = Number(process.env.DB_ROLLBACK_STEPS ?? "0");

if (!rollbackEnabled) {
  console.error("Set ALLOW_DB_ROLLBACK=true to run rollback SQL.");
  process.exit(1);
}

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error(
    "DATABASE_URL or DIRECT_DATABASE_URL is required to roll back database migrations."
  );
  process.exit(1);
}

if (!Number.isInteger(requestedSteps) || requestedSteps <= 0) {
  console.error("DB_ROLLBACK_STEPS must be a positive integer.");
  process.exit(1);
}

const pool = new Pool(poolConfig(databaseUrl));

try {
  await withAdvisoryLock(async () => {
    const appliedResult = await pool.query(
      `
        select filename
        from soko_schema_migrations
        order by filename desc
        limit $1
      `,
      [requestedSteps]
    );

    if (appliedResult.rows.length !== requestedSteps) {
      throw new Error(
        `Requested ${requestedSteps} rollback step(s), but only found ${appliedResult.rows.length} applied migration(s).`
      );
    }

    for (const row of appliedResult.rows) {
      const filename = row.filename;
      const rollbackFilename = filename.replace(/\.sql$/, ".down.sql");
      const rollbackPath = resolve(rollbacksDir, rollbackFilename);
      const sql = await readFile(rollbackPath, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("delete from soko_schema_migrations where filename = $1", [filename]);
        await client.query(
          `
            insert into soko_schema_rollbacks (filename, rollback_filename, rollback_checksum, rolled_back_at)
            values ($1, $2, $3, now())
          `,
          [filename, rollbackFilename, checksum]
        );
        await client.query("commit");
        console.log(`Rolled back migration ${filename} using ${rollbackFilename}`);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  });
} finally {
  await pool.end();
}

async function withAdvisoryLock(callback) {
  const client = await pool.connect();

  try {
    await client.query("select pg_advisory_lock(hashtext('soko.schema_migrations'))");
    await client.query(`
      create table if not exists soko_schema_rollbacks (
        id bigserial primary key,
        filename text not null,
        rollback_filename text not null,
        rollback_checksum text not null,
        rolled_back_at timestamp with time zone not null
      )
    `);
    return await callback();
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext('soko.schema_migrations'))")
      .catch(() => undefined);
    client.release();
  }
}

function poolConfig(connectionString) {
  connectionString = normalizeDatabaseSslMode(connectionString);
  const sslRequired =
    !/[?&]sslmode=/i.test(connectionString) &&
    (connectionString.includes(".neon.tech") || connectionString.includes(".neon.database"));

  return {
    connectionString,
    max: 2,
    ...(sslRequired ? { ssl: true } : {})
  };
}

function normalizeDatabaseSslMode(connectionString) {
  return connectionString.replace(
    /([?&])sslmode=(?:prefer|require|verify-ca)(?=&|$)/gi,
    "$1sslmode=verify-full"
  );
}
