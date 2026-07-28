import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { URL } from "node:url";
import { postgresEnvironment } from "./postgres-env.mjs";
import { deleteObject, headObject, listObjects, putObject, readR2Configuration } from "./r2-s3.mjs";

export function readBackupConfiguration(environment = process.env) {
  const databaseUrl = required(environment, "DATABASE_URL");
  const encryptionPassword = required(environment, "BACKUP_ENCRYPTION_PASSWORD");
  if (encryptionPassword.length < 20) {
    throw new Error("BACKUP_ENCRYPTION_PASSWORD must contain at least 20 characters.");
  }
  const retentionDays = Number(environment.BACKUP_RETENTION_DAYS ?? "14");
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error("BACKUP_RETENTION_DAYS must be a positive integer.");
  }
  const prefix = (environment.BACKUP_R2_PREFIX ?? "database-backups")
    .trim()
    .replace(/^\/+|\/+$/gu, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}$/u.test(prefix) || prefix.includes("..")) {
    throw new Error("BACKUP_R2_PREFIX is invalid.");
  }
  return {
    databaseUrl,
    encryptionPassword,
    retentionDays,
    prefix,
    r2: readR2Configuration(environment)
  };
}

export function backupsExpiredBefore(retentionDays, now = new Date()) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
}

async function main() {
  const configuration = readBackupConfiguration();
  const directory = await mkdtemp(join(tmpdir(), "soko-backup-"));
  const dumpPath = join(directory, "database.dump");
  const encryptedPath = `${dumpPath}.gpg`;
  const startedAt = Date.now();
  try {
    const postgres = postgresEnvironment(configuration.databaseUrl);
    await run(
      "pg_dump",
      ["--format=custom", "--compress=9", "--no-owner", "--no-acl", "--file", dumpPath],
      null,
      postgres.environment
    );
    await run(
      "gpg",
      [
        "--batch",
        "--yes",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "0",
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--compress-algo",
        "none",
        "--output",
        encryptedPath,
        dumpPath
      ],
      `${configuration.encryptionPassword}\n`
    );
    const bytes = await readFile(encryptedPath);
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/gu, "-");
    const databaseName = safeDatabaseName(configuration.databaseUrl);
    const key = `${configuration.prefix}/${now.getUTCFullYear()}/${String(
      now.getUTCMonth() + 1
    ).padStart(2, "0")}/${timestamp}-${databaseName}.dump.gpg`;
    await putObject(configuration.r2, key, bytes, "application/pgp-encrypted");
    const remote = await headObject(configuration.r2, key);
    const local = await stat(encryptedPath);
    if (remote.sizeBytes !== local.size) {
      throw new Error("Uploaded backup size does not match the encrypted local archive.");
    }
    const expiredBefore = backupsExpiredBefore(configuration.retentionDays, now);
    const backups = await listObjects(configuration.r2, `${configuration.prefix}/`);
    let deleted = 0;
    for (const backup of backups) {
      if (
        backup.key.endsWith(".dump.gpg") &&
        Number.isFinite(backup.lastModified.getTime()) &&
        backup.lastModified < expiredBefore
      ) {
        await deleteObject(configuration.r2, backup.key);
        deleted += 1;
      }
    }
    console.info(
      JSON.stringify({
        event: "backup.completed",
        key,
        encryptedSizeBytes: local.size,
        retentionDeleted: deleted,
        durationMs: Date.now() - startedAt
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "backup.failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt
      })
    );
    process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function run(command, arguments_, stdin = null, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: environment,
      stdio: [stdin === null ? "ignore" : "pipe", "inherit", "inherit"]
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${basename(command)} exited with ${code ?? signal ?? "unknown"}.`));
    });
    if (stdin !== null) child.stdin.end(stdin);
  });
}

function safeDatabaseName(databaseUrl) {
  const name = postgresEnvironment(databaseUrl).database;
  return name.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 63) || "postgres";
}

function required(environment, name) {
  const value = environment[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} is required.`);
  return value;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await main();
}
