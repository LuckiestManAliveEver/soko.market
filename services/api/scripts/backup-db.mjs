import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const backupDir = resolve(rootDir, "backups");
const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to create a database backup.");
  process.exit(1);
}

await mkdir(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = resolve(backupDir, `soko-market-${stamp}.dump`);
const child = spawn(
  "pg_dump",
  ["--format=custom", "--no-owner", "--file", outputPath, databaseUrl],
  {
    stdio: "inherit"
  }
);

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`Database backup written to ${outputPath}`);
  }

  process.exit(code ?? 1);
});
