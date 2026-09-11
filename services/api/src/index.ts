import { runtimeModels, type RuntimeModelProviderName } from "@soko/shared-types";
import { Pool } from "pg";
import { buildApi } from "./app.js";
import { readEnvironment } from "./config.js";
import {
  createVercelInferenceClient,
  createVercelModelAdapter,
  type ModelRuntimeAdapter
} from "./inference/model-runtime.js";
import { createNeonModelArtifactStore } from "./inference/model-artifact-store.js";
import { OwnerNodeBroker } from "./inference/owner-node-broker.js";
import {
  startAccountDeletionRunner,
  type AccountDeletionRunner
} from "./cp2/account-deletion-runner.js";
import {
  startConversationRecycleBinRunner,
  type ConversationRecycleBinRunner
} from "./cp2/conversation-recycle-bin-runner.js";
import { readAccountDeletionProcessors } from "./cp2/account-deletion-processors.js";
import { createPostgresCp2Store } from "./cp2/postgres-store.js";
import { RETIRED_EXECUTION_FABRIC_TABLES } from "./cp2/retired-execution-fabric-tables.js";
import { RETIRED_LEGACY_BINDING_TABLES } from "./cp2/retired-legacy-binding-tables.js";
import { readBuildManifest } from "./build-manifest.js";
import { createCp2Store } from "./cp2/store.js";
import { createWebPushSender, readWebPushConfiguration } from "./cp2/push.js";
import { createEmailProviderFromEnvironment } from "./cp2/email-provider.js";
import { createReceiptOCRProcessorFromEnvironment } from "./cp2/receipt-ocr-provider.js";
import { createNetworkInviteSenderFromEnvironment } from "./cp2/network-invite-provider.js";
import {
  startNotificationDeliveryRunner,
  type NotificationDeliveryRunner
} from "./cp2/notification-delivery-runner.js";
import {
  startConnectedMailboxSyncRunner,
  type ConnectedMailboxSyncRunner
} from "./cp2/connected-mailbox-sync-runner.js";
import {
  startSokoIdCooldownRunner,
  type SokoIdCooldownRunner
} from "./cp2/sokoid-cooldown-runner.js";
import { createBinaryUploadPipelineFromEnvironment } from "./cp2/binary-upload-pipeline.js";
import { createRateLimitRedisClient } from "./redis-client.js";
import { createChannelGatewayFromEnvironment } from "./messaging/channel-gateway.js";
import { createEmailMailboxProviderClient } from "./messaging/email-provider-client.js";

const config = readEnvironment();
const rateLimitRedisClient = createRateLimitRedisClient(config.redisUrl);
const modelRuntimeAdapters = new Map<string, ModelRuntimeAdapter>();
let primaryInferenceAdapter: ModelRuntimeAdapter | undefined;
let artifactPool: Pool | undefined;
if (config.vercelInferenceUrl !== "") {
  artifactPool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  const artifactStore = createNeonModelArtifactStore({
    database: artifactPool,
    endpoint: config.neonModelStorageEndpoint,
    region: config.neonModelStorageRegion,
    accessKeyId: config.neonModelStorageAccessKeyId,
    secretAccessKey: config.neonModelStorageSecretAccessKey,
    downloadUrlTtlSeconds: config.modelArtifactUrlTtlSeconds
  });
  const client = createVercelInferenceClient({
    baseUrl: config.vercelInferenceUrl,
    serviceToken: config.inferenceServiceToken,
    timeoutMs: config.vercelInferenceTimeoutMs
  });
  for (const model of Object.values(runtimeModels).filter((candidate) => candidate.enabled)) {
    const adapter = createVercelModelAdapter({ modelId: model.id, artifactStore, client });
    modelRuntimeAdapters.set(`vercel:${model.id}`, adapter);
    if (model.id === config.platformDefaultRuntime.modelId) primaryInferenceAdapter = adapter;
  }
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
const channelGateway = createChannelGatewayFromEnvironment();
const emailMailboxProviderClient = createEmailMailboxProviderClient();
const renderDeployWebhookSecret = process.env.RENDER_DEPLOY_WEBHOOK_SECRET?.trim() ?? "";
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
  channelGateway,
  emailMailboxProviderClient,
  modelRuntimeAdapterResolver,
  platformDefaultRuntime: config.platformDefaultRuntime,
  ...(pushNotificationSender === undefined ? {} : { pushNotificationSender }),
  messageEmailNotificationSender:
    emailProvider.sendEncryptedMessageNotification.bind(emailProvider),
  ...(networkInviteSender === undefined ? {} : { networkInviteSender }),
  messageWebBaseUrl,
  workspaceDeliveryMaxFileBytes: config.workspaceDeliveryMaxFileBytes,
  ...(config.workspaceRoot === "" ? {} : { workspaceRoot: config.workspaceRoot }),
  ...(accountDeletionProcessors.length === 0 ? {} : { accountDeletionProcessors })
};

// Runtime resources remain provider-neutral and independently swappable. Deployments that promise
// zero-setup AI set INFERENCE_REQUIRED=true, making /health/ready fail unless the configured
// Vercel execution host can reach the selected model artifact.
const cp2Store = await createCp2StoreOrExplainSchemaFailure();
const apiOptions = {
  allowedCorsOrigins: config.allowedCorsOrigins,
  bodyLimit: Math.max(
    15_000_000,
    Math.ceil((config.workspaceDeliveryMaxFileBytes * 4) / 3) + 1_000_000
  ),
  inferenceRequired: config.inferenceRequired,
  rateLimitRedisClient,
  ...(renderDeployWebhookSecret === "" ? {} : { renderDeployWebhookSecret }),
  cp2: {
    store: cp2Store,
    emailProvider,
    webPublicUrl: messageWebBaseUrl,
    telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "").replace(/^@/u, ""),
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

const buildManifest = readBuildManifest();
app.log.info(
  {
    event: "runtime_schema_boot",
    runtimeArchitecture: "native",
    store: shouldUsePostgresStore ? "postgres" : "memory",
    schemaCompatibility: "verified",
    redisConfigured: (process.env.REDIS_URL ?? "").trim() !== "",
    ...(buildManifest === null
      ? {}
      : { gitCommitSha: buildManifest.gitCommitSha, buildTimestamp: buildManifest.buildTimestamp })
  },
  "Runtime schema boot diagnostic."
);

let accountDeletionRunner: AccountDeletionRunner | null = null;
let notificationDeliveryRunner: NotificationDeliveryRunner | null = null;
let connectedMailboxSyncRunner: ConnectedMailboxSyncRunner | null = null;
let sokoIdCooldownRunner: SokoIdCooldownRunner | null = null;
let conversationRecycleBinRunner: ConversationRecycleBinRunner | null = null;
const connectedMailboxSyncIntervalMs = readOptionalPositiveInteger(
  process.env.CONNECTED_MAILBOX_SYNC_INTERVAL_MS
);
const sokoIdCooldownIntervalMs = readOptionalPositiveInteger(
  process.env.SOKO_ID_COOLDOWN_RUNNER_INTERVAL_MS
);
const sokoIdCooldownMs = readOptionalPositiveInteger(process.env.SOKO_ID_COOLDOWN_MS);
app.addHook("onClose", async () => {
  await sokoIdCooldownRunner?.stop();
  await connectedMailboxSyncRunner?.stop();
  await notificationDeliveryRunner?.stop();
  await accountDeletionRunner?.stop();
  await conversationRecycleBinRunner?.stop();
  rateLimitRedisClient.disconnect();
  await artifactPool?.end();
  if (isClosableStore(cp2Store)) {
    await cp2Store.close();
  }
});

if (process.env.ENABLE_CONNECTED_MAILBOX_SYNC_RUNNER !== "false") {
  connectedMailboxSyncRunner = startConnectedMailboxSyncRunner({
    store: cp2Store,
    ...(connectedMailboxSyncIntervalMs === undefined
      ? {}
      : { intervalMs: connectedMailboxSyncIntervalMs }),
    onResult: (result) => {
      if (result.checked > 0) {
        app.log.info({ event: "mailbox_background_sync_completed", ...result });
      }
    },
    onError: (error) => app.log.error({ error }, "Connected mailbox sync run failed.")
  });
}

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

if (process.env.ENABLE_CONVERSATION_RECYCLE_BIN_RUNNER !== "false") {
  conversationRecycleBinRunner = startConversationRecycleBinRunner({
    store: cp2Store,
    onResult: (purged) => {
      if (purged > 0) {
        app.log.info({ event: "conversation_recycle_bin_purged", purged }, "Recycle bin purge run completed.");
      }
    },
    onError: (error) => app.log.error({ error }, "Recycle bin purge run failed.")
  });
}

if (process.env.ENABLE_SOKO_ID_COOLDOWN_RUNNER !== "false") {
  sokoIdCooldownRunner = startSokoIdCooldownRunner({
    store: cp2Store,
    ...(sokoIdCooldownIntervalMs === undefined ? {} : { intervalMs: sokoIdCooldownIntervalMs }),
    ...(sokoIdCooldownMs === undefined ? {} : { cooldownMs: sokoIdCooldownMs }),
    onResult: (released) => {
      if (released > 0) {
        app.log.info({ event: "soko_id_cooldown_released", released }, "Retired sokoIds released.");
      }
    },
    onError: (error) => app.log.error({ error }, "SokoId cooldown run failed.")
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

// Structurally, nothing in normalizedCollections (postgres-store.ts) names a retired Execution
// Fabric table any more, so this branch should be unreachable in a correctly built process. It
// exists as a defense-in-depth diagnostic: if a stale or reverted build somehow ships a query
// against one of those tables anyway, this turns an opaque `relation ... does not exist` (42P01)
// into a message that names the real problem instead of one query failure among many. See
// docs/architecture/native-runtime-deployment.md.
async function createCp2StoreOrExplainSchemaFailure() {
  try {
    return shouldUsePostgresStore
      ? await createPostgresCp2Store({
          databaseUrl: config.databaseUrl,
          ...cp2StoreOptions
        })
      : createCp2Store(cp2StoreOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retiredFabricTable = RETIRED_EXECUTION_FABRIC_TABLES.find((table) =>
      message.includes(table)
    );
    if (retiredFabricTable !== undefined) {
      throw new Error(
        `Native runtime schema compatibility failure: expected cp2_native_runtime_bindings, ` +
          `retired ${retiredFabricTable} must not be used. This process is running a build that is ` +
          `stale relative to the deployed schema (infra/db/migrations/065_retire_execution_fabric.sql); ` +
          `redeploy from a clean build.`,
        { cause: error }
      );
    }
    const retiredBindingTable = RETIRED_LEGACY_BINDING_TABLES.find((table) =>
      message.includes(table)
    );
    if (retiredBindingTable !== undefined) {
      throw new Error(
        `Native runtime schema compatibility failure: expected cp2_native_runtime_bindings, ` +
          `retired ${retiredBindingTable} must not be used. This process is running a build that ` +
          `is stale relative to the deployed schema (infra/db/migrations/` +
          `076_drop_legacy_agent_model_bindings.sql); redeploy from a clean build.`,
        { cause: error }
      );
    }
    throw error;
  }
}

function isClosableStore(store: unknown): store is { close: () => Promise<void> } {
  return typeof (store as { close?: unknown }).close === "function";
}

function readOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("CONNECTED_MAILBOX_SYNC_INTERVAL_MS must be a positive integer.");
  }
  return parsed;
}

function isHealthyStore(
  store: unknown
): store is { health: () => Promise<Record<string, unknown>> } {
  return typeof (store as { health?: unknown }).health === "function";
}

function isFlushableStore(store: unknown): store is { flush: () => Promise<void> } {
  return typeof (store as { flush?: unknown }).flush === "function";
}

function hasInferenceDiagnostic(): boolean {
  return primaryInferenceAdapter !== undefined;
}

async function runtimeDiagnostic(runInference: boolean) {
  if (primaryInferenceAdapter !== undefined) {
    const context = {
      agentId: "health-check",
      shopId: "health-check",
      modelId: config.platformDefaultRuntime.modelId
    };
    const result = runInference
      ? await primaryInferenceAdapter.healthCheck(context)
      : await primaryInferenceAdapter.canRun(context);
    return {
      provider: primaryInferenceAdapter.provider as RuntimeModelProviderName,
      status: result.available ? ("ready" as const) : ("unavailable" as const),
      model: config.platformDefaultRuntime.modelId,
      modelAvailable: result.available,
      inferenceAvailable: runInference ? result.available : null,
      errorCode: result.errorCode,
      checkedAt: new Date().toISOString()
    };
  }
  return {
    provider: "llama.cpp" as const,
    status: "unavailable" as const,
    model: config.platformDefaultRuntime.modelId,
    modelAvailable: false,
    inferenceAvailable: false,
    errorCode: "INFERENCE_SERVICE_UNCONFIGURED",
    checkedAt: new Date().toISOString()
  };
}
