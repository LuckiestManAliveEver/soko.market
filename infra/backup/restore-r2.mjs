import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { postgresEnvironment } from "./postgres-env.mjs";
import { getObject, readR2Configuration } from "./r2-s3.mjs";

const key = process.env.RESTORE_OBJECT_KEY?.trim() ?? "";
const databaseUrl = process.env.RESTORE_DATABASE_URL?.trim() ?? "";
const password = process.env.BACKUP_ENCRYPTION_PASSWORD?.trim() ?? "";
if (key === "" || !key.endsWith(".dump.gpg")) {
  throw new Error("RESTORE_OBJECT_KEY must select an encrypted .dump.gpg object.");
}
if (databaseUrl === "") throw new Error("RESTORE_DATABASE_URL is required.");
if (password === "") throw new Error("BACKUP_ENCRYPTION_PASSWORD is required.");
const postgres = postgresEnvironment(databaseUrl);
const databaseName = postgres.database;
if (process.env.RESTORE_CONFIRM !== `RESTORE ${databaseName}`) {
  throw new Error(`Set RESTORE_CONFIRM='RESTORE ${databaseName}' to authorize this restore.`);
}

const directory = await mkdtemp(join(tmpdir(), "soko-restore-"));
const encryptedPath = join(directory, "database.dump.gpg");
const dumpPath = join(directory, "database.dump");
try {
  const encrypted = await getObject(readR2Configuration(), key);
  await writeFile(encryptedPath, encrypted, { mode: 0o600 });
  await run(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--decrypt",
      "--output",
      dumpPath,
      encryptedPath
    ],
    `${password}\n`
  );
  await run("pg_restore", ["--list", dumpPath]);
  const overwrite = process.env.RESTORE_OVERWRITE === "true";
  await run(
    "pg_restore",
    [
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      ...(overwrite ? ["--clean", "--if-exists"] : []),
      dumpPath
    ],
    null,
    postgres.environment
  );
  console.info(
    JSON.stringify({
      event: "restore.completed",
      key,
      database: databaseName,
      overwrite
    })
  );
} finally {
  await rm(directory, { recursive: true, force: true });
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
