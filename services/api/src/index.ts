import { createLlamaCppRuntimeModelProvider } from "@soko/ai-runtime";
import { buildApi } from "./app.js";
import { readEnvironment } from "./config.js";
import { createCp2Store } from "./cp2/store.js";

const config = readEnvironment();
const runtimeModelProvider = config.localModelEnabled
  ? createLlamaCppRuntimeModelProvider({
      endpoint: config.localModelEndpoint,
      maxTokens: config.localModelMaxTokens,
      modelProfile: config.localModelProfile,
      temperature: config.localModelTemperature,
      timeoutMs: config.localModelTimeoutMs
    })
  : undefined;
const apiOptions =
  runtimeModelProvider === undefined
    ? {
        allowedCorsOrigins: config.allowedCorsOrigins
      }
    : {
        allowedCorsOrigins: config.allowedCorsOrigins,
        cp2: {
          store: createCp2Store({
            runtimeModelProvider
          })
        }
      };
const app = buildApi(apiOptions);

try {
  await app.listen({
    host: config.apiHost,
    port: config.apiPort
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
