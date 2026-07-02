import { buildAiRuntime } from "./app.js";

const port = Number(process.env.AI_RUNTIME_PORT ?? 4002);
const app = buildAiRuntime();

try {
  await app.listen({
    host: process.env.AI_RUNTIME_HOST ?? "127.0.0.1",
    port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
