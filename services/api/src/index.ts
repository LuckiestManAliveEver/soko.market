import { buildApi } from "./app.js";
import { readEnvironment } from "./config.js";

const config = readEnvironment();
const app = buildApi({
  allowedCorsOrigins: config.allowedCorsOrigins
});

try {
  await app.listen({
    host: config.apiHost,
    port: config.apiPort
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
