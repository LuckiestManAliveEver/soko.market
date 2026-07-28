import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { nextScheduledRun, parseDailySchedule } from "./schedule.mjs";

const schedule = parseDailySchedule(process.env.BACKUP_SCHEDULE ?? "17 2 * * *");
let stopped = false;
let timer;
let activeChild = null;
const heartbeatPath = process.env.BACKUP_HEARTBEAT_PATH ?? "/tmp/soko-backups/scheduler-heartbeat";
const heartbeat = () => writeFile(heartbeatPath, new Date().toISOString(), { mode: 0o600 });
await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
heartbeatTimer.unref();

const stop = () => {
  stopped = true;
  clearInterval(heartbeatTimer);
  if (timer !== undefined) clearTimeout(timer);
  activeChild?.kill("SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

if (process.env.BACKUP_RUN_ON_START === "true") {
  await runBackup();
}
while (!stopped) {
  const now = new Date();
  const next = nextScheduledRun(schedule, now);
  console.info(JSON.stringify({ event: "backup.scheduled", nextRunAt: next.toISOString() }));
  await wait(next.getTime() - now.getTime());
  if (!stopped) await runBackup();
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
}

function runBackup() {
  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, ["backup-r2.mjs"], { stdio: "inherit" });
    activeChild.once("error", reject);
    activeChild.once("exit", (code, signal) => {
      activeChild = null;
      if (code === 0) resolve();
      else reject(new Error(`Backup process exited with ${code ?? signal ?? "unknown"}.`));
    });
  });
}
