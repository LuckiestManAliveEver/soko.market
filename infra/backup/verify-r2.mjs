import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getObject, readR2Configuration } from "./r2-s3.mjs";

const key = process.env.RESTORE_OBJECT_KEY?.trim() ?? "";
const password = process.env.BACKUP_ENCRYPTION_PASSWORD?.trim() ?? "";
if (key === "" || password === "") {
  throw new Error("RESTORE_OBJECT_KEY and BACKUP_ENCRYPTION_PASSWORD are required.");
}
const directory = await mkdtemp(join(tmpdir(), "soko-verify-"));
const encryptedPath = join(directory, "database.dump.gpg");
const dumpPath = join(directory, "database.dump");
try {
  await writeFile(encryptedPath, await getObject(readR2Configuration(), key), { mode: 0o600 });
  await run("gpg", [
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
  ]);
  await run("pg_restore", ["--list", dumpPath], null);
  console.info(JSON.stringify({ event: "backup.verification_completed", key }));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function run(command, arguments_, stdin = `${password}\n`) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: [stdin === null ? "ignore" : "pipe", "ignore", "inherit"]
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`))
    );
    if (stdin !== null) child.stdin.end(stdin);
  });
}
