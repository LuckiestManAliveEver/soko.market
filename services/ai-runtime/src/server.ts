import { buildAiRuntime } from "./app.js";
import { readInferenceServiceConfig } from "./runtime-config.js";

const config = readInferenceServiceConfig();
const app = buildAiRuntime({ config });

try {
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "AI runtime graceful shutdown started.");
  const forceExit = setTimeout(() => process.exit(1), 25_000);
  forceExit.unref();
  try {
    await app.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, "AI runtime graceful shutdown failed.");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
