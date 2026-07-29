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
