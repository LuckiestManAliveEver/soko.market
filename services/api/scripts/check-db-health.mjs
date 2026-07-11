import { Pool } from "pg";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to check database health.");
  process.exit(1);
}

const pool = new Pool(poolConfig(databaseUrl));
const startedAt = Date.now();

try {
  const result = await pool.query(`
    select
      now() as checked_at,
      current_database() as database_name,
      current_user as database_user,
      (
        select count(*)
        from soko_schema_migrations
      )::integer as applied_migration_count,
      (
        select filename
        from soko_schema_migrations
        order by filename desc
        limit 1
      ) as latest_migration
  `);
  const latencyMs = Date.now() - startedAt;
  const latestMigration = result.rows[0]?.latest_migration ?? null;

  await pool.query(
    `
      insert into database_health_checks (status, latency_ms, latest_migration, checked_at)
      values ('ok', $1, $2, now())
    `,
    [latencyMs, latestMigration]
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        latencyMs,
        ...result.rows[0]
      },
      null,
      2
    )
  );
} catch (error) {
  const latencyMs = Date.now() - startedAt;
  const message = error instanceof Error ? error.message : String(error);

  await pool
    .query(
      `
        insert into database_health_checks (status, latency_ms, checked_at, error_message)
        values ('failed', $1, now(), $2)
      `,
      [latencyMs, message]
    )
    .catch(() => undefined);

  console.error(message);
  process.exitCode = 1;
} finally {
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
    idleTimeoutMillis: numberFromEnv("DB_IDLE_TIMEOUT_MS", 30000),
    max: numberFromEnv("DB_POOL_MAX", 2),
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
