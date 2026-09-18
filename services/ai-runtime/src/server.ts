import { createInferenceServer } from "./http-server.js";
import {
  createVercelHealthHandler,
  createVercelInferenceHandler,
  createVercelReadyHandler,
  readVercelInferenceConfig,
  validBearer
} from "./vercel-handler.js";

const config = readVercelInferenceConfig();
const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");

const server = createInferenceServer({
  inference: createVercelInferenceHandler(config),
  authorize: (header) => validBearer(header, config.serviceToken),
  health: createVercelHealthHandler(),
  ready: createVercelReadyHandler(),
  maximumBodyBytes: config.maximumInputCharacters * 4 + 8_192
});
server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "inference.listening", port }));
});

function shutdown() {
  server.close(() => process.exit(0));
  // Let an active stream finish; enforce a bound if a native operation does not return.
  setTimeout(() => process.exit(1), 25_000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
