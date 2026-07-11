import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const restoreFile = process.env.DB_RESTORE_FILE;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to restore a database backup.");
  process.exit(1);
}

if (restoreFile === undefined || restoreFile.trim() === "" || !existsSync(restoreFile)) {
  console.error("DB_RESTORE_FILE must point to an existing pg_dump custom-format backup.");
  process.exit(1);
}

const child = spawn(
  "pg_restore",
  ["--clean", "--if-exists", "--no-owner", "--dbname", databaseUrl, restoreFile],
  {
    stdio: "inherit"
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
