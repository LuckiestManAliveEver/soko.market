import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const backupFile = process.env.DB_BACKUP_FILE;
const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (backupFile === undefined || backupFile.trim() === "" || !existsSync(backupFile)) {
  console.error("DB_BACKUP_FILE must point to an existing pg_dump custom-format backup.");
  process.exit(1);
}

const child = spawn("pg_restore", ["--list", backupFile], {
  stdio: "inherit"
});

child.on("exit", async (code) => {
  await recordRestoreDrill(code === 0 ? "verified" : "failed").catch(() => undefined);

  if (code === 0) {
    console.log(`Backup verified: ${backupFile}`);
  }

  process.exit(code ?? 1);
});

async function recordRestoreDrill(status) {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    return;
  }

  const pool = new Pool(poolConfig(databaseUrl));

  try {
    await pool.query(
      `
        insert into database_restore_drills (id, backup_file, status, checked_at)
        values ($1, $2, $3, now())
      `,
      [randomUUID(), backupFile, status]
    );
  } finally {
    await pool.end();
  }
}

function poolConfig(connectionString) {
  connectionString = normalizeDatabaseSslMode(connectionString);
  const sslRequired =
    !/[?&]sslmode=/i.test(connectionString) &&
    (connectionString.includes(".neon.tech") || connectionString.includes(".neon.database"));

  return {
    connectionString,
    max: 1,
    ...(sslRequired ? { ssl: true } : {})
  };
}

function normalizeDatabaseSslMode(connectionString) {
  return connectionString.replace(
    /([?&])sslmode=(?:prefer|require|verify-ca)(?=&|$)/gi,
    "$1sslmode=verify-full"
  );
}
