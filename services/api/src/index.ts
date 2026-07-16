import { createLlamaCppRuntimeModelProvider } from "@soko/ai-runtime";
import { buildApi } from "./app.js";
import { readEnvironment } from "./config.js";
import {
  startAccountDeletionRunner,
  type AccountDeletionRunner
} from "./cp2/account-deletion-runner.js";
import { readAccountDeletionProcessors } from "./cp2/account-deletion-processors.js";
import { createPostgresCp2Store } from "./cp2/postgres-store.js";
import { createCp2Store } from "./cp2/store.js";
import { createWebPushSender, readWebPushConfiguration } from "./cp2/push.js";

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
const webPushConfiguration = readWebPushConfiguration();
const pushNotificationSender =
  webPushConfiguration === null ? undefined : createWebPushSender(webPushConfiguration);
const accountDeletionProcessors = readAccountDeletionProcessors();

if (process.env.NODE_ENV === "production" && cp2StoreMode !== "memory" && databaseUrl === "") {
  throw new Error("DATABASE_URL is required in production unless CP2_STORE=memory is explicit.");
}

const shouldUsePostgresStore =
  cp2StoreMode === "postgres" || (cp2StoreMode !== "memory" && databaseUrl !== "");
const cp2StoreOptions = {
  ...(runtimeModelProvider === undefined ? {} : { runtimeModelProvider }),
  ...(pushNotificationSender === undefined ? {} : { pushNotificationSender }),
  ...(accountDeletionProcessors.length === 0 ? {} : { accountDeletionProcessors })
};

const cp2Store = shouldUsePostgresStore
  ? await createPostgresCp2Store({
      databaseUrl: config.databaseUrl,
      ...cp2StoreOptions
    })
  : createCp2Store(cp2StoreOptions);
const apiOptions = {
  allowedCorsOrigins: config.allowedCorsOrigins,
  cp2: {
    store: cp2Store,
    ...(webPushConfiguration === null ? {} : { vapidPublicKey: webPushConfiguration.publicKey })
  }
};
const app = buildApi(
  isHealthyStore(cp2Store)
    ? {
        ...apiOptions,
        databaseHealth: () => cp2Store.health()
      }
    : apiOptions
);

let accountDeletionRunner: AccountDeletionRunner | null = null;
app.addHook("onClose", async () => {
  await accountDeletionRunner?.stop();
  if (isClosableStore(cp2Store)) {
    await cp2Store.close();
  }
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

if (accountDeletionProcessors.length > 0 && process.env.ENABLE_ACCOUNT_DELETION_RUNNER === "true") {
  accountDeletionRunner = startAccountDeletionRunner({
    store: cp2Store,
    onResult: (result) => app.log.info({ result }, "Account deletion purge completed."),
    onError: (error) => app.log.error({ error }, "Account deletion purge failed.")
  });
} else if (process.env.ENABLE_ACCOUNT_DELETION_RUNNER === "true") {
  app.log.warn(
    "Account deletion runner is enabled but no deletion processors are configured; runner not started."
  );
}

function isClosableStore(store: unknown): store is { close: () => Promise<void> } {
  return typeof (store as { close?: unknown }).close === "function";
}

function isHealthyStore(
  store: unknown
): store is { health: () => Promise<Record<string, unknown>> } {
  return typeof (store as { health?: unknown }).health === "function";
}
