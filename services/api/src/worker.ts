import { writeFile } from "node:fs/promises";
import { startAccountDeletionRunner } from "./cp2/account-deletion-runner.js";
import { readAccountDeletionProcessors } from "./cp2/account-deletion-processors.js";
import { createEmailProviderFromEnvironment } from "./cp2/email-provider.js";
import { startNotificationDeliveryRunner } from "./cp2/notification-delivery-runner.js";
import { createPostgresCp2Store } from "./cp2/postgres-store.js";
import { createWebPushSender, readWebPushConfiguration } from "./cp2/push.js";
import { createRedisHealthCheck } from "./health/redis-health.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (databaseUrl === "") throw new Error("DATABASE_URL is required by the background worker.");

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
if (redisUrl === "") throw new Error("REDIS_URL is required by the background worker.");
const redis = await createRedisHealthCheck(redisUrl)();
if (redis.status !== "ok")
  throw new Error(`Redis is unavailable: ${redis.error ?? "unknown error"}`);

const emailProvider = createEmailProviderFromEnvironment();
const webPush = readWebPushConfiguration();
const pushNotificationSender = webPush === null ? undefined : createWebPushSender(webPush);
const accountDeletionProcessors = readAccountDeletionProcessors();
const store = await createPostgresCp2Store({
  databaseUrl,
  messageEmailNotificationSender:
    emailProvider.sendEncryptedMessageNotification.bind(emailProvider),
  messageWebBaseUrl: (process.env.WEB_PUBLIC_URL ?? "https://soko.market").trim(),
  ...(pushNotificationSender === undefined ? {} : { pushNotificationSender }),
  ...(accountDeletionProcessors.length === 0 ? {} : { accountDeletionProcessors })
});

const notifications = startNotificationDeliveryRunner({
  store,
  onResult: (result) =>
    console.info(JSON.stringify({ event: "worker.notifications.completed", result })),
  onError: (error) =>
    console.error(
      JSON.stringify({
        event: "worker.notifications.failed",
        error: error instanceof Error ? error.message : String(error)
      })
    )
});
const deletions = startAccountDeletionRunner({
  store,
  onResult: (result) =>
    console.info(JSON.stringify({ event: "worker.deletions.completed", result })),
  onError: (error) =>
    console.error(
      JSON.stringify({
        event: "worker.deletions.failed",
        error: error instanceof Error ? error.message : String(error)
      })
    )
});

console.info(JSON.stringify({ event: "worker.started", redis: "ok", database: "connected" }));
const heartbeatPath = process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/soko-worker-heartbeat";
const heartbeat = () => writeFile(heartbeatPath, new Date().toISOString(), { mode: 0o600 });
await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
heartbeatTimer.unref();

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  console.info(JSON.stringify({ event: "worker.stopping", signal }));
  const forceExit = setTimeout(() => process.exit(1), 25_000);
  forceExit.unref();
  await Promise.all([notifications.stop(), deletions.stop()]);
  await store.close();
  clearTimeout(forceExit);
  console.info(JSON.stringify({ event: "worker.stopped" }));
  process.exit(0);
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
