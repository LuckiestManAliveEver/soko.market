import { buildAiRuntime } from "./app.js";
import { readInferenceServiceConfig } from "./runtime-config.js";
import { createRateLimitRedisClient } from "./redis-client.js";

const config = readInferenceServiceConfig();
const rateLimitRedisClient = createRateLimitRedisClient(config.redisUrl);
const app = buildAiRuntime({ config, rateLimitRedisClient });

app.addHook("onClose", async () => {
  rateLimitRedisClient.disconnect();
});

try {
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
