import { buildSyncService } from "./app.js";

const port = Number(process.env.SYNC_PORT ?? 4001);
const app = buildSyncService();

try {
  await app.listen({
    host: process.env.SYNC_HOST ?? "127.0.0.1",
    port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
