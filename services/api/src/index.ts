import { createLlamaCppRuntimeModelProvider } from "@soko/ai-runtime";
import { buildApi } from "./app.js";
import { readEnvironment } from "./config.js";
import { createPostgresCp2Store } from "./cp2/postgres-store.js";
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
const cp2StoreMode = process.env.CP2_STORE?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

if (process.env.NODE_ENV === "production" && cp2StoreMode !== "memory" && databaseUrl === "") {
  throw new Error("DATABASE_URL is required in production unless CP2_STORE=memory is explicit.");
}

const shouldUsePostgresStore =
  cp2StoreMode === "postgres" || (cp2StoreMode !== "memory" && databaseUrl !== "");
const cp2StoreOptions =
  runtimeModelProvider === undefined
    ? {}
    : {
        runtimeModelProvider
      };
const cp2Store = shouldUsePostgresStore
  ? await createPostgresCp2Store({
      databaseUrl: config.databaseUrl,
      ...cp2StoreOptions
    })
  : createCp2Store(cp2StoreOptions);
const app = buildApi({
  allowedCorsOrigins: config.allowedCorsOrigins,
  cp2: {
    store: cp2Store
  }
});

if (isClosableStore(cp2Store)) {
  app.addHook("onClose", async () => {
    await cp2Store.close();
  });
}

try {
  await app.listen({
    host: config.apiHost,
    port: config.apiPort
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function isClosableStore(store: unknown): store is { close: () => Promise<void> } {
  return typeof (store as { close?: unknown }).close === "function";
}
