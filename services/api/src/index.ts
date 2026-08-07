import type { RuntimeModelProvider } from "@soko/shared-types";
import { buildApi } from "./app.js";
import { readEnvironment } from "./config.js";
import { createCloudFallbackProvider } from "./inference/cloud-fallback.js";
import {
  createBackendModelAdapter,
  createProviderModelAdapter,
  type ModelRuntimeAdapter
} from "./inference/model-runtime.js";
import { OwnerNodeBroker } from "./inference/owner-node-broker.js";
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
import { createRateLimitRedisClient } from "./redis-client.js";

const config = readEnvironment();
const rateLimitRedisClient = createRateLimitRedisClient(config.redisUrl);
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const cloudProviders = new Map<string, RuntimeModelProvider>();
for (const [modelId, model, maxOutputTokens, timeoutMs] of [
  ["openai-fast", process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5-mini", 256, 15_000],
  ["openai-reasoning", process.env.OPENAI_REASONING_MODEL?.trim() || "gpt-5.2", 512, 30_000]
] as const) {
  const provider = createCloudFallbackProvider({
    enabled:
      config.inferenceClientFirst &&
      config.inferenceCloudFallbackEnabled &&
      config.inferenceCloudProvider === "openai",
    apiKey: openAiApiKey,
    model,
    modelId,
    modelAllowlist: config.inferenceCloudModelAllowlist,
    maxOutputTokens,
    monthlyTokenBudget: config.inferenceCloudMonthlyTokenBudget,
    timeoutMs
  });
  if (provider !== undefined) cloudProviders.set(modelId, provider);
}
const runtimeModelProviderResolver = (modelId: string) => {
  return cloudProviders.get(modelId);
};
const modelRuntimeAdapters = new Map<string, ModelRuntimeAdapter>();
let backendModelAdapter: ModelRuntimeAdapter | undefined;
if (config.backendInferenceEnabled) {
  const adapter = createBackendModelAdapter({
    baseUrl: config.backendInferenceBaseUrl,
    modelId: config.backendInferenceModelId,
    serviceToken: config.inferenceServiceToken,
    connectTimeoutMs: config.backendInferenceConnectTimeoutMs,
    timeoutMs: config.backendInferenceTimeoutMs
  });
  backendModelAdapter = adapter;
  modelRuntimeAdapters.set(`${adapter.executionTarget}:${config.backendInferenceModelId}`, adapter);
}
for (const [modelId, provider] of cloudProviders) {
  const adapter = createProviderModelAdapter({
    modelId,
    provider,
    executionTarget: "openai"
  });
  modelRuntimeAdapters.set(`${adapter.executionTarget}:${modelId}`, adapter);
}
const modelRuntimeAdapterResolver = (input: {
  modelId: string;
  executionTarget: ModelRuntimeAdapter["executionTarget"];
}) => modelRuntimeAdapters.get(`${input.executionTarget}:${input.modelId}`);
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
const ownerNodeSigningSecret = process.env.INFERENCE_JOB_SIGNING_SECRET?.trim() ?? "";
if (config.inferenceOwnerNodeEnabled && ownerNodeSigningSecret.length < 32) {
  throw new Error(
    "INFERENCE_JOB_SIGNING_SECRET must contain at least 32 characters when owner-node inference is enabled."
  );
}
const ownerNodeBroker =
  !config.inferenceOwnerNodeEnabled || ownerNodeSigningSecret.length < 32
    ? undefined
    : new OwnerNodeBroker({
        signingSecret: ownerNodeSigningSecret,
        jobTimeoutMs: config.inferenceJobTimeoutMs
      });

if (process.env.NODE_ENV === "production" && cp2StoreMode !== "memory" && databaseUrl === "") {
  throw new Error("DATABASE_URL is required in production unless CP2_STORE=memory is explicit.");
}

const shouldUsePostgresStore =
  cp2StoreMode === "postgres" || (cp2StoreMode !== "memory" && databaseUrl !== "");
const cp2StoreOptions = {
  runtimeModelProviderResolver,
  modelRuntimeAdapterResolver,
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
  inferenceRequired: config.backendInferenceRequired,
  rateLimitRedisClient,
  cp2: {
    store: cp2Store,
    emailProvider,
    ...(ownerNodeBroker === undefined ? {} : { ownerNodeBroker }),
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
        ...(hasInferenceDiagnostic()
          ? { agentRuntimeDiagnostic: (runInference: boolean) => runtimeDiagnostic(runInference) }
          : {}),
        ...(isFlushableStore(cp2Store) ? { mutationPersistenceFlush: () => cp2Store.flush() } : {})
      }
    : {
        ...apiOptions,
        ...(hasInferenceDiagnostic()
          ? { agentRuntimeDiagnostic: (runInference: boolean) => runtimeDiagnostic(runInference) }
          : {}),
        ...(isFlushableStore(cp2Store) ? { mutationPersistenceFlush: () => cp2Store.flush() } : {})
      }
);

let accountDeletionRunner: AccountDeletionRunner | null = null;
let notificationDeliveryRunner: NotificationDeliveryRunner | null = null;
app.addHook("onClose", async () => {
  await notificationDeliveryRunner?.stop();
  await accountDeletionRunner?.stop();
  rateLimitRedisClient.disconnect();
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

async function cloudDiagnostic() {
  const provider = cloudProviders.values().next().value as RuntimeModelProvider | undefined;
  return (
    (await provider?.diagnose?.(false)) ?? {
      provider: "openai" as const,
      status: "unavailable" as const,
      model: null,
      modelAvailable: null,
      inferenceAvailable: null,
      errorCode: "CLOUD_FALLBACK_DISABLED",
      checkedAt: new Date().toISOString()
    }
  );
}

function hasInferenceDiagnostic(): boolean {
  return backendModelAdapter !== undefined || cloudProviders.size > 0;
}

async function runtimeDiagnostic(runInference: boolean) {
  if (backendModelAdapter !== undefined) {
    const context = {
      agentId: "health-check",
      shopId: "health-check",
      modelId: config.backendInferenceModelId
    };
    const result = runInference
      ? await backendModelAdapter.healthCheck(context)
      : await backendModelAdapter.canRun(context);
    return {
      provider: "ollama" as const,
      status: result.available ? ("ready" as const) : ("unavailable" as const),
      model: config.backendInferenceModelId,
      modelAvailable: result.available,
      inferenceAvailable: runInference ? result.available : null,
      errorCode: result.errorCode,
      checkedAt: new Date().toISOString()
    };
  }
  return cloudDiagnostic();
}
