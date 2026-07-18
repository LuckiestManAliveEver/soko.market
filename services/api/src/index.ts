import {
  createLlamaCppRuntimeModelProvider,
  createOpenAiRuntimeModelProvider
} from "@soko/ai-runtime";
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
import { createEmailProviderFromEnvironment } from "./cp2/email-provider.js";
import { createReceiptOCRProcessorFromEnvironment } from "./cp2/receipt-ocr-provider.js";
import { createNetworkInviteSenderFromEnvironment } from "./cp2/network-invite-provider.js";
import {
  startNotificationDeliveryRunner,
  type NotificationDeliveryRunner
} from "./cp2/notification-delivery-runner.js";
import { createBinaryUploadPipelineFromEnvironment } from "./cp2/binary-upload-pipeline.js";

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
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const openAiFastProvider =
  openAiApiKey.length === 0
    ? undefined
    : createOpenAiRuntimeModelProvider({
        apiKey: openAiApiKey,
        model: process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5-mini",
        maxOutputTokens: 256,
        reasoningEffort: "minimal",
        timeoutMs: 15_000
      });
const openAiReasoningProvider =
  openAiApiKey.length === 0
    ? undefined
    : createOpenAiRuntimeModelProvider({
        apiKey: openAiApiKey,
        model: process.env.OPENAI_REASONING_MODEL?.trim() || "gpt-5.2",
        maxOutputTokens: 512,
        reasoningEffort: "medium",
        timeoutMs: 30_000
      });
const runtimeModelProviderResolver = (modelId: string) => {
  if (modelId === "openai-fast") return openAiFastProvider;
  if (modelId === "openai-reasoning") return openAiReasoningProvider;
  return runtimeModelProvider;
};
const cp2StoreMode = process.env.CP2_STORE?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const webPushConfiguration = readWebPushConfiguration();
const pushNotificationSender =
  webPushConfiguration === null ? undefined : createWebPushSender(webPushConfiguration);
const emailProvider = createEmailProviderFromEnvironment();
const messageWebBaseUrl = (process.env.WEB_PUBLIC_URL ?? "https://soko.market").trim();
const accountDeletionProcessors = readAccountDeletionProcessors();
const receiptOCRProcessor = createReceiptOCRProcessorFromEnvironment();
const networkInviteSender = createNetworkInviteSenderFromEnvironment();
const binaryUploadPipeline = createBinaryUploadPipelineFromEnvironment();

if (process.env.NODE_ENV === "production" && cp2StoreMode !== "memory" && databaseUrl === "") {
  throw new Error("DATABASE_URL is required in production unless CP2_STORE=memory is explicit.");
}

const shouldUsePostgresStore =
  cp2StoreMode === "postgres" || (cp2StoreMode !== "memory" && databaseUrl !== "");
const cp2StoreOptions = {
  ...(runtimeModelProvider === undefined ? {} : { runtimeModelProvider }),
  runtimeModelProviderResolver,
  ...(pushNotificationSender === undefined ? {} : { pushNotificationSender }),
  messageEmailNotificationSender:
    emailProvider.sendEncryptedMessageNotification.bind(emailProvider),
  ...(networkInviteSender === undefined ? {} : { networkInviteSender }),
  messageWebBaseUrl,
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
    emailProvider,
    ...(binaryUploadPipeline === undefined ? {} : { binaryUploadPipeline }),
    ...(receiptOCRProcessor === undefined ? {} : { receiptOCRProcessor }),
    ...(webPushConfiguration === null ? {} : { vapidPublicKey: webPushConfiguration.publicKey })
  }
};
const app = buildApi(
  isHealthyStore(cp2Store)
    ? {
        ...apiOptions,
        databaseHealth: () => cp2Store.health(),
        ...(isFlushableStore(cp2Store) ? { mutationPersistenceFlush: () => cp2Store.flush() } : {})
      }
    : {
        ...apiOptions,
        ...(isFlushableStore(cp2Store) ? { mutationPersistenceFlush: () => cp2Store.flush() } : {})
      }
);

let accountDeletionRunner: AccountDeletionRunner | null = null;
let notificationDeliveryRunner: NotificationDeliveryRunner | null = null;
app.addHook("onClose", async () => {
  await notificationDeliveryRunner?.stop();
  await accountDeletionRunner?.stop();
  if (isClosableStore(cp2Store)) {
    await cp2Store.close();
  }
});

if (process.env.ENABLE_NOTIFICATION_DELIVERY_RUNNER !== "false") {
  notificationDeliveryRunner = startNotificationDeliveryRunner({
    store: cp2Store,
    onResult: (result) => {
      if (result.checked > 0) {
        app.log.info({ result }, "Message notification delivery run completed.");
      }
    },
    onError: (error) => app.log.error({ error }, "Message notification delivery run failed.")
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

if (process.env.ENABLE_ACCOUNT_DELETION_RUNNER === "true") {
  accountDeletionRunner = startAccountDeletionRunner({
    store: cp2Store,
    onResult: (result) => app.log.info({ result }, "Account deletion purge completed."),
    onError: (error) => app.log.error({ error }, "Account deletion purge failed.")
  });
}

function isClosableStore(store: unknown): store is { close: () => Promise<void> } {
  return typeof (store as { close?: unknown }).close === "function";
}

function isHealthyStore(
  store: unknown
): store is { health: () => Promise<Record<string, unknown>> } {
  return typeof (store as { health?: unknown }).health === "function";
}

function isFlushableStore(store: unknown): store is { flush: () => Promise<void> } {
  return typeof (store as { flush?: unknown }).flush === "function";
}
