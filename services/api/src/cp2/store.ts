import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { BusinessEvent } from "@soko/event-core";
import { runtimeToolRegistry } from "@soko/tool-core";
import {
  defaultAgentDefinition,
  defaultAgentDefinitionId,
  isAccountSyncCollection,
  isAgentDefinitionId,
  repositoryDefaultRuntimePolicy
} from "@soko/shared-types";
import { Cp2Error, assertValid } from "./cp2-error.js";
import { roundMoney } from "./money.js";
import {
  destinationAccountKey,
  hashMatches,
  hashOtp,
  isReservedSokoHandle,
  isSokoStorefrontId,
  maximumSokoHandleLength,
  minimumSokoHandleLength,
  normalizeOptionalBoundedText,
  normalizeRequiredBoundedText,
  createSokoHandle,
  normalizeStorefrontLookupId,
  pinAttemptTrackerMaximumEntries
} from "./text-normalization.js";
import { CommerceDomain } from "./domains/commerce/store.js";
import { ComplianceDomain } from "./domains/compliance/store.js";
import {
  betaFeatureFlagKeys,
  betaFeatureFlagMapKey,
  deviceTrustKey,
  launchChecklistKeys,
  launchChecklistMapKey
} from "./domains/compliance/shared.js";
import { LogisticsDomain } from "./domains/logistics/store.js";
import { CommercialRecordsDomain } from "./domains/commercial-records/store.js";
import { summarizeLogistics } from "./domains/logistics/shared.js";
import { SupplierDomain } from "./domains/suppliers/store.js";
import { DocumentImportDomain } from "./domains/document-imports/store.js";
import { NotificationsDomain } from "./domains/notifications/store.js";
import { notificationRuleKey, summarizeNotifications } from "./domains/notifications/shared.js";
import { NetworkDomain } from "./domains/network/store.js";
import { MessagingDomain } from "./domains/messaging/store.js";
import {
  requirePublicStorefrontBusiness,
  type ChannelIdentityLinkGrantRecord,
  type ConnectedMailboxOAuthSessionRecord,
  type ConnectedMailboxRecord,
  type CustomerRuntimeCapabilityRecord,
  type MessageNotificationDelivery
} from "./domains/messaging/shared.js";
import { AgentRuntimeDomain } from "./domains/agent-runtime/store.js";
import { createDefaultAgentRuntimeAdapterRegistry } from "../agent-harness/default-agent-runtime-adapters.js";
import type { AgentRuntimeAdapter } from "../agent-harness/agent-runtime-adapter.js";
import { describeAgentRuntimeAdapter } from "../agent-harness/agent-runtime-catalog.js";
import {
  aiModelRegistry,
  computeModelAvailability,
  defaultAiModelId,
  buildRuntimeModelPrompt,
  cloneAgentContextSource,
  cloneAgentRuntimeVersion,
  cloneBusinessAgentProfile,
  cloneInstalledAgentModel,
  contextCharacterBudgetForModel,
  publicAgentReplyText,
  normalizeInstalledAgentModel,
  type BusinessAgentProfileSummary
} from "./domains/agent-runtime/shared.js";
import {
  copyAgentManifest,
  createMemoryAccountAiAssetStore,
  modelArtifactChunkSizeBytes,
  type AccountAiAssetStore
} from "./account-ai-asset-store.js";
import { SalesDomain } from "./domains/sales/store.js";
import { type ProductMediaRecord } from "./domains/sales/shared.js";
import { McpTokensDomain } from "./domains/mcp-tokens/store.js";
import { type McpAccessTokenRecord } from "./domains/mcp-tokens/shared.js";
import { ExternalConnectionsDomain } from "./domains/external-connections/store.js";
import { type ExternalConnectionRecord } from "./domains/external-connections/shared.js";
import { PasskeyDomain } from "./domains/passkeys/store.js";
import {
  type PasskeyCeremonyRecord,
  type PasskeyCredentialRecord
} from "./domains/passkeys/shared.js";
import { OAuthDomain } from "./domains/oauth/store.js";
import { type OAuthSessionRecord, type UserIdentityRecord } from "./domains/oauth/shared.js";
import { OtpDomain } from "./domains/otp/store.js";
import {
  type OtpChallenge,
  type OtpChallengeDelivery,
  type SmsDeliveryAttemptRecord
} from "./domains/otp/shared.js";
import { DeviceBootstrapDomain } from "./domains/device-bootstrap/store.js";
import {
  type DeviceAccountBootstrapRecord,
  type DeviceRecoveryCredentialRecord
} from "./domains/device-bootstrap/shared.js";
import type {
  AccountSummary,
  AgentContextSource,
  AgentDefinition,
  AgentRuntimeAdapterDescriptor,
  AiModelSummary,
  AgentEvaluationEvent,
  AgentOwnerCorrection,
  AgentRuntimeVersion,
  ActiveAiModelSummary,
  AccountDeletionRequestSummary,
  AuthChannel,
  AuthSessionView,
  AuthenticatedActorView,
  BetaAccessSummary,
  BetaDeviceTestSummary,
  BetaFeatureFlagSummary,
  BetaReadinessReportSummary,
  BetaSupportTicketSummary,
  BetaTelemetryEventSummary,
  BusinessKnowledgeSummary,
  BusinessNotificationSummary,
  BusinessReportSummary,
  BusinessRole,
  BusinessSummary,
  CatalogueQueryResult,
  CanonicalContactSummary,
  ComplianceRetentionSummary,
  AgentRouteSummary,
  CountryTaxConfigSummary,
  ContactHashSummary,
  ConversationChannelSummary,
  ConversationMessageSummary,
  MessageDeliveryAttemptSummary,
  ConversationParticipantSummary,
  ConversationSummary,
  PlatformIdentitySummary,
  ProviderUpdateReceiptSummary,
  CustomerSummary,
  DeliveryRouteStopSummary,
  DeliveryRouteSummary,
  DataExportBundle,
  DataExportBundleSummary,
  DeviceSessionSummary,
  DeviceTrustSummary,
  DocumentImportJobSummary,
  DocumentImportSourceSummary,
  E2eeDeviceSummary,
  InventoryMovementSummary,
  InstalledAgentModelSummary,
  InstalledOssAgentManifestSummary,
  CloudModelArtifactSummary,
  OssAgentSummary,
  InvoiceSummary,
  LaunchChecklistItemSummary,
  LaunchIncidentSummary,
  LaunchReadinessReportSummary,
  LaunchSettingsSummary,
  LogisticsSummary,
  LocationSummary,
  MarketplaceIntroStateSummary,
  McpPrincipal,
  MembershipSummary,
  ModelExecutionTarget,
  PlatformDefaultRuntimePolicy,
  NetworkEdgeSummary,
  NetworkNodeSummary,
  NetworkPermissionSummary,
  NetworkSyncSourceSummary,
  NativeSmsDeviceCommandSummary,
  NativeSmsDeviceSummary,
  NetworkInviteSummary,
  OfflineCacheSnapshot,
  PaymentSummary,
  ProductFieldSchemaSummary,
  ProductSummary,
  ProductPurchasePriceSummary,
  PurchaseRecordSummary,
  BuyOrderSummary,
  ProductCaptureJobSummary,
  StatusBroadcastSummary,
  StatusOrderSummary,
  UnifiedCheckoutSummary,
  PublicCustomerCareRequestSummary,
  PublicOrderSummary,
  PublicStorefrontMessageSummary,
  PublicShopPresenceSummary,
  PurchaseReceiptSummary,
  PushSubscriptionSummary,
  RuntimeContextSummary,
  RuntimeModelCompletionResult,
  RuntimeModelProvider,
  RuntimeSessionSummary,
  RuntimeTurnSummary,
  ReceiptLineItemSummary,
  ReceiptOCRJobSummary,
  SessionSummary,
  SalesAgentSummary,
  SaleRecordSummary,
  ExternalIdentitySummary,
  SokoIdentityLinkSummary,
  SyncMutationPayload,
  SyncMutationType,
  SyncQueueItem,
  SyncQueueSummary,
  SyncReplayResult,
  SupplierContactLinkSummary,
  SupplierContactRelationshipSummary,
  SupplierSummary,
  SupportedLanguage,
  VerificationTierSummary,
  SecurityReviewSummary,
  SokoChatSurface,
  SokoMode,
  SokoSessionContext,
  ShopPresenceStatus,
  ShopPresenceSummary,
  StoredSokoSessionContext,
  SyncChange,
  SyncRealtimeChangesAvailableEvent,
  SyncCollection,
  SyncPullPage,
  UserSummary,
  NativeExecutionHostSummary,
  NativeModelInstallationSummary,
  NativeRuntimeAgentSummary,
  NativeRuntimeBindingModelSummary,
  NativeRuntimeBindingSummary,
  NativeRuntimeModelSummary,
  ResolvedNativeRuntimeBinding,
  SokoIdHistorySummary,
  SokoIdResolution
} from "@soko/shared-types";
import { type ModelRuntimeAdapter } from "../inference/model-runtime.js";
import { NativeRuntimeBindingStore } from "./domains/native-runtime/store.js";
import {
  ModelTemplatesDomain,
  type ModelTemplatesSnapshot
} from "./domains/model-templates/store.js";
import type {
  JudgeEvaluator,
  TemplateExecutor,
  TemplateTelemetryEvent
} from "./domains/model-templates/types.js";
import {
  createChannelGatewayFromEnvironment,
  type ChannelGateway
} from "../messaging/channel-gateway.js";
import {
  createEmailMailboxProviderClient,
  type EmailMailboxProviderClient
} from "../messaging/email-provider-client.js";
import { assembleAgentInferenceMessage, retrieveAgentContext } from "./agent-business-runtime.js";
import {
  createSyncQueueItem,
  markSyncProcessing,
  markSyncRejected,
  markSyncSynced,
  summarizeSyncQueue
} from "@soko/sync-core";
import { decryptOAuthToken, encryptOAuthToken } from "./oauth.js";
import {
  maskPhoneNumber,
  normalizeDestination,
  normalizeInternationalOwnerPhoneNumber,
  normalizeOwnerPhoneNumber,
  PhoneIdentityError,
  type NormalizedOwnerPhoneIdentity
} from "./phone-identity.js";
import {
  accountDeletionScheduledEvent,
  dataExportCreatedEvent,
  isBusinessRole,
  normalizeAccountDeletionInput,
  permissionsForRole,
  roleCan,
  validateAccountDeletionInput,
  type AccountDeletionInput,
  type BusinessPermission,
  type ContactRecordInput,
  type InvoiceInput,
  type LogisticsInput,
  type LogisticsStatusInput,
  type PaymentInput,
  type ProductInput,
  type StockAdjustmentInput
} from "@soko/business-core";
import { parseRuntimeModelOutput, parseMerchantCommand } from "@soko/tool-core";
import type { ConversationAttachmentRecord } from "./workspace-file-delivery.js";
import {
  createMemoryConversationAttachmentBlobStore,
  type ConversationAttachmentBlobStore
} from "./conversation-attachment-blob-store.js";

export const sessionCookieName = "soko_session";
export const refreshCookieName = "soko_refresh";

/**
 * How long a just-rotated refresh token's replacement credentials stay available for a
 * near-simultaneous reuse of the old token to claim, before further reuse is treated as theft.
 * Covers realistic multi-tab/multi-request races (network round trips, not idle time), not
 * legitimate reasons to present an already-superseded token minutes or hours later.
 */
const refreshTokenReuseGracePeriodMs = 15_000;
const syncTombstoneRetentionMs = 90 * 24 * 60 * 60 * 1000;
const pinAttemptWindowMs = 15 * 60 * 1000;
const pinMaximumFailedAttempts = 5;
const pinScryptCost = 16_384;
const pinScryptBlockSize = 8;
const pinScryptParallelization = 1;
const pinScryptKeyLength = 32;
const pinScryptMaximumMemory = 64 * 1024 * 1024;
const dummyPinHash = createScryptPinHash(
  "unknown-account",
  "0000",
  "soko-market-dummy-pin-hash-secret"
);
const dummyPasswordHash = createScryptPasswordHash(
  "unknown-account",
  "not-a-real-password",
  "soko-market-local-password-hash-secret"
);
const sellerOnlySurfaces = new Set<SokoChatSurface>(["catalogue", "owner-controls", "receipt"]);
const marketplacePermissions = [
  "marketplace:search",
  "shop:read",
  "conversation:read",
  "message:create",
  "order:create",
  "order:read-own"
];
export interface PublicStorefrontProductSummary {
  id: string;
  name: string;
  unit: string;
  available: boolean;
  sellingPrice: number | null;
  image: string | null;
}

export interface PublicStorefrontSummary {
  agentId: string;
  sokoId: string;
  businessName: string;
  presence: PublicShopPresenceSummary;
  products: PublicStorefrontProductSummary[];
}

export { Cp2Error } from "./cp2-error.js";
export { normalizeDestination } from "./phone-identity.js";

export type {
  NetworkImportConnectionInput,
  PhoneContactNetworkInput,
  SocialProfileNetworkInput
} from "./domains/network/shared.js";
export { createContactHash } from "./domains/network/shared.js";
export type {
  AgentConversationMessageResult,
  ChannelIdentityLinkGrantRecord,
  ConnectedMailboxBackgroundSyncSummary,
  ConnectedMailboxOAuthSessionRecord,
  ConnectedMailboxRecord,
  CustomerRuntimeCapabilityRecord,
  MessageNotificationDelivery,
  MessageNotificationDeliveryRunSummary,
  PublicStorefrontSessionResult
} from "./domains/messaging/shared.js";
export type {
  BusinessAgentProfileInput,
  BusinessAgentProfileSummary,
  NormalizedBusinessAgentProfile,
  RuntimeAgentProfile
} from "./domains/agent-runtime/shared.js";
export type { ProductMediaRecord } from "./domains/sales/shared.js";
export type { McpAccessTokenRecord } from "./domains/mcp-tokens/shared.js";
export type { PasskeyCeremonyRecord, PasskeyCredentialRecord } from "./domains/passkeys/shared.js";
export type {
  ConnectedSocialAccountSummary,
  OAuthCallbackResult,
  OAuthStartResult
} from "./domains/oauth/shared.js";
export type {
  OtpChallengeDelivery,
  OtpRequestResult,
  VerifyOtpResult
} from "./domains/otp/shared.js";
export type {
  DeviceAccountBootstrapRecord,
  DeviceRecoveryCredentialRecord
} from "./domains/device-bootstrap/shared.js";

/**
 * A deployment-level operator grant, distinct from every existing business-scoped role
 * (BusinessRole is always "who can do what within one shop"). Membership is the sole source of
 * authority for the platform model/agent catalog CRUD routes and is only ever written by
 * services/api/scripts/grant-platform-operator.mjs - no API route can create, extend, or
 * self-grant one. `id` mirrors `accountId` so this fits the generic normalizedCollections
 * entity_id contract (services/api/src/cp2/postgres-store.ts) without a bespoke loader.
 */
export interface PlatformOperatorGrant {
  id: string;
  accountId: string;
  grantedAt: string;
  grantedBy: string;
}

export interface SessionRecord extends SessionSummary {
  accountId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  browserOrApp: string;
  userAgentHash: string;
  refreshTokenHash: string;
  sessionFamilyId: string;
  refreshExpiresAt: string;
  inactivityExpiresAt: string;
  absoluteExpiresAt: string;
  rotatedFromSessionId: string | null;
  authenticatedAt: string;
  lastUsedAt: string;
  rotatedAt: string | null;
  revocationReason: string | null;
  pinVerifiedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface DeviceSessionMetadata {
  deviceId: string;
  deviceName: string;
  platform: string;
  browserOrApp: string;
  userAgent: string;
}

export interface AccountIdentityRecord {
  id: string;
  accountId: string;
  userId: string;
  type: AuthChannel;
  normalizedValue: string;
  displayValue: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordCredentialRecord {
  accountId: string;
  passwordHash: string;
  passwordChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTransactionRecord {
  id: string;
  purpose: "signup" | "login_mfa" | "recovery" | "totp_setup" | "identity_merge";
  accountId: string | null;
  identifierType: AuthChannel | null;
  identifierValue: string | null;
  providerChallengeId: string | null;
  verifiedAt: string | null;
  attempts: number;
  expiresAt: string;
  consumedAt: string | null;
  metadata: Record<string, string | boolean | null>;
  createdAt: string;
}

export interface MfaFactorRecord {
  id: string;
  accountId: string;
  type: "totp";
  secret: string;
  verifiedAt: string | null;
  lastUsedStep: number | null;
  createdAt: string;
  disabledAt: string | null;
}

export interface RecoveryCodeRecord {
  id: string;
  accountId: string;
  codeHash: string;
  usedAt: string | null;
  createdAt: string;
}

export interface ShopDeletionPreviewSummary {
  businessId: string;
  shopId: string;
  generatedAt: string;
  counts: {
    products: number;
    customers: number;
    suppliers: number;
    salesAgents: number;
    salesRecords: number;
    messages: number;
    notifications: number;
    connectedProviders: number;
    uploadedFiles: number;
    installedIntegrations: number;
  };
  retentionNotice: string;
}

export interface ShopDeletionRequestResult {
  request: AccountDeletionRequestSummary;
  preview: ShopDeletionPreviewSummary;
}

export interface CreateBusinessResult {
  business: BusinessSummary;
  membership: MembershipSummary;
}

export interface OwnerPhoneIdentityResult {
  user: UserSummary;
}

export interface RoleCheckResult {
  allowed: boolean;
  role: BusinessRole;
  permission: BusinessPermission;
}

export interface Cp2Snapshot extends ModelTemplatesSnapshot {
  accounts: AccountSummary[];
  users: UserSummary[];
  deviceAccountBootstraps?: DeviceAccountBootstrapRecord[];
  deviceRecoveryCredentials?: DeviceRecoveryCredentialRecord[];
  businesses: BusinessSummary[];
  sokoIdHistory?: SokoIdHistorySummary[];
  memberships: MembershipSummary[];
  sessionContexts: StoredSokoSessionContext[];
  conversations: ConversationSummary[];
  conversationParticipants: ConversationParticipantSummary[];
  conversationMessages: ConversationMessageSummary[];
  conversationAttachments?: ConversationAttachmentRecord[];
  platformIdentities?: PlatformIdentitySummary[];
  conversationChannels?: ConversationChannelSummary[];
  providerUpdateReceipts?: ProviderUpdateReceiptSummary[];
  channelIdentityLinkGrants?: ChannelIdentityLinkGrantRecord[];
  nativeSmsDevices?: NativeSmsDeviceSummary[];
  nativeSmsDeviceCommands?: NativeSmsDeviceCommandSummary[];
  connectedMailboxes?: ConnectedMailboxRecord[];
  connectedMailboxOAuthSessions?: ConnectedMailboxOAuthSessionRecord[];
  customerRuntimeCapabilities?: CustomerRuntimeCapabilityRecord[];
  messageDeliveryAttempts?: MessageDeliveryAttemptSummary[];
  messageNotificationDeliveries?: MessageNotificationDelivery[];
  e2eeDevices?: E2eeDeviceSummary[];
  pushSubscriptions?: PushSubscriptionSummary[];
  marketplaceIntroStates?: MarketplaceIntroStateSummary[];
  activeAiModels?: ActiveAiModelSummary[];
  agentProfiles?: BusinessAgentProfileSummary[];
  agentRuntimeVersions?: AgentRuntimeVersion[];
  agentContextSources?: AgentContextSource[];
  agentEvaluationEvents?: AgentEvaluationEvent[];
  agentOwnerCorrections?: AgentOwnerCorrection[];
  installedAgentModels?: InstalledAgentModelSummary[];
  nativeRuntimeAgents?: NativeRuntimeAgentSummary[];
  nativeRuntimeModels?: NativeRuntimeModelSummary[];
  nativeExecutionHosts?: NativeExecutionHostSummary[];
  nativeModelInstallations?: NativeModelInstallationSummary[];
  nativeRuntimeBindings?: NativeRuntimeBindingSummary[];
  nativeRuntimeBindingModels?: NativeRuntimeBindingModelSummary[];
  modelCatalog?: AiModelSummary[];
  agentCatalog?: AgentDefinition[];
  platformOperators?: PlatformOperatorGrant[];
  syncChanges: SyncChange[];
  mcpAccessTokens: McpAccessTokenRecord[];
  productFieldSchemas: ProductFieldSchemaSummary[];
  products: ProductSummary[];
  productMedia?: ProductMediaRecord[];
  productCaptureJobs?: ProductCaptureJobSummary[];
  statusBroadcasts?: StatusBroadcastSummary[];
  buyOrders?: BuyOrderSummary[];
  statusOrders?: StatusOrderSummary[];
  unifiedCheckouts?: UnifiedCheckoutSummary[];
  customers: CustomerSummary[];
  suppliers: SupplierSummary[];
  salesAgents: SalesAgentSummary[];
  supplierContactLinks: SupplierContactLinkSummary[];
  purchaseReceipts: PurchaseReceiptSummary[];
  receiptLineItems: ReceiptLineItemSummary[];
  receiptOCRJobs: ReceiptOCRJobSummary[];
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  logistics: LogisticsSummary[];
  contacts?: CanonicalContactSummary[];
  supplierContactRelationships?: SupplierContactRelationshipSummary[];
  purchasePriceHistory?: ProductPurchasePriceSummary[];
  purchaseRecords?: PurchaseRecordSummary[];
  saleRecords?: SaleRecordSummary[];
  locations?: LocationSummary[];
  deliveryRoutes?: DeliveryRouteSummary[];
  deliveryRouteStops?: DeliveryRouteStopSummary[];
  dataExports: DataExportBundleSummary[];
  accountDeletionRequests: AccountDeletionRequestSummary[];
  accountDeletionProofs?: AccountDeletionProof[];
  shopPresences?: ShopPresenceSummary[];
  networkInvites?: NetworkInviteSummary[];
  publicCustomerCareRequests?: PublicCustomerCareRequestSummary[];
  publicStorefrontMessages?: PublicStorefrontMessageSummary[];
  publicOrders?: PublicOrderSummary[];
  verificationTiers: VerificationTierSummary[];
  taxConfigs: CountryTaxConfigSummary[];
  deviceTrust: DeviceTrustSummary[];
  betaAccess: BetaAccessSummary[];
  betaFeatureFlags: BetaFeatureFlagSummary[];
  betaDeviceTests: BetaDeviceTestSummary[];
  betaSupportTickets: BetaSupportTicketSummary[];
  betaTelemetryEvents: BetaTelemetryEventSummary[];
  launchSettings: LaunchSettingsSummary[];
  launchChecklist: LaunchChecklistItemSummary[];
  launchIncidents: LaunchIncidentSummary[];
  documentImports: DocumentImportJobSummary[];
  documentImportSources: DocumentImportSourceSummary[];
  notifications: BusinessNotificationSummary[];
  runtimeSessions: RuntimeSessionSummary[];
  runtimeTurns: RuntimeTurnSummary[];
  inventoryMovements: InventoryMovementSummary[];
  syncQueue: SyncQueueItem[];
  otpChallenges: OtpChallenge[];
  smsDeliveryAttempts?: SmsDeliveryAttemptRecord[];
  sessions: SessionRecord[];
  passkeys?: PasskeyCredentialRecord[];
  passkeyCeremonies?: PasskeyCeremonyRecord[];
  accountIdentities?: AccountIdentityRecord[];
  passwordCredentials?: PasswordCredentialRecord[];
  authTransactions?: AuthTransactionRecord[];
  mfaFactors?: MfaFactorRecord[];
  recoveryCodes?: RecoveryCodeRecord[];
  userIdentities: UserIdentityRecord[];
  oauthSessions: OAuthSessionRecord[];
  accountPinHashes: Array<{
    accountId: string;
    pinHash: string;
  }>;
  networkNodes: NetworkNodeSummary[];
  networkEdges: NetworkEdgeSummary[];
  networkSources: NetworkSyncSourceSummary[];
  networkPermissions: NetworkPermissionSummary[];
  networkRoutes: AgentRouteSummary[];
  contactHashes: ContactHashSummary[];
  externalIdentities: ExternalIdentitySummary[];
  sokoIdentityLinks: SokoIdentityLinkSummary[];
  externalRegistryConnections: ExternalConnectionRecord[];
  auditEvents: BusinessEvent[];
}

export interface Cp2StoreOptions {
  passkeyAuthenticationVerifier?: typeof verifyAuthenticationResponse;
  runtimeModelProvider?: RuntimeModelProvider;
  runtimeModelProviderResolver?: (modelId: string) => RuntimeModelProvider | undefined;
  modelRuntimeAdapterResolver?: (input: {
    modelId: string;
    executionTarget: ModelExecutionTarget;
    agentId: string;
    shopId: string;
  }) => ModelRuntimeAdapter | undefined;
  agentRuntimeAdapterResolver?: (adapterId: string) => AgentRuntimeAdapter | undefined;
  platformDefaultRuntime?: PlatformDefaultRuntimePolicy;
  pushNotificationSender?: PushNotificationSender;
  messageEmailNotificationSender?: MessageEmailNotificationSender;
  networkInviteSender?: NetworkInviteSender;
  messageWebBaseUrl?: string;
  accountDeletionProcessors?: AccountDeletionProcessor[];
  channelGateway?: ChannelGateway;
  emailMailboxProviderClient?: EmailMailboxProviderClient;
  workspaceRoot?: string;
  workspaceDeliveryMaxFileBytes?: number;
  conversationAttachmentBlobStore?: ConversationAttachmentBlobStore;
  accountAiAssetStore?: AccountAiAssetStore;
  templateExecutor?: TemplateExecutor;
  templateJudgeEvaluator?: JudgeEvaluator;
  templateTelemetrySink?: (event: TemplateTelemetryEvent) => void;
}

export interface NetworkInviteDeliveryInput {
  inviteId: string;
  businessId: string;
  businessName: string;
  channel: NetworkInviteSummary["channel"];
  destination: string;
  contactName: string;
}

export type NetworkInviteDeliveryResult =
  { status: "sent" } | { status: "failed"; failureReason: string };

export type NetworkInviteSender = (
  input: NetworkInviteDeliveryInput
) => Promise<NetworkInviteDeliveryResult>;

export interface AccountDeletionSubject {
  provider: string;
  subject: string;
}

export interface AccountDeletionProcessorInput {
  requestId: string;
  subjects: AccountDeletionSubject[];
}

export interface AccountDeletionProcessorResult {
  externalReference: string;
}

export interface AccountDeletionProcessor {
  id: string;
  deleteAccount: (input: AccountDeletionProcessorInput) => Promise<AccountDeletionProcessorResult>;
}

export interface AccountDeletionProcessorReceipt {
  processorId: string;
  status: "completed" | "failed";
  attempts: number;
  lastAttemptedAt: string;
  completedAt: string | null;
  externalReference: string | null;
  errorCode: string | null;
}

export interface AccountDeletionProof {
  requestId: string;
  subjectDigest: string;
  status: "PARTIALLY_FAILED" | "COMPLETED";
  completedAt: string | null;
  deletedRecordCount: number;
  processorReceipts: AccountDeletionProcessorReceipt[];
}

export interface AccountDeletionPurgeRunSummary {
  checked: number;
  completed: number;
  partiallyFailed: number;
  skipped: number;
}

export type PushNotificationPayload =
  | {
      type: "message.new";
      conversationId: string;
      messageId: string;
      title: string;
      body: string;
    }
  | {
      type: "app.update_available";
      deployId: string;
      service: string;
      title: string;
      body: string;
    };

export type PushNotificationSender = (
  subscription: PushSubscriptionSummary,
  payload: PushNotificationPayload
) => Promise<"sent" | "expired" | "failed">;

export interface MessageEmailNotificationInput {
  conversationId: string;
  messageId: string;
  openUrl: string;
  to: string;
}

export type MessageEmailNotificationSender = (
  input: MessageEmailNotificationInput
) => Promise<"sent" | "failed">;

export class Cp2Store {
  private readonly channelGateway: ChannelGateway;
  private readonly emailMailboxProviderClient: EmailMailboxProviderClient;
  private readonly conversationAttachmentBlobStore: ConversationAttachmentBlobStore;
  private readonly accountAiAssetStore: AccountAiAssetStore;
  private readonly mcpPrincipalContext = new AsyncLocalStorage<McpPrincipal>();
  private readonly defaultAgentRuntimeAdapters = createDefaultAgentRuntimeAdapterRegistry();

  constructor(private readonly options: Cp2StoreOptions = {}) {
    this.nativeRuntimeBindings = new NativeRuntimeBindingStore(
      options.platformDefaultRuntime ?? repositoryDefaultRuntimePolicy
    );
    this.channelGateway = options.channelGateway ?? createChannelGatewayFromEnvironment({});
    this.emailMailboxProviderClient =
      options.emailMailboxProviderClient ?? createEmailMailboxProviderClient({});
    this.conversationAttachmentBlobStore =
      options.conversationAttachmentBlobStore ?? createMemoryConversationAttachmentBlobStore();
    this.accountAiAssetStore = options.accountAiAssetStore ?? createMemoryAccountAiAssetStore();
    this.oauthDomain = new OAuthDomain({
      requirePinVerifiedSession: (sessionId, now) => this.requirePinVerifiedSession(sessionId, now),
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireBrowserAuthorizedSession(sessionId, businessId, permission, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      createAccount: (channel, destination, now) => this.createAccount(channel, destination, now),
      requireAccount: (accountId) => this.requireAccount(accountId),
      userForAccount: (accountId) => this.userForAccount(accountId),
      updateUserDisplayName: (userId, displayName) =>
        this.updateUserDisplayName(userId, displayName),
      linkEmailAccountDestination: (email, accountId) =>
        this.linkEmailAccountDestination(email, accountId),
      addAccountIdentity: (account, user, type, value, isPrimary, now, verified) =>
        this.addAccountIdentity(account, user, type, value, isPrimary, now, verified),
      promoteAccountIdentityLevel: (accountId, nextLevel) =>
        this.promoteAccountIdentityLevel(accountId, nextLevel),
      createSession: (account, user, now) => this.createSession(account, user, now),
      markSessionPinVerified: (sessionId, now) => this.markSessionPinVerified(sessionId, now),
      resolveAnyIdentityAccount: (type, normalizedValue) =>
        this.resolveAnyIdentityAccount(type, normalizedValue),
      hasAccountPinHash: (accountId) => this.hasAccountPinHash(accountId)
    });
    this.otpDomain = new OtpDomain({
      findIdentityByVerifiedEmail: (email) => this.oauthDomain.findIdentityByVerifiedEmail(email),
      resolveIdentityAccount: (type, normalizedValue) =>
        this.resolveIdentityAccount(type, normalizedValue),
      resolveAnyIdentityAccount: (type, normalizedValue) =>
        this.resolveAnyIdentityAccount(type, normalizedValue),
      createAccount: (channel, destination, now) => this.createAccount(channel, destination, now),
      requireAccount: (accountId) => this.requireAccount(accountId),
      requireUser: (userId) => this.requireUser(userId),
      addAccountIdentity: (account, user, type, value, isPrimary, now, verified) =>
        this.addAccountIdentity(account, user, type, value, isPrimary, now, verified),
      createSession: (account, user, now) => this.createSession(account, user, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      accountByDestination: this.accountByDestination,
      userByAccount: this.userByAccount
    });
    this.deviceBootstrapDomain = new DeviceBootstrapDomain({
      getSession: (sessionId, now) => this.getSession(sessionId, now),
      requireAccount: (accountId) => this.requireAccount(accountId),
      requireUser: (userId) => this.requireUser(userId),
      requireAccountAuthenticationAllowed: (account) =>
        this.requireAccountAuthenticationAllowed(account),
      requireAnySession: (sessionId, now) => this.requireAnySession(sessionId, now),
      createAccount: (channel, destination, now, identityLevel) =>
        this.createAccount(channel, destination, now, identityLevel),
      createSession: (account, user, now) => this.createSession(account, user, now),
      consumeSessionRefreshToken: (sessionId) => this.consumeSessionRefreshToken(sessionId),
      revokeSessionFamily: (familyId, reason, now) =>
        this.revokeSessionFamily(familyId, reason, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      recordSecurityEvent: (type, accountId, outcome, now, metadata) =>
        this.recordSecurityEvent(type, accountId, outcome, now, metadata),
      markSessionPinVerified: (sessionId, now) => this.markSessionPinVerified(sessionId, now),
      resolveIdentityAccount: (type, normalizedValue) =>
        this.resolveIdentityAccount(type, normalizedValue),
      requirePinAttemptAllowed: (key, now) => this.requirePinAttemptAllowed(key, now),
      recordFailedPinAttempt: (key, now) => this.recordFailedPinAttempt(key, now),
      verifyStoredPin: (accountId, pin, storedHash) =>
        this.verifyStoredPin(accountId, pin, storedHash),
      simulateFailedPinCheck: (pin) => {
        verifyPinHash("unknown-account", pin, dummyPinHash);
      },
      normalizePin: (pin) => normalizePin(pin),
      mergeDeviceAccountData: (sourceAccountId, sourceUserId, targetAccountId, targetUserId) =>
        this.mergeDeviceAccountData(sourceAccountId, sourceUserId, targetAccountId, targetUserId),
      sessions: this.sessions,
      users: this.users,
      userByAccount: this.userByAccount,
      accountPinHashes: this.accountPinHashes,
      failedPinAttempts: this.failedPinAttempts
    });
    this.networkDomain = new NetworkDomain({
      requirePinVerifiedSession: (sessionId, now) => this.requireAuthenticatedActor(sessionId, now),
      accounts: this.accounts,
      userByAccount: this.userByAccount,
      memberships: this.memberships,
      businesses: this.businesses,
      userIdentities: this.oauthDomain.userIdentitiesMap
    });
    this.salesDomain = new SalesDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      appendBusinessEvent: (event) => this.appendBusinessEvent(event),
      requireAccount: (accountId) => this.requireAccount(accountId),
      requireCustomerCapability: (token, businessId, now) =>
        this.messagingDomain.requireCustomerCapability(token, businessId, now),
      findPlatformIdentity: (platformIdentityId) =>
        this.messagingDomain.platformIdentitiesMap.get(platformIdentityId),
      relinkPlatformIdentitiesForCustomer: (businessId, customerId, accountId, now) => {
        for (const identity of this.messagingDomain.platformIdentitiesMap.values()) {
          if (identity.businessId === businessId && identity.customerId === customerId) {
            this.messagingDomain.platformIdentitiesMap.set(identity.id, {
              ...identity,
              accountId,
              verifiedAt: now.toISOString(),
              updatedAt: now.toISOString()
            });
          }
        }
      },
      businesses: this.businesses,
      quarantinedBusinessIds: this.quarantinedBusinessIds,
      recordPurchasePriceMutation: (input) =>
        this.commercialRecordsDomain.recordProductPriceMutation(input)
    });
    this.mcpTokensDomain = new McpTokensDomain({
      requirePinVerifiedSession: (sessionId, now) => this.requirePinVerifiedSession(sessionId, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      listAccountShops: (input) => this.listAccountShops(input),
      requireIntegrationPrincipal: (input) => this.requireIntegrationPrincipal(input)
    });
    this.externalConnectionsDomain = new ExternalConnectionsDomain({
      requirePinVerifiedSession: (sessionId, now) => this.requirePinVerifiedSession(sessionId, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input)
    });
    this.passkeyDomain = new PasskeyDomain({
      requireAnySession: (sessionId, now) => this.requireAnySession(sessionId, now),
      requireRecentlyAuthenticatedSession: (sessionId, now) =>
        this.requireRecentlyAuthenticatedSession(sessionId, now),
      requirePinVerifiedSession: (sessionId, now) => this.requirePinVerifiedSession(sessionId, now),
      markSessionPinVerified: (sessionId, now) => this.markSessionPinVerified(sessionId, now),
      getSession: (sessionId, now) => this.getSession(sessionId, now),
      requireAccount: (accountId) => this.requireAccount(accountId),
      requireUser: (userId) => this.requireUser(userId),
      requireAccountAuthenticationAllowed: (account) =>
        this.requireAccountAuthenticationAllowed(account),
      createSession: (account, user, now) => this.createSession(account, user, now),
      promoteAccountIdentityLevel: (accountId, nextLevel) =>
        this.promoteAccountIdentityLevel(accountId, nextLevel),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      normalizePin: (pin) => normalizePin(pin),
      hasAccountPinHash: (accountId) => this.hasAccountPinHash(accountId),
      resetAccountPinHash: (accountId, normalizedPin) =>
        this.resetAccountPinHash(accountId, normalizedPin),
      hasPasswordCredential: (accountId) => this.hasPasswordCredential(accountId),
      revokeOtherSessionsForAccount: (accountId, exceptSessionId, reason, now) =>
        this.revokeOtherSessionsForAccount(accountId, exceptSessionId, reason, now),
      ...(this.options.passkeyAuthenticationVerifier === undefined
        ? {}
        : { passkeyAuthenticationVerifier: this.options.passkeyAuthenticationVerifier })
    });
    this.commerce = new CommerceDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      requirePinVerifiedSession: (sessionId, now) => this.requireAuthenticatedActor(sessionId, now),
      requireProduct: (businessId, productId) =>
        this.salesDomain.requireProduct(businessId, productId),
      createProduct: (input) => this.salesDomain.createProduct(input),
      updateProduct: (input) => this.salesDomain.updateProduct(input),
      listPublicStorefronts: (input) => this.listPublicStorefronts(input),
      createConversationMessage: (input) => this.createConversationMessage(input),
      buildStoredInvoice: (input) => this.salesDomain.buildStoredInvoice(input),
      nextInvoiceNumber: (businessId) => this.salesDomain.nextInvoiceNumber(businessId),
      productMedia: this.salesDomain.productMediaMap,
      products: this.salesDomain.productsMap,
      customers: this.salesDomain.customersMap,
      networkNodes: this.networkDomain.networkNodesMap,
      users: this.users,
      businesses: this.businesses,
      invoices: this.salesDomain.invoicesMap
    });
    this.compliance = new ComplianceDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      appendBusinessEvent: (event) => this.appendBusinessEvent(event)
    });
    this.logisticsDomain = new LogisticsDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      appendBusinessEvent: (event) => this.appendBusinessEvent(event),
      requireInvoice: (businessId, invoiceId) =>
        this.salesDomain.requireInvoice(businessId, invoiceId)
    });
    this.supplierDomain = new SupplierDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      appendBusinessEvent: (event) => this.appendBusinessEvent(event),
      requirePhonebookNode: (ownerUserId, networkNodeId) =>
        this.networkDomain.requirePhonebookNode(ownerUserId, networkNodeId),
      networkNodes: this.networkDomain.networkNodesMap,
      networkSources: this.networkDomain.networkSourcesMap
    });
    this.commercialRecordsDomain = new CommercialRecordsDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      requireAccount: (accountId) => this.requireAccount(accountId),
      requireProduct: (businessId, productId) =>
        this.salesDomain.requireProduct(businessId, productId),
      setProductBuyingPrice: (businessId, productId, price, now) => {
        const product = this.salesDomain.requireProduct(businessId, productId);
        this.salesDomain.productsMap.set(product.id, {
          ...product,
          buyingPrice: price,
          updatedAt: now.toISOString()
        });
      },
      requireSupplier: (businessId, supplierId) =>
        this.supplierDomain.requireSupplier(businessId, supplierId),
      requireCustomer: (businessId, customerId) =>
        this.salesDomain.requireCustomer(businessId, customerId),
      createInvoice: (input) => this.salesDomain.createInvoice(input),
      confirmInvoice: (input) => this.salesDomain.confirmInvoice(input),
      listSalesAgentsForSupplier: (input) => this.supplierDomain.listSalesAgents(input),
      createSalesAgent: (input) => this.supplierDomain.createSalesAgent(input),
      linkSalesAgentContact: (input) => this.supplierDomain.linkSalesAgentContact(input),
      deleteSalesAgent: (input) => this.supplierDomain.deleteSalesAgent(input)
    });
    this.documentImportDomain = new DocumentImportDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      appendBusinessEvent: (event) => this.appendBusinessEvent(event),
      createSupplier: (input) => this.createSupplier(input),
      createProduct: (input) => this.createProduct(input)
    });
    this.notificationsDomain = new NotificationsDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      buildBusinessReport: (businessId, now) => this.buildBusinessReport(businessId, now)
    });
    this.messagingDomain = new MessagingDomain({
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      requirePinVerifiedSession: (sessionId, now) => this.requirePinVerifiedSession(sessionId, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      recordSyncChange: (input) => this.recordSyncChange(input),
      requireMembership: (businessId, userId) => this.requireMembership(businessId, userId),
      requireBusiness: (businessId) => this.requireBusiness(businessId),
      requireCustomer: (businessId, customerId) =>
        this.salesDomain.requireCustomer(businessId, customerId),
      createGuestCustomer: (input) => this.salesDomain.createGuestCustomer(input),
      requireInvoice: (businessId, invoiceId) =>
        this.salesDomain.requireInvoice(businessId, invoiceId),
      ensureSokoSessionContext: (session, now) => this.ensureSokoSessionContext(session, now),
      createRuntimeTurn: (input) => this.agentRuntimeDomain.createRuntimeTurn(input),
      agentModelRecoveryGuidance: (businessId, error) =>
        this.agentRuntimeDomain.agentModelRecoveryGuidance(businessId, error),
      attemptPublicAgentReply: (input) => this.attemptPublicAgentReply(input),
      assignRuntimeBinding: (input) => this.nativeRuntimeBindings.assignConversationBinding(input),
      channelGateway: this.channelGateway,
      emailMailboxProviderClient: this.emailMailboxProviderClient,
      ...(this.options.pushNotificationSender === undefined
        ? {}
        : { pushNotificationSender: this.options.pushNotificationSender }),
      ...(this.options.messageEmailNotificationSender === undefined
        ? {}
        : { messageEmailNotificationSender: this.options.messageEmailNotificationSender }),
      ...(this.options.messageWebBaseUrl === undefined
        ? {}
        : { messageWebBaseUrl: this.options.messageWebBaseUrl }),
      accounts: this.accounts,
      users: this.users,
      userByAccount: this.userByAccount,
      businesses: this.businesses,
      memberships: this.memberships,
      sessions: this.sessions,
      customers: this.salesDomain.customersMap,
      quarantinedBusinessIds: this.quarantinedBusinessIds,
      accountByDestination: this.accountByDestination,
      conversationAttachmentBlobStore: this.conversationAttachmentBlobStore,
      ...(this.options.workspaceRoot === undefined
        ? {}
        : { workspaceRoot: this.options.workspaceRoot }),
      ...(this.options.workspaceDeliveryMaxFileBytes === undefined
        ? {}
        : { workspaceDeliveryMaxFileBytes: this.options.workspaceDeliveryMaxFileBytes })
    });
    this.modelTemplatesDomain = new ModelTemplatesDomain({
      requireAccess: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      resolveBaseModel: (modelId) => {
        const model = this.resolveCatalogModel(modelId);
        return model === undefined
          ? null
          : {
              id: model.id,
              provider: model.provider,
              capabilities: [...model.capabilities],
              contextWindow: model.contextWindow,
              available: model.available
            };
      },
      ...(this.options.templateExecutor === undefined
        ? {}
        : { executeTemplate: this.options.templateExecutor }),
      ...(this.options.templateJudgeEvaluator === undefined
        ? {}
        : { judgeEvaluator: this.options.templateJudgeEvaluator }),
      emitTelemetry:
        this.options.templateTelemetrySink ??
        ((event) => {
          console.info(JSON.stringify(event));
        })
    });
    this.agentRuntimeDomain = new AgentRuntimeDomain({
      platformDefaultRuntime: this.options.platformDefaultRuntime ?? repositoryDefaultRuntimePolicy,
      listModelCatalog: () => this.listModelCatalog(),
      resolveCatalogModel: (modelId) => this.resolveCatalogModel(modelId),
      resolveAgentCatalogEntry: (agentDefinitionId) =>
        cloneAgentCatalogEntry(this.agentCatalog.get(agentDefinitionId) ?? defaultAgentDefinition),
      requireAuthorizedSession: (sessionId, businessId, permission, now) =>
        this.requireAuthorizedActor(sessionId, businessId, permission, now),
      requirePinVerifiedSession: (sessionId, now) => this.requireAuthenticatedActor(sessionId, now),
      recordAuditEvent: (input) => this.recordAuditEvent(input),
      requireMembership: (businessId, userId) => this.requireMembership(businessId, userId),
      requireBusiness: (businessId) => this.requireBusiness(businessId),
      buildRuntimeContext: (businessId, userId) => this.buildRuntimeContext(businessId, userId),
      imageForProduct: (product) => this.salesDomain.publicProductImage(product),
      importsForBusiness: (businessId) => this.documentImportDomain.importsForBusiness(businessId),
      requireDocumentImport: (businessId, importJobId) =>
        this.documentImportDomain.requireDocumentImport(businessId, importJobId),
      suppliersForBusiness: (businessId) => this.supplierDomain.suppliersForBusiness(businessId),
      purchaseReceipts: this.supplierDomain.purchaseReceiptsMap,
      queryCatalogue: (input) => this.salesDomain.queryCatalogue(input),
      listProducts: (input) => this.salesDomain.listProducts(input),
      listInvoices: (input) => this.salesDomain.listInvoices(input),
      listCustomerDebts: (input) => this.salesDomain.listCustomerDebts(input),
      getBusinessReport: (input) => this.getBusinessReport(input),
      listNotifications: (input) => this.notificationsDomain.listNotifications(input),
      getSecurityReview: (input) => this.getSecurityReview(input),
      createAgentRoute: (input) => this.networkDomain.createAgentRoute(input),
      searchBuyFeed: (input) => this.commerce.searchBuyFeed(input),
      createUnifiedCheckout: (input) => this.commerce.createUnifiedCheckout(input),
      getProductFieldSchema: (input) => this.salesDomain.getProductFieldSchema(input),
      saveProductFieldSchema: (input) => this.salesDomain.saveProductFieldSchema(input),
      createProduct: (input) => this.salesDomain.createProduct(input),
      updateProduct: (input) => this.salesDomain.updateProduct(input),
      adjustProductStock: (input) => this.salesDomain.adjustProductStock(input),
      deleteProduct: (input) => this.salesDomain.deleteProduct(input),
      createCustomer: (input) => this.salesDomain.createCustomer(input),
      updateCustomer: (input) => this.salesDomain.updateCustomer(input),
      updateLogisticsStatus: (input) => this.logisticsDomain.updateLogisticsStatus(input),
      createSupplier: (input) => this.supplierDomain.createSupplier(input),
      updateSupplier: (input) => this.supplierDomain.updateSupplier(input),
      createInvoice: (input) => this.salesDomain.createInvoice(input),
      recordPayment: (input) => this.salesDomain.recordPayment(input),
      listPurchaseReceipts: (input) => this.listPurchaseReceipts(input),
      listContacts: (input) => this.commercialRecordsDomain.listContacts(input),
      attachSupplierContact: (input) => this.commercialRecordsDomain.attachSupplierContact(input),
      createPurchase: (input) => this.commercialRecordsDomain.createPurchase(input),
      changePurchasePrice: (input) => this.commercialRecordsDomain.changePurchasePrice(input),
      listPurchaseHistory: (input) => this.commercialRecordsDomain.listPurchaseHistory(input),
      createSale: (input) => this.commercialRecordsDomain.createSale(input),
      listSalesHistory: (input) => this.commercialRecordsDomain.listSalesHistory(input),
      createDeliveryRoute: (input) => this.commercialRecordsDomain.createRoute(input),
      listDeliveryRouteHistory: (input) => this.commercialRecordsDomain.listRouteHistory(input),
      listReceiptOCRJobs: (input) => this.supplierDomain.listReceiptOCRJobs(input),
      createReceiptOCRJob: (input) => this.supplierDomain.createReceiptOCRJob(input),
      confirmReceiptOCRJob: (input) => this.supplierDomain.confirmReceiptOCRJob(input),
      correctReceiptOCRJob: (input) => this.supplierDomain.correctReceiptOCRJob(input),
      cancelReceiptOCRJob: (input) => this.supplierDomain.cancelReceiptOCRJob(input),
      confirmProductImport: (input) => this.confirmProductImport(input),
      confirmSupplierImport: (input) => this.confirmSupplierImport(input),
      sendChannelMessage: (input) => this.sendChannelMessage(input),
      deliverWorkspaceFile: (input) => this.messagingDomain.deliverWorkspaceFile(input),
      products: this.salesDomain.productsMap,
      customers: this.salesDomain.customersMap,
      invoices: this.salesDomain.invoicesMap,
      sessions: this.sessions,
      businesses: this.businesses,
      // A conversation's native runtime binding can legitimately have no configured model yet
      // (RUNTIME_MODEL_NOT_CONFIGURED) or no currently-available one (RUNTIME_MODELS_UNAVAILABLE) -
      // neither should crash a chat turn. Every caller already treats a null nativeResolution as
      // "fall back to the legacy agent-model-binding path" (see resolveNativeRuntimeModelProvider
      // and resolveActiveRuntimeModelId), so a resolution failure here degrades to that same null
      // rather than throwing. See docs/architecture/provider-neutral-runtime.md §5.
      resolveNativeRuntimeBinding: (input) => {
        // A conversationId is request-body input, not something the caller's authorization was
        // ever checked against - only the businessId on the URL/session was. Without this check a
        // shop member who learns another shop's conversationId (support ticket, shared screenshot,
        // browser history) could get inference routed through - and its binding/model/host echoed
        // back from - a runtime this request was never authorized for. Mirrors the same guard
        // ensureDefaultRuntimeBinding already applies to conversation binding assignment below.
        const conversation =
          input.conversationId === undefined
            ? undefined
            : this.messagingDomain.conversationsMap.get(input.conversationId);
        if (
          conversation !== undefined &&
          conversation.activeShopId !== null &&
          conversation.activeShopId !== input.businessId
        ) {
          throw new Cp2Error(
            403,
            "RUNTIME_BINDING_FORBIDDEN",
            "The conversation cannot use this shop runtime."
          );
        }
        try {
          return this.nativeRuntimeBindings.resolveRuntimeBinding(
            input,
            this.messagingDomain.conversationsMap
          );
        } catch (error) {
          if (error instanceof Cp2Error) return null;
          throw error;
        }
      },
      activateVerifiedRuntimeBinding: (input) => {
        const binding = this.nativeRuntimeBindings.activateVerifiedModel(input);
        for (const [conversationId, conversation] of this.messagingDomain.conversationsMap) {
          if (
            conversation.accountId === input.accountId &&
            (conversation.activeShopId === input.businessId || conversation.activeShopId === null)
          ) {
            this.messagingDomain.conversationsMap.set(conversationId, {
              ...conversation,
              runtimeBindingId: binding.id,
              updatedAt: input.checkedAt
            });
          }
        }
        return binding;
      },
      resolveAgentRuntimeAdapterId: (agentId) =>
        this.nativeRuntimeBindings.resolveAgentRuntimeAdapterId(agentId),
      resolveProductionModelTemplate: (businessId, agentId, modelId) =>
        this.modelTemplatesDomain.resolveProductionTemplate({ businessId, agentId, modelId }),
      getActiveNativeRuntimeBinding: (businessId, agentId, accountId) =>
        this.nativeRuntimeBindings.getActiveBindingForAgent(businessId, agentId, accountId),
      ensureDefaultRuntimeBinding: (input) => {
        // Authorize before mutating: this call provisions binding/host/model/installation rows,
        // and a rejected conversation must never leave those behind. resolveNativeRuntimeBinding
        // above already rejects a cross-shop conversationId before ensureDefaultRuntimeForTurn ever
        // reaches this call, but that check alone doesn't cover a same-shop conversationId that
        // belongs to a different account - check both here, first, so nothing is written.
        //
        // A caller with no conversationId (the merchant's own runtime-session chat with their
        // shop's agent) has no Conversation to authorize against or attach a runtimeBindingId to -
        // input.businessId/accountId are already the caller's authorized session, same as every
        // other native-runtime write in this domain, so provisioning proceeds directly.
        if (input.conversationId === undefined) {
          return this.nativeRuntimeBindings.ensureDefaultRuntimeBinding(input);
        }
        const conversation = this.messagingDomain.conversationsMap.get(input.conversationId);
        if (
          conversation === undefined ||
          conversation.accountId !== input.accountId ||
          (conversation.activeShopId !== null && conversation.activeShopId !== input.businessId)
        ) {
          throw new Cp2Error(
            403,
            "RUNTIME_BINDING_FORBIDDEN",
            "The conversation cannot use this shop runtime."
          );
        }
        const result = this.nativeRuntimeBindings.ensureDefaultRuntimeBinding(input);
        if (conversation.runtimeBindingId !== result.binding.id) {
          this.messagingDomain.conversationsMap.set(conversation.id, {
            ...conversation,
            runtimeBindingId: result.binding.id,
            updatedAt: input.checkedAt
          });
        }
        return result;
      },
      deactivateRuntimeBinding: (input) => {
        const bindingId = this.nativeRuntimeBindings.deactivateBusinessAgentBinding(
          input.businessId,
          input.accountId,
          input.agentId,
          input.updatedBy,
          input.now
        );
        if (bindingId !== null) {
          for (const [conversationId, conversation] of this.messagingDomain.conversationsMap) {
            if (
              conversation.accountId === input.accountId &&
              conversation.activeShopId === input.businessId &&
              conversation.runtimeBindingId === bindingId
            ) {
              this.messagingDomain.conversationsMap.set(conversationId, {
                ...conversation,
                runtimeBindingId: this.nativeRuntimeBindings.assignConversationBinding({
                  accountId: input.accountId,
                  activeShopId: null
                }),
                updatedAt: input.now.toISOString()
              });
            }
          }
        }
        return bindingId;
      },
      ...(this.options.modelRuntimeAdapterResolver === undefined
        ? {}
        : { modelRuntimeAdapterResolver: this.options.modelRuntimeAdapterResolver }),
      agentRuntimeAdapterResolver:
        this.options.agentRuntimeAdapterResolver ??
        ((adapterId) => this.defaultAgentRuntimeAdapters.resolve(adapterId)),
      ...(this.options.runtimeModelProviderResolver === undefined
        ? {}
        : { runtimeModelProviderResolver: this.options.runtimeModelProviderResolver }),
      ...(this.options.runtimeModelProvider === undefined
        ? {}
        : { runtimeModelProvider: this.options.runtimeModelProvider })
    });
    this.seedCatalogDefaultsIfEmpty();
  }

  private readonly accounts = new Map<string, AccountSummary>();
  private readonly accountByDestination = new Map<string, string>();
  private readonly users = new Map<string, UserSummary>();
  private readonly userByAccount = new Map<string, string>();
  // deviceAccountBootstraps/deviceAccountBootstrapCredentials/deviceRecoveryCredentials/
  // deviceRecoverySessionCredentials now live inside `deviceBootstrapDomain`
  // (services/api/src/cp2/domains/device-bootstrap/store.ts) - accessed via its map getters for
  // the generic snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  private readonly deviceBootstrapDomain: DeviceBootstrapDomain;
  private readonly businesses = new Map<string, BusinessSummary>();
  // Retired sokoIds, in post-rename cooldown until releasedAt is set (see renameSokoId /
  // releaseExpiredSokoIds / resolveBusinessBySokoId, docs/architecture/soko-id-slug-system.md).
  private readonly sokoIdHistory = new Map<string, SokoIdHistorySummary>();
  private readonly memberships = new Map<string, MembershipSummary>();
  private readonly phoneUpdateAttemptsByAccount = new Map<string, number[]>();
  // Keyed by sessionContextKey(accountId, conversationId), not accountId alone - each conversation
  // carries its own mode/activeShopId/activeSurface. Today every account has exactly one
  // conversation (its personal one), so this stays a de facto singleton until Phase 3 introduces
  // real multi-session UI. See docs/frontend/frontend.md Phase 2.
  private readonly sessionContexts = new Map<string, StoredSokoSessionContext>();
  // conversations/conversationParticipants/conversationMessages/platformIdentities/
  // conversationChannels/providerUpdateReceipts/channelIdentityLinkGrants/nativeSmsDevices/
  // nativeSmsDeviceCommands/connectedMailboxes/connectedMailboxOAuthSessions/
  // customerRuntimeCapabilities/messageDeliveryAttempts/messageNotificationDeliveries/
  // e2eeDevices/pushSubscriptions/pushSubscriptionIdByEndpoint/conversationTyping now live
  // inside `messagingDomain` (services/api/src/cp2/domains/messaging/store.ts) - accessed via
  // its map getters for the generic snapshot/restore/Postgres-persistence/account-deletion
  // sweeps below.
  private readonly messagingDomain: MessagingDomain;
  private readonly marketplaceIntroStates = new Map<string, MarketplaceIntroStateSummary>();
  // activeAiModels/agentProfiles/agentRuntimeVersions/agentContextSources/
  // agentEvaluationEvents/agentOwnerCorrections/installedAgentModels
  // (+ the ephemeral agentModelActivationLocks mutex Set)/runtimeSessions/runtimeTurns/
  // pendingRuntimeActions now live inside
  // `agentRuntimeDomain` (services/api/src/cp2/domains/agent-runtime/store.ts) - accessed via its
  // map getters for the generic snapshot/restore/Postgres-persistence/account-deletion sweeps
  // below. There is no agentModelBindings map anywhere - runtime binding state lives solely in
  // `nativeRuntimeBindings` (NativeRuntimeBindingStore) just below. `mcpAccessTokens`/
  // `mcpTokenIdByHash` deliberately stay here (see that domain's header comment for why).
  private readonly agentRuntimeDomain: AgentRuntimeDomain;
  private readonly modelTemplatesDomain: ModelTemplatesDomain;
  private readonly nativeRuntimeBindings: NativeRuntimeBindingStore;
  // DB-hosted model/agent catalog (see infra/db/migrations/071_platform_catalog.sql) and the
  // platform-operator grants that authorize editing it - see requirePlatformOperator,
  // listModelCatalog/upsertModelCatalogEntry/removeModelCatalogEntry, and the agent-catalog
  // equivalents. seedCatalogDefaultsIfEmpty supplies modelCatalog/agentCatalog from the hardcoded
  // aiModelRegistry/defaultAgentDefinition bootstrap content in memory whenever a fresh store or
  // an unexpectedly empty loaded collection needs a safe fallback.
  private readonly modelCatalog = new Map<string, AiModelSummary>();
  private readonly agentCatalog = new Map<string, AgentDefinition>();
  private readonly platformOperators = new Map<string, PlatformOperatorGrant>();
  private readonly quarantinedBusinessIds = new Set<string>();
  private readonly syncChanges: SyncChange[] = [];
  private readonly nextSyncSequenceByAccount = new Map<string, number>();
  // mcpAccessTokens/mcpTokenIdByHash now live inside `mcpTokensDomain`
  // (services/api/src/cp2/domains/mcp-tokens/store.ts) - accessed via its map getters for the
  // generic snapshot/Postgres-persistence/account-deletion sweeps below. hydrateSnapshot()
  // deliberately does NOT call its clear() - see that domain's shared.ts header comment.
  private readonly mcpTokensDomain: McpTokensDomain;
  // externalRegistryConnections lives inside `externalConnectionsDomain`
  // (services/api/src/cp2/domains/external-connections/store.ts) - a real Postgres table
  // (cp2_external_registry_connections), not the generic entity_id/record convention, the same
  // shape userIdentities/mcpAccessTokens use. Unlike mcpTokensDomain, hydrateSnapshot() DOES
  // clear() this domain before restoring - there is no pre-existing gap to preserve here.
  private readonly externalConnectionsDomain: ExternalConnectionsDomain;
  private readonly syncChangeListeners = new Map<
    string,
    Set<(event: SyncRealtimeChangesAvailableEvent) => void>
  >();
  // products/productMedia/productFieldSchemas/customers/invoices/payments/inventoryMovements/
  // publicOrders/publicCustomerCareRequests/publicStorefrontMessages (+ the derived, never-
  // persisted nextInvoiceNumberByBusiness counter) now live inside `salesDomain`
  // (services/api/src/cp2/domains/sales/store.ts) - accessed via its map getters for the generic
  // snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  private readonly salesDomain: SalesDomain;
  // productCaptureJobs/statusBroadcasts/buyOrders/statusOrders/unifiedCheckouts now live inside
  // `commerce` (services/api/src/cp2/domains/commerce/store.ts) - accessed via its map getters for
  // the generic snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  private readonly commerce: CommerceDomain;
  private readonly supplierDomain: SupplierDomain;
  private readonly logisticsDomain: LogisticsDomain;
  private readonly commercialRecordsDomain: CommercialRecordsDomain;
  private readonly dataExports = new Map<string, DataExportBundle>();
  private readonly accountDeletionRequests = new Map<string, AccountDeletionRequestSummary>();
  private readonly accountDeletionProofs = new Map<string, AccountDeletionProof>();
  private readonly shopPresences = new Map<string, ShopPresenceSummary>();
  private readonly networkInvites = new Map<string, NetworkInviteSummary>();
  /** Ephemeral per-(business,visitor) attempt timestamps; never persisted or snapshotted. */
  private readonly publicAgentReplyAttemptsByVisitor = new Map<string, number[]>();
  private readonly compliance: ComplianceDomain;
  private readonly documentImportDomain: DocumentImportDomain;
  // notifications/notificationByRuleKey now live inside `notificationsDomain`
  // (services/api/src/cp2/domains/notifications/store.ts) - accessed via its map getters
  // for the generic snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  private readonly notificationsDomain: NotificationsDomain;
  private readonly syncQueue = new Map<string, SyncQueueItem>();
  private readonly syncQueueIdByIdempotency = new Map<string, string>();
  // otpChallenges/smsDeliveryAttempts/otpRequestHistory now live inside `otpDomain`
  // (services/api/src/cp2/domains/otp/store.ts) - accessed via its map getters for the generic
  // snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  private readonly otpDomain: OtpDomain;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly pendingRefreshTokens = new Map<string, string>();
  /**
   * Short-lived record of "this now-rotated session became that new session", keyed by the old
   * session's ID. Exists so that near-simultaneous reuse of a just-rotated refresh token - e.g. two
   * browser tabs open on the same account racing the same rotation - hands back the already-issued
   * replacement credentials instead of being treated as token theft. See refreshSessionCredential.
   */
  private readonly recentSessionRotations = new Map<
    string,
    { replacementSessionId: string; replacementRefreshToken: string; rotatedAt: string }
  >();
  // passkeys/passkeyCeremonies/passkeyPinRecoveryGrants now live inside `passkeyDomain`
  // (services/api/src/cp2/domains/passkeys/store.ts) - accessed via its map getters for the
  // generic snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  // `passkeyPinRecoveryGrants` is deliberately never swept by the account-deletion purge - see
  // that domain's shared.ts header comment.
  private readonly passkeyDomain: PasskeyDomain;
  private readonly accountIdentities = new Map<string, AccountIdentityRecord>();
  private readonly identityAccountByValue = new Map<string, string>();
  private readonly passwordCredentials = new Map<string, PasswordCredentialRecord>();
  private readonly authTransactions = new Map<string, AuthTransactionRecord>();
  private readonly mfaFactors = new Map<string, MfaFactorRecord>();
  private readonly recoveryCodes = new Map<string, RecoveryCodeRecord>();
  // userIdentities/identityByProviderSubject/identityByEmail/oauthSessions now live inside
  // `oauthDomain` (services/api/src/cp2/domains/oauth/store.ts) - accessed via its map getters
  // for the generic snapshot/restore/Postgres-persistence/account-deletion sweeps below.
  private readonly oauthDomain: OAuthDomain;
  private readonly accountPinHashes = new Map<string, string>();
  private readonly failedPinAttempts = new Map<string, number[]>();
  // networkNodes/networkEdges/networkSources/networkPermissions/networkRoutes/contactHashes/
  // contactHashIdByValue/externalIdentities/externalIdentityIdBySubject/sokoIdentityLinks now
  // live inside `networkDomain` (services/api/src/cp2/domains/network/store.ts) - accessed via
  // its map getters for the generic snapshot/restore/Postgres-persistence/account-deletion
  // sweeps below.
  private readonly networkDomain: NetworkDomain;
  private readonly auditEvents: BusinessEvent[] = [];

  continueWithDevice(
    ...args: Parameters<DeviceBootstrapDomain["continueWithDevice"]>
  ): ReturnType<DeviceBootstrapDomain["continueWithDevice"]> {
    return this.deviceBootstrapDomain.continueWithDevice(...args);
  }
  recoverWithDeviceCredential(
    ...args: Parameters<DeviceBootstrapDomain["recoverWithDeviceCredential"]>
  ): ReturnType<DeviceBootstrapDomain["recoverWithDeviceCredential"]> {
    return this.deviceBootstrapDomain.recoverWithDeviceCredential(...args);
  }

  requestOtp(...args: Parameters<OtpDomain["requestOtp"]>): ReturnType<OtpDomain["requestOtp"]> {
    return this.otpDomain.requestOtp(...args);
  }
  verifyOtp(...args: Parameters<OtpDomain["verifyOtp"]>): ReturnType<OtpDomain["verifyOtp"]> {
    return this.otpDomain.verifyOtp(...args);
  }
  getOtpChallengeDelivery(
    ...args: Parameters<OtpDomain["getOtpChallengeDelivery"]>
  ): ReturnType<OtpDomain["getOtpChallengeDelivery"]> {
    return this.otpDomain.getOtpChallengeDelivery(...args);
  }
  getOtpChallengeDeliveryByContact(
    ...args: Parameters<OtpDomain["getOtpChallengeDeliveryByContact"]>
  ): ReturnType<OtpDomain["getOtpChallengeDeliveryByContact"]> {
    return this.otpDomain.getOtpChallengeDeliveryByContact(...args);
  }
  verifyExternallyApprovedOtp(
    ...args: Parameters<OtpDomain["verifyExternallyApprovedOtp"]>
  ): ReturnType<OtpDomain["verifyExternallyApprovedOtp"]> {
    return this.otpDomain.verifyExternallyApprovedOtp(...args);
  }

  authenticateSocialProfile(
    ...args: Parameters<OAuthDomain["authenticateSocialProfile"]>
  ): ReturnType<OAuthDomain["authenticateSocialProfile"]> {
    return this.oauthDomain.authenticateSocialProfile(...args);
  }
  beginOAuthSession(
    ...args: Parameters<OAuthDomain["beginOAuthSession"]>
  ): ReturnType<OAuthDomain["beginOAuthSession"]> {
    return this.oauthDomain.beginOAuthSession(...args);
  }
  getOAuthExchangeData(
    ...args: Parameters<OAuthDomain["getOAuthExchangeData"]>
  ): ReturnType<OAuthDomain["getOAuthExchangeData"]> {
    return this.oauthDomain.getOAuthExchangeData(...args);
  }
  getConnectedProviderAccess(
    ...args: Parameters<OAuthDomain["getConnectedProviderAccess"]>
  ): ReturnType<OAuthDomain["getConnectedProviderAccess"]> {
    return this.oauthDomain.getConnectedProviderAccess(...args);
  }
  completeOAuthCallback(
    ...args: Parameters<OAuthDomain["completeOAuthCallback"]>
  ): ReturnType<OAuthDomain["completeOAuthCallback"]> {
    return this.oauthDomain.completeOAuthCallback(...args);
  }
  completeOAuthProfileAuthentication(
    ...args: Parameters<OAuthDomain["completeOAuthProfileAuthentication"]>
  ): ReturnType<OAuthDomain["completeOAuthProfileAuthentication"]> {
    return this.oauthDomain.completeOAuthProfileAuthentication(...args);
  }
  getSession(sessionId: string | null, now = new Date()): AuthSessionView | null {
    if (sessionId === null) {
      return null;
    }

    const session = this.sessions.get(sessionId);

    if (session === undefined || session.revokedAt !== null) {
      return null;
    }

    const account = this.requireAccount(session.accountId);
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      return null;
    }
    if (
      Date.parse(session.absoluteExpiresAt) <= now.getTime() ||
      (account.status ?? "active") !== "active"
    ) {
      this.revokeSessionFamily(
        session.sessionFamilyId,
        (account.status ?? "active") === "active" ? "expired" : "account_status_changed",
        now
      );
      return null;
    }

    return {
      account,
      user: this.requireUser(session.userId),
      session: sessionView(session)
    };
  }

  prepareDeviceSession(
    sessionId: string,
    metadata: DeviceSessionMetadata,
    now = new Date()
  ): string {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.revokedAt !== null) {
      throw new Cp2Error(401, "auth_session_expired", "The account session is no longer active.");
    }
    session.deviceId = normalizeDeviceSessionValue(metadata.deviceId, "unknown-device");
    session.deviceName = normalizeDeviceSessionValue(metadata.deviceName, "This device");
    session.platform = normalizeDeviceSessionValue(metadata.platform, "unknown");
    session.browserOrApp = normalizeDeviceSessionValue(metadata.browserOrApp, "web");
    session.userAgentHash = hashUserAgent(metadata.userAgent);
    session.lastUsedAt = now.toISOString();
    let refreshToken = this.pendingRefreshTokens.get(session.id);
    if (refreshToken === undefined) {
      refreshToken = createRefreshToken();
      session.refreshTokenHash = hashRefreshToken(refreshToken);
      session.inactivityExpiresAt = sessionInactivityExpiry(now, session.absoluteExpiresAt);
      session.refreshExpiresAt = session.inactivityExpiresAt;
      this.pendingRefreshTokens.set(session.id, refreshToken);
    }
    return refreshToken;
  }

  consumeSessionRefreshToken(sessionId: string): string {
    const refreshToken = this.pendingRefreshTokens.get(sessionId);
    if (refreshToken === undefined) {
      throw new Cp2Error(500, "auth_refresh_issue_failed", "Refresh credential was not issued.");
    }
    this.pendingRefreshTokens.delete(sessionId);
    return refreshToken;
  }

  refreshSessionCredential(input: {
    refreshToken: string | null;
    metadata: DeviceSessionMetadata;
    now?: Date;
  }): AuthSessionView & { refreshToken: string; deviceSession: DeviceSessionSummary } {
    const now = input.now ?? new Date();
    this.pruneExpiredSessionRotations(now);
    if (input.refreshToken === null || input.refreshToken.trim().length === 0) {
      throw new Cp2Error(401, "auth_refresh_required", "A refresh session is required.");
    }
    const tokenHash = hashRefreshToken(input.refreshToken);
    const matched = [...this.sessions.values()].find((session) =>
      constantTimeHashMatches(session.refreshTokenHash, tokenHash)
    );
    if (matched === undefined) {
      throw new Cp2Error(401, "auth_refresh_revoked", "The refresh session is not valid.");
    }
    if (matched.revokedAt !== null) {
      if (matched.revocationReason === "rotated") {
        const recentRotation = this.recentSessionRotations.get(matched.id);
        if (recentRotation !== undefined) {
          const replacementSession = this.sessions.get(recentRotation.replacementSessionId);
          if (replacementSession !== undefined && replacementSession.revokedAt === null) {
            const replacementAccount = this.requireAccount(replacementSession.accountId);
            const replacementUser = this.requireUser(replacementSession.userId);
            replacementSession.lastUsedAt = now.toISOString();
            return {
              account: replacementAccount,
              user: replacementUser,
              session: sessionView(replacementSession),
              refreshToken: recentRotation.replacementRefreshToken,
              deviceSession: deviceSessionView(replacementSession, replacementSession.id, now)
            };
          }
        }
        this.revokeSessionFamily(matched.sessionFamilyId, "refresh_token_reuse", now);
        throw new Cp2Error(
          401,
          "auth_refresh_reuse_detected",
          "Refresh credential reuse was detected. Sign in again on this device."
        );
      }
      throw new Cp2Error(401, "auth_refresh_revoked", "The refresh session was revoked.");
    }
    if (
      Date.parse(matched.refreshExpiresAt) <= now.getTime() ||
      Date.parse(matched.inactivityExpiresAt) <= now.getTime() ||
      Date.parse(matched.absoluteExpiresAt) <= now.getTime()
    ) {
      this.revokeSessionFamily(matched.sessionFamilyId, "maximum_session_lifetime", now);
      throw new Cp2Error(401, "auth_refresh_expired", "The refresh session has expired.");
    }

    const account = this.requireAccount(matched.accountId);
    if ((account.status ?? "active") !== "active") {
      this.revokeSessionFamily(matched.sessionFamilyId, "account_status_changed", now);
    }
    this.requireAccountAuthenticationAllowed(account);
    const user = this.requireUser(matched.userId);
    const replacement = this.createSession(account, user, now);
    const replacementRecord = this.sessions.get(replacement.id)!;
    replacementRecord.sessionFamilyId = matched.sessionFamilyId;
    replacementRecord.absoluteExpiresAt = matched.absoluteExpiresAt;
    replacementRecord.inactivityExpiresAt = sessionInactivityExpiry(now, matched.absoluteExpiresAt);
    replacementRecord.refreshExpiresAt = replacementRecord.inactivityExpiresAt;
    replacementRecord.rotatedFromSessionId = matched.id;
    replacementRecord.authenticatedAt = matched.authenticatedAt;
    replacementRecord.pinVerifiedAt = matched.pinVerifiedAt;
    replacementRecord.deviceId = normalizeDeviceSessionValue(
      input.metadata.deviceId,
      matched.deviceId
    );
    replacementRecord.deviceName = normalizeDeviceSessionValue(
      input.metadata.deviceName,
      matched.deviceName
    );
    replacementRecord.platform = normalizeDeviceSessionValue(
      input.metadata.platform,
      matched.platform
    );
    replacementRecord.browserOrApp = normalizeDeviceSessionValue(
      input.metadata.browserOrApp,
      matched.browserOrApp
    );
    replacementRecord.userAgentHash = hashUserAgent(input.metadata.userAgent);
    replacementRecord.lastUsedAt = now.toISOString();
    replacementRecord.rotatedAt = null;

    matched.revokedAt = now.toISOString();
    matched.rotatedAt = now.toISOString();
    matched.revocationReason = "rotated";
    matched.lastUsedAt = now.toISOString();

    const refreshToken = this.consumeSessionRefreshToken(replacement.id);
    this.recentSessionRotations.set(matched.id, {
      replacementSessionId: replacement.id,
      replacementRefreshToken: refreshToken,
      rotatedAt: now.toISOString()
    });
    this.recordAuditEvent({
      type: "auth.session_refreshed",
      aggregateType: "session",
      aggregateId: replacement.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: { previousSessionId: matched.id, sessionFamilyId: matched.sessionFamilyId }
    });
    return {
      account,
      user,
      session: sessionView(replacementRecord),
      refreshToken,
      deviceSession: deviceSessionView(replacementRecord, replacementRecord.id, now)
    };
  }

  private pruneExpiredSessionRotations(now: Date): void {
    for (const [oldSessionId, rotation] of this.recentSessionRotations) {
      if (now.getTime() - Date.parse(rotation.rotatedAt) > refreshTokenReuseGracePeriodMs) {
        this.recentSessionRotations.delete(oldSessionId);
      }
    }
  }

  listDeviceSessions(sessionId: string | null, now = new Date()): DeviceSessionSummary[] {
    const current = this.requirePinVerifiedSession(sessionId, now);
    return [...this.sessions.values()]
      .filter((session) => session.accountId === current.account.id)
      .map((session) => deviceSessionView(session, current.session.id, now))
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  }

  revokeDeviceSession(input: {
    sessionId: string | null;
    targetSessionId: string;
    now?: Date;
  }): DeviceSessionSummary {
    const now = input.now ?? new Date();
    const current = this.requirePinVerifiedSession(input.sessionId, now);
    const target = this.sessions.get(input.targetSessionId);
    if (target === undefined || target.accountId !== current.account.id) {
      throw new Cp2Error(404, "auth_device_session_not_found", "Device session was not found.");
    }
    this.revokeSessionFamily(target.sessionFamilyId, "user_revoked", now);
    return deviceSessionView(target, current.session.id, now);
  }

  logout(sessionId: string | null, now = new Date()): boolean {
    if (sessionId === null) {
      return false;
    }

    const session = this.sessions.get(sessionId);

    if (session === undefined || session.revokedAt !== null) {
      return false;
    }

    this.revokeSessionFamily(session.sessionFamilyId, "logout", now);
    this.recordAuditEvent({
      type: "auth.session_revoked",
      aggregateType: "session",
      aggregateId: session.id,
      actorId: session.userId,
      occurredAt: now.toISOString(),
      payload: {
        accountId: session.accountId
      }
    });

    return true;
  }

  private revokeSessionFamily(familyId: string, reason: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.sessionFamilyId === familyId && session.revokedAt === null) {
        session.revokedAt = now.toISOString();
        session.revocationReason = reason;
      }
    }
  }

  logoutAll(sessionId: string | null, now = new Date()): { revoked: number } {
    const session = this.requireRecentlyAuthenticatedSession(sessionId, now);

    let revoked = 0;
    let recoveryCredentialsRevoked = 0;

    for (const candidate of this.sessions.values()) {
      if (candidate.accountId === session.account.id && candidate.revokedAt === null) {
        candidate.revokedAt = now.toISOString();
        revoked += 1;
      }
    }
    for (const credential of this.deviceBootstrapDomain.deviceRecoveryCredentialsMap.values()) {
      if (credential.accountId === session.account.id && credential.revokedAt === null) {
        credential.revokedAt = now.toISOString();
        credential.updatedAt = now.toISOString();
        if (credential.lastAssertionHash !== null) {
          this.deviceBootstrapDomain.deviceRecoverySessionCredentialsMap.delete(
            credential.lastAssertionHash
          );
        }
        recoveryCredentialsRevoked += 1;
      }
    }

    this.recordAuditEvent({
      type: "auth.sessions_revoked_all",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        revoked,
        recoveryCredentialsRevoked
      }
    });

    return { revoked };
  }

  setAccountPin(input: {
    sessionId: string | null;
    pin: string;
    mfaCode?: string;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    if (this.accountPinHashes.has(session.account.id)) {
      throw new Cp2Error(409, "pin_already_set", "A login PIN is already set for this account.");
    }
    this.verifyMfaForCredentialChange(session.account.id, input.mfaCode, now);
    const pin = normalizePin(input.pin);
    const pinHash = hashPin(session.account.id, pin);
    this.accountPinHashes.set(session.account.id, pinHash);
    // A first PIN created after a purpose-bound passkey ceremony completes that recovery action.
    // Clear the grant only after every setup precondition and credential write has succeeded. This
    // is a no-op for ordinary recently authenticated password/PIN sessions.
    this.passkeyDomain.consumePinRecoveryGrant(session.session.id);
    this.markSessionPinVerified(session.session.id, now);
    this.promoteAccountIdentityLevel(session.account.id, "strong");

    this.recordAuditEvent({
      type: "auth.pin_set",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  changeAccountPin(input: {
    sessionId: string | null;
    currentPin: string;
    pin: string;
    mfaCode?: string;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    this.verifyAccountPinForSession(session, input.currentPin, now);
    this.verifyMfaForCredentialChange(session.account.id, input.mfaCode, now);
    const pin = normalizePin(input.pin);
    this.accountPinHashes.set(session.account.id, hashPin(session.account.id, pin));

    this.recordAuditEvent({
      type: "auth.pin_changed",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  mergeCurrentDeviceAccountWithPin(
    ...args: Parameters<DeviceBootstrapDomain["mergeCurrentDeviceAccountWithPin"]>
  ): ReturnType<DeviceBootstrapDomain["mergeCurrentDeviceAccountWithPin"]> {
    return this.deviceBootstrapDomain.mergeCurrentDeviceAccountWithPin(...args);
  }

  private mergeDeviceAccountData(
    sourceAccountId: string,
    sourceUserId: string,
    targetAccountId: string,
    targetUserId: string
  ): void {
    const snapshot = this.snapshot();
    const sourceSessionIds = new Set(
      snapshot.sessions
        .filter((session) => session.accountId === sourceAccountId)
        .map((session) => session.id)
    );
    snapshot.accounts = snapshot.accounts.filter((account) => account.id !== sourceAccountId);
    snapshot.users = snapshot.users.filter((user) => user.id !== sourceUserId);
    snapshot.sessions = snapshot.sessions.filter((session) => !sourceSessionIds.has(session.id));
    snapshot.sessionContexts = snapshot.sessionContexts.filter(
      (context) => context.accountId !== sourceAccountId
    );
    snapshot.accountPinHashes = snapshot.accountPinHashes?.filter(
      (credential) => credential.accountId !== sourceAccountId
    );
    const merged = replaceExactStringReferences(
      snapshot,
      new Map([
        [sourceAccountId, targetAccountId],
        [sourceUserId, targetUserId]
      ])
    ) as Cp2Snapshot;
    this.hydrateSnapshot(merged);
  }

  private createAccountWithPin(
    channel: AuthChannel,
    rawDestination: string,
    rawPin: string,
    now: Date
  ): AuthSessionView {
    const destination = normalizeDestination(channel, rawDestination);

    if (this.resolveAnyIdentityAccount(channel, destination) !== undefined) {
      throw new Cp2Error(
        409,
        "account_exists",
        `An account already exists for this ${channel === "phone" ? "phone number" : "email address"}. Sign in with your PIN.`
      );
    }

    const pin = normalizePin(rawPin);
    pinHashSecret();
    const account = this.createAccount(channel, destination, now);
    const user = this.requireUser(this.userByAccount.get(account.id));
    const session = this.createSession(account, user, now);
    this.accountPinHashes.set(account.id, hashPin(account.id, pin));
    this.markSessionPinVerified(session.id, now);

    this.recordAuditEvent({
      type: "auth.pin_signup",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        channel,
        destination
      }
    });

    this.recordAuditEvent({
      type: "account.created",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        primaryAuthChannel: account.primaryAuthChannel,
        primaryAuthDestination: account.primaryAuthDestination
      }
    });

    return this.requireAnySession(session.id, now);
  }

  signupWithPhonePin(input: { destination: string; pin: string; now?: Date }): AuthSessionView {
    return this.createAccountWithPin(
      "phone",
      input.destination,
      input.pin,
      input.now ?? new Date()
    );
  }

  continueWithChannelPin(input: {
    channel: AuthChannel;
    destination: string;
    pin: string;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const destination = normalizeDestination(input.channel, input.destination);
    const pin = normalizePin(input.pin);
    const attemptKey = `login:${input.channel}:${destination}`;
    this.requirePinAttemptAllowed(attemptKey, now);
    const accountId = this.resolveIdentityAccount(input.channel, destination);

    if (accountId === undefined) {
      const session = this.createAccountWithPin(input.channel, destination, input.pin, now);
      return { ...session, isNewAccount: true };
    }

    const account = this.requireAccount(accountId);
    this.requireAccountAuthenticationAllowed(account);
    const user = this.requireUser(this.userByAccount.get(account.id));
    const pinHash = this.accountPinHashes.get(account.id);

    if (pinHash === undefined) {
      verifyPinHash("unknown-account", pin, dummyPinHash);
      this.recordFailedPinAttempt(attemptKey, now);
      throw new Cp2Error(
        401,
        "pin_not_configured",
        "This account signs in with a passkey or password. Use that, then set a PIN for faster sign-in next time."
      );
    }

    if (!this.verifyStoredPin(account.id, pin, pinHash)) {
      this.recordFailedPinAttempt(attemptKey, now);
      throw invalidLoginCredentialsError();
    }

    this.failedPinAttempts.delete(attemptKey);
    const session = this.createSession(account, user, now);
    this.markSessionPinVerified(session.id, now);
    this.recordAuditEvent({
      type: "auth.pin_login",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        channel: input.channel,
        destination
      }
    });

    return { ...this.requireAnySession(session.id, now), isNewAccount: false };
  }

  loginWithSokoIdPin(input: { sokoId: string; pin: string; now?: Date }): AuthSessionView {
    const now = input.now ?? new Date();
    const pin = normalizePin(input.pin);
    const normalizedSokoId = normalizeStorefrontLookupId(input.sokoId);
    const attemptKey = `login:store:${normalizedSokoId}`;
    this.requirePinAttemptAllowed(attemptKey, now);

    const business = isSokoStorefrontId(input.sokoId)
      ? [...this.businesses.values()].find(
          (candidate) => normalizeStorefrontLookupId(candidate.sokoId) === normalizedSokoId
        )
      : undefined;
    const membership =
      business === undefined
        ? undefined
        : [...this.memberships.values()].find(
            (candidate) => candidate.businessId === business.id && candidate.role === "owner"
          );

    if (
      business === undefined ||
      membership === undefined ||
      this.quarantinedBusinessIds.has(business.id)
    ) {
      verifyPinHash("unknown-account", pin, dummyPinHash);
      this.recordFailedPinAttempt(attemptKey, now);
      throw invalidLoginCredentialsError();
    }

    const user = this.requireUser(membership.userId);
    const account = this.requireAccount(user.accountId);
    this.requireAccountAuthenticationAllowed(account);
    const pinHash = this.accountPinHashes.get(account.id);

    if (pinHash === undefined) {
      verifyPinHash("unknown-account", pin, dummyPinHash);
      this.recordFailedPinAttempt(attemptKey, now);
      throw new Cp2Error(
        401,
        "pin_not_configured",
        "This store owner signs in with a passkey or password. Use that account's phone or email to sign in, then set a PIN for faster sign-in next time."
      );
    }

    if (!this.verifyStoredPin(account.id, pin, pinHash)) {
      this.recordFailedPinAttempt(attemptKey, now);
      throw invalidLoginCredentialsError();
    }

    this.failedPinAttempts.delete(attemptKey);
    const session = this.createSession(account, user, now);
    this.markSessionPinVerified(session.id, now);
    this.recordAuditEvent({
      type: "auth.pin_login",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        channel: "store_id",
        destination: normalizedSokoId
      }
    });

    return this.requireAnySession(session.id, now);
  }

  getAccountPinStatus(input: { sessionId: string | null; now?: Date }): { hasPin: boolean } {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);

    return {
      hasPin: this.accountPinHashes.has(session.account.id)
    };
  }

  getAccountCredentialStatus(input: { sessionId: string | null; now?: Date }): {
    hasPin: boolean;
    hasPassword: boolean;
  } {
    const session = this.requireAnySession(input.sessionId, input.now ?? new Date());
    return {
      hasPin: this.accountPinHashes.has(session.account.id),
      hasPassword: this.passwordCredentials.has(session.account.id)
    };
  }

  recoverAccountPin(input: { sessionId: string | null; pin: string; now?: Date }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    const pin = normalizePin(input.pin);

    if (!this.accountPinHashes.has(session.account.id)) {
      throw new Cp2Error(409, "pin_not_set", "Login PIN has not been set.");
    }

    this.accountPinHashes.set(session.account.id, hashPin(session.account.id, pin));
    this.markSessionPinVerified(session.session.id, now);

    this.recordAuditEvent({
      type: "auth.pin_recovered",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  recoverPhoneAccountPinWithPasskey(
    ...args: Parameters<PasskeyDomain["recoverPhoneAccountPinWithPasskey"]>
  ): ReturnType<PasskeyDomain["recoverPhoneAccountPinWithPasskey"]> {
    return this.passkeyDomain.recoverPhoneAccountPinWithPasskey(...args);
  }
  verifyAccountPin(input: { sessionId: string | null; pin: string; now?: Date }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    const pin = normalizePin(input.pin);
    const pinHash = this.accountPinHashes.get(session.account.id);
    const attemptKey = `verify:${session.account.id}`;

    if (pinHash === undefined) {
      throw new Cp2Error(404, "pin_not_set", "Login PIN has not been set.");
    }

    this.requirePinAttemptAllowed(attemptKey, now);
    if (!this.verifyStoredPin(session.account.id, pin, pinHash)) {
      this.recordFailedPinAttempt(attemptKey, now);
      throw new Cp2Error(401, "pin_invalid", "Login PIN is invalid.");
    }

    this.failedPinAttempts.delete(attemptKey);
    this.markSessionPinVerified(session.session.id, now);
    this.recordAuditEvent({
      type: "auth.pin_verified",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  loginWithAccountPin(input: {
    channel: AuthChannel;
    destination: string;
    pin: string;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const destination = normalizeDestination(input.channel, input.destination);
    const pin = normalizePin(input.pin);
    const attemptKey = `login:${input.channel}:${destination}`;
    this.requirePinAttemptAllowed(attemptKey, now);
    const accountId = this.resolveIdentityAccount(input.channel, destination);

    if (accountId === undefined) {
      verifyPinHash("unknown-account", pin, dummyPinHash);
      this.recordFailedPinAttempt(attemptKey, now);
      throw invalidLoginCredentialsError();
    }

    const account = this.requireAccount(accountId);
    this.requireAccountAuthenticationAllowed(account);
    const user = this.requireUser(this.userByAccount.get(account.id));
    const pinHash = this.accountPinHashes.get(account.id);

    if (pinHash === undefined) {
      verifyPinHash("unknown-account", pin, dummyPinHash);
      this.recordFailedPinAttempt(attemptKey, now);
      throw invalidLoginCredentialsError();
    }

    if (!this.verifyStoredPin(account.id, pin, pinHash)) {
      this.recordFailedPinAttempt(attemptKey, now);
      throw invalidLoginCredentialsError();
    }

    this.failedPinAttempts.delete(attemptKey);
    const session = this.createSession(account, user, now);
    this.markSessionPinVerified(session.id, now);
    this.recordAuditEvent({
      type: "auth.pin_login",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        channel: input.channel,
        destination
      }
    });

    return this.requireAnySession(session.id, now);
  }

  identifyAccount(input: { channel: AuthChannel; identifier: string }): {
    channel: AuthChannel;
    normalizedIdentifier: string;
    next: "signup" | "login";
  } {
    const normalizedIdentifier = normalizeDestination(input.channel, input.identifier);
    const accountId = this.resolveIdentityAccount(input.channel, normalizedIdentifier);
    return {
      channel: input.channel,
      normalizedIdentifier,
      next: accountId === undefined ? "signup" : "login"
    };
  }

  beginPhoneSignup(input: { phoneE164: string; now?: Date }): {
    transactionId: string;
    expiresAt: string;
  } {
    const now = input.now ?? new Date();
    const phoneE164 = normalizeDestination("phone", input.phoneE164);
    if (this.resolveIdentityAccount("phone", phoneE164) !== undefined) {
      throw new Cp2Error(409, "account_exists", "Continue to sign in.");
    }
    const transaction: AuthTransactionRecord = {
      id: randomUUID(),
      purpose: "signup",
      accountId: null,
      identifierType: "phone",
      identifierValue: phoneE164,
      providerChallengeId: null,
      verifiedAt: null,
      attempts: 0,
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      consumedAt: null,
      metadata: { phoneVerificationRequired: false },
      createdAt: now.toISOString()
    };
    this.authTransactions.set(transaction.id, transaction);
    this.recordSecurityEvent("auth.signup_started", null, "success", now, {
      identifierHash: securityCorrelationHash(phoneE164)
    });
    return { transactionId: transaction.id, expiresAt: transaction.expiresAt };
  }

  getAuthTransaction(
    transactionId: string,
    purpose: AuthTransactionRecord["purpose"],
    now = new Date()
  ): AuthTransactionRecord {
    return this.requireAuthTransaction(transactionId, purpose, now);
  }

  completePhoneSignup(input: {
    transactionId: string;
    displayName: string;
    password?: string;
    email?: string;
    termsAccepted: boolean;
    privacyAccepted: boolean;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const transaction = this.requireAuthTransaction(input.transactionId, "signup", now);
    if (!input.termsAccepted || !input.privacyAccepted) {
      throw new Cp2Error(
        400,
        "consent_required",
        "Accept the Terms and Privacy Policy to continue."
      );
    }
    const displayName = input.displayName.trim();
    if (displayName.length < 2 || displayName.length > 100) {
      throw new Cp2Error(400, "display_name_invalid", "Enter your display name.");
    }
    const phone = transaction.identifierValue!;
    if (this.resolveIdentityAccount("phone", phone) !== undefined) {
      throw new Cp2Error(409, "account_exists", "Continue to sign in.");
    }
    if (input.password !== undefined) validatePassword(input.password);
    const email =
      input.email === undefined || input.email.trim() === ""
        ? undefined
        : normalizeDestination("email", input.email);
    if (
      email !== undefined &&
      (this.identityAccountByValue.has(destinationAccountKey("email", email)) ||
        this.resolveIdentityAccount("email", email) !== undefined)
    ) {
      throw new Cp2Error(409, "identity_in_use", "That email cannot be linked to this account.");
    }

    const account = this.createAccount("phone", phone, now);
    const user = this.requireUser(this.userByAccount.get(account.id));
    const normalizedPhone = normalizeInternationalOwnerPhoneNumber(phone);
    Object.assign(user, {
      displayName,
      phoneNumberE164: phone,
      phoneCountryCode: normalizedPhone.country,
      phoneNationalNumber: normalizedPhone.nationalNumber,
      phoneVerificationStatus: "unverified" as const,
      phoneUpdatedAt: now.toISOString()
    });
    this.addAccountIdentity(account, user, "phone", phone, true, now, false);
    if (email !== undefined)
      this.addAccountIdentity(account, user, "email", email, false, now, false);
    if (input.password !== undefined) {
      this.passwordCredentials.set(
        account.id,
        createPasswordCredential(account.id, input.password, now)
      );
    }
    transaction.accountId = account.id;
    transaction.consumedAt = now.toISOString();
    const session = this.createSession(account, user, now);
    this.markSessionPinVerified(session.id, now);
    this.recordSecurityEvent("auth.signup_completed", account.id, "success", now, {
      emailAdded: email !== undefined,
      phoneVerified: false
    });
    return this.requireAnySession(session.id, now);
  }

  loginWithPassword(input: {
    channel: AuthChannel;
    identifier: string;
    password: string;
    now?: Date;
  }):
    | { mfaRequired: false; session: AuthSessionView }
    | { mfaRequired: true; transactionId: string; factors: string[]; expiresAt: string } {
    const now = input.now ?? new Date();
    const identifier = normalizeDestination(input.channel, input.identifier);
    const attemptKey = `password:${input.channel}:${identifier}`;
    this.requirePinAttemptAllowed(attemptKey, now);
    const accountId = this.resolveIdentityAccount(input.channel, identifier);
    const credential =
      accountId === undefined ? undefined : this.passwordCredentials.get(accountId);
    const valid =
      credential === undefined
        ? verifyPasswordHash("unknown-account", input.password, dummyPasswordHash) === "current"
        : verifyPasswordHash(accountId!, input.password, credential.passwordHash) !== "invalid";
    if (accountId === undefined || credential === undefined || !valid) {
      this.recordFailedPinAttempt(attemptKey, now);
      this.recordSecurityEvent("auth.login", null, "failure", now, {
        identifierHash: securityCorrelationHash(identifier)
      });
      throw invalidLoginCredentialsError();
    }
    this.failedPinAttempts.delete(attemptKey);
    const account = this.requireAccount(accountId);
    this.requireAccountAuthenticationAllowed(account);
    const factors = this.activeMfaFactors(accountId);
    if (factors.length > 0) {
      const transaction = this.createAuthTransaction("login_mfa", accountId, now);
      this.recordSecurityEvent("auth.mfa_requested", accountId, "success", now, {});
      return {
        mfaRequired: true,
        transactionId: transaction.id,
        factors: ["totp", "recovery_code"],
        expiresAt: transaction.expiresAt
      };
    }
    const user = this.requireUser(this.userByAccount.get(accountId));
    const sessionRecord = this.createSession(account, user, now);
    this.markSessionPinVerified(sessionRecord.id, now);
    this.recordSecurityEvent("auth.login", accountId, "success", now, { method: "password" });
    return { mfaRequired: false, session: this.requireAnySession(sessionRecord.id, now) };
  }

  setupTotp(input: { sessionId: string | null; now?: Date }): {
    factorId: string;
    secret: string;
    otpauthUri: string;
  } {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    const secret = base32Encode(randomBytes(20));
    const factor: MfaFactorRecord = {
      id: randomUUID(),
      accountId: session.account.id,
      type: "totp",
      secret: encryptOAuthToken(secret),
      verifiedAt: null,
      lastUsedStep: null,
      createdAt: now.toISOString(),
      disabledAt: null
    };
    this.mfaFactors.set(factor.id, factor);
    const issuer = encodeURIComponent("Soko.market");
    const label = encodeURIComponent(session.account.primaryAuthDestination);
    return {
      factorId: factor.id,
      secret,
      otpauthUri: `otpauth://totp/${issuer}:${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
    };
  }

  confirmTotp(input: { sessionId: string | null; factorId: string; code: string; now?: Date }): {
    enabled: true;
    recoveryCodes: string[];
  } {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    const factor = this.mfaFactors.get(input.factorId);
    if (
      !factor ||
      factor.accountId !== session.account.id ||
      factor.disabledAt !== null ||
      factor.verifiedAt !== null
    ) {
      throw new Cp2Error(400, "mfa_factor_invalid", "MFA setup is invalid or expired.");
    }
    const step = verifyTotp(decryptOAuthToken(factor.secret), input.code, now, null);
    if (step === null)
      throw new Cp2Error(401, "mfa_code_invalid", "The verification code is invalid.");
    factor.verifiedAt = now.toISOString();
    factor.lastUsedStep = step;
    const codes = this.replaceRecoveryCodes(session.account.id, now);
    this.recordSecurityEvent("auth.mfa_enabled", session.account.id, "success", now, {
      factorType: "totp"
    });
    return { enabled: true, recoveryCodes: codes };
  }

  verifyMfa(input: {
    transactionId: string;
    factor: "totp" | "recovery_code";
    code: string;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const transaction = this.requireAuthTransaction(input.transactionId, "login_mfa", now);
    const accountId = transaction.accountId!;
    let verified = false;
    if (input.factor === "totp") {
      const factor = this.activeMfaFactors(accountId)[0];
      if (factor !== undefined) {
        const step = verifyTotp(
          decryptOAuthToken(factor.secret),
          input.code,
          now,
          factor.lastUsedStep
        );
        if (step !== null) {
          factor.lastUsedStep = step;
          verified = true;
        }
      }
    } else {
      const codeHash = hashRecoveryCode(accountId, input.code);
      const recovery = [...this.recoveryCodes.values()].find(
        (item) =>
          item.accountId === accountId &&
          item.usedAt === null &&
          safeHashEqual(item.codeHash, codeHash)
      );
      if (recovery !== undefined) {
        recovery.usedAt = now.toISOString();
        verified = true;
      }
    }
    transaction.attempts += 1;
    if (!verified) {
      this.recordSecurityEvent("auth.mfa", accountId, "failure", now, {});
      throw new Cp2Error(401, "mfa_code_invalid", "The verification code is invalid.");
    }
    transaction.consumedAt = now.toISOString();
    const account = this.requireAccount(accountId);
    const user = this.requireUser(this.userByAccount.get(accountId));
    const sessionRecord = this.createSession(account, user, now);
    this.markSessionPinVerified(sessionRecord.id, now);
    this.recordSecurityEvent("auth.mfa", accountId, "success", now, { factor: input.factor });
    return this.requireAnySession(sessionRecord.id, now);
  }

  renamePasskey(
    ...args: Parameters<PasskeyDomain["renamePasskey"]>
  ): ReturnType<PasskeyDomain["renamePasskey"]> {
    return this.passkeyDomain.renamePasskey(...args);
  }
  beginPasskeyRegistration(
    ...args: Parameters<PasskeyDomain["beginPasskeyRegistration"]>
  ): ReturnType<PasskeyDomain["beginPasskeyRegistration"]> {
    return this.passkeyDomain.beginPasskeyRegistration(...args);
  }
  completePasskeyRegistration(
    ...args: Parameters<PasskeyDomain["completePasskeyRegistration"]>
  ): ReturnType<PasskeyDomain["completePasskeyRegistration"]> {
    return this.passkeyDomain.completePasskeyRegistration(...args);
  }
  beginPasskeyAuthentication(
    ...args: Parameters<PasskeyDomain["beginPasskeyAuthentication"]>
  ): ReturnType<PasskeyDomain["beginPasskeyAuthentication"]> {
    return this.passkeyDomain.beginPasskeyAuthentication(...args);
  }
  completePasskeyAuthentication(
    ...args: Parameters<PasskeyDomain["completePasskeyAuthentication"]>
  ): ReturnType<PasskeyDomain["completePasskeyAuthentication"]> {
    return this.passkeyDomain.completePasskeyAuthentication(...args);
  }
  listPasskeys(
    ...args: Parameters<PasskeyDomain["listPasskeys"]>
  ): ReturnType<PasskeyDomain["listPasskeys"]> {
    return this.passkeyDomain.listPasskeys(...args);
  }
  revokePasskey(
    ...args: Parameters<PasskeyDomain["revokePasskey"]>
  ): ReturnType<PasskeyDomain["revokePasskey"]> {
    return this.passkeyDomain.revokePasskey(...args);
  }
  createBusiness(input: {
    sessionId: string | null;
    name: string;
    language: SupportedLanguage;
    phoneNumber?: string;
    phoneCountry?: string;
    now?: Date;
  }): CreateBusinessResult {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);

    const name = input.name.trim();

    if (name.length < 2) {
      throw new Cp2Error(
        400,
        "business_name_invalid",
        "Business name must be at least 2 characters."
      );
    }

    const existingOwnedStore = [...this.memberships.values()].find(
      (membership) => membership.userId === session.user.id && membership.role === "owner"
    );
    if (existingOwnedStore !== undefined) {
      throw new Cp2Error(
        409,
        "store_already_registered",
        "This account has already registered a store."
      );
    }

    const currentUser = this.requireUser(session.user.id);
    const hasSavedPhone =
      typeof currentUser.phoneNumberE164 === "string" &&
      currentUser.phoneNumberE164.length > 0 &&
      currentUser.phoneVerificationStatus === "unverified";

    if (input.phoneNumber === undefined || input.phoneCountry === undefined) {
      if (!hasSavedPhone) {
        throw new Cp2Error(400, "phone_number_required", "Enter your phone number to continue.");
      }
    } else {
      this.requireRecentlyAuthenticatedSession(input.sessionId, now);
      this.applyOwnerPhoneIdentity({
        session,
        phoneNumber: input.phoneNumber,
        country: input.phoneCountry,
        source: "shop_registration",
        now
      });
    }

    const businessId = randomUUID();
    const sokoId = this.createGlobalShopId({
      businessName: name,
      ownerDisplayName: currentUser.displayName,
      destination: session.account.primaryAuthDestination
    });
    const business: BusinessSummary = {
      id: businessId,
      name,
      language: input.language,
      sokoId
    };
    const membership: MembershipSummary = {
      id: randomUUID(),
      businessId: business.id,
      userId: session.user.id,
      role: "owner"
    };

    this.businesses.set(business.id, business);
    this.memberships.set(membership.id, membership);
    const currentOwner = this.requireUser(session.user.id);
    this.users.set(session.user.id, {
      ...currentOwner,
      language: input.language
    });
    this.recordSyncChange({
      accountId: session.account.id,
      collection: "shops",
      entityId: business.id,
      operation: "upsert",
      shopId: business.id,
      entity: { business, membership },
      now
    });

    this.recordAuditEvent({
      type: "business.created",
      aggregateType: "business",
      aggregateId: business.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        name: business.name,
        language: business.language,
        sokoId: business.sokoId
      }
    });

    this.recordAuditEvent({
      type: "business.storefront_id_created",
      aggregateType: "business",
      aggregateId: business.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        sokoId: business.sokoId,
        namespace: "soko"
      }
    });

    this.recordAuditEvent({
      type: "membership.created",
      aggregateType: "membership",
      aggregateId: membership.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: membership.businessId,
        userId: membership.userId,
        role: membership.role
      }
    });

    return {
      business,
      membership
    };
  }

  updateOwnerPhone(input: {
    sessionId: string | null;
    phoneNumber: string;
    country: string;
    now?: Date;
  }): OwnerPhoneIdentityResult {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    this.enforcePhoneUpdateRateLimit(session.account.id, now);

    return {
      user: this.applyOwnerPhoneIdentity({
        session,
        phoneNumber: input.phoneNumber,
        country: input.country,
        source: "shop_registration",
        now
      })
    };
  }

  updateOwnDisplayName(input: { sessionId: string | null; displayName: string; now?: Date }): {
    user: UserSummary;
  } {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const displayName = input.displayName.trim();

    if (displayName.length < 2 || displayName.length > 100) {
      throw new Cp2Error(
        400,
        "display_name_invalid",
        "Enter a display name between 2 and 100 characters."
      );
    }

    const current = this.requireUser(session.user.id);
    const updated: UserSummary = { ...current, displayName };
    this.users.set(updated.id, updated);
    this.recordAuditEvent({
      type: "user.display_name_updated",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return { user: updated };
  }

  listAccountShops(input: {
    sessionId: string | null;
    now?: Date;
  }): Array<{ business: BusinessSummary; membership: MembershipSummary }> {
    const session = this.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());

    return [...this.memberships.values()]
      .filter(
        (membership) =>
          membership.userId === session.user.id &&
          !this.quarantinedBusinessIds.has(membership.businessId)
      )
      .map((membership) => {
        const business = this.businesses.get(membership.businessId);

        if (business === undefined) {
          throw new Cp2Error(500, "business_missing", "Membership business state is inconsistent.");
        }

        return { business, membership };
      });
  }

  pullSyncChanges(input: {
    sessionId: string | null;
    cursor: string | null;
    limit?: number;
    now?: Date;
  }): SyncPullPage {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    this.pruneExpiredSyncTombstones(now);
    const accountId = session.account.id;
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const changes = this.syncChanges
      .filter((change) => change.accountId === accountId)
      .sort((left, right) => left.sequence - right.sequence);
    const originCursor = syncOriginCursor(accountId);
    let startIndex = 0;

    if (input.cursor !== null && input.cursor !== originCursor) {
      const cursorIndex = changes.findIndex((change) => change.cursor === input.cursor);
      if (cursorIndex < 0) {
        throw new Cp2Error(
          409,
          "sync_cursor_invalid",
          "The sync cursor is invalid or has expired. Start a full account catch-up."
        );
      }
      startIndex = cursorIndex + 1;
    }

    const pageChanges = changes.slice(startIndex, startIndex + limit);
    const nextCursor = pageChanges.at(-1)?.cursor ?? input.cursor ?? originCursor;

    return {
      accountId,
      fromCursor: input.cursor,
      nextCursor,
      changes: pageChanges,
      hasMore: startIndex + pageChanges.length < changes.length,
      serverTime: now.toISOString()
    };
  }

  createMcpAccessToken(
    ...args: Parameters<McpTokensDomain["createMcpAccessToken"]>
  ): ReturnType<McpTokensDomain["createMcpAccessToken"]> {
    return this.mcpTokensDomain.createMcpAccessToken(...args);
  }
  listMcpAccessTokens(
    ...args: Parameters<McpTokensDomain["listMcpAccessTokens"]>
  ): ReturnType<McpTokensDomain["listMcpAccessTokens"]> {
    return this.mcpTokensDomain.listMcpAccessTokens(...args);
  }
  revokeMcpAccessToken(
    ...args: Parameters<McpTokensDomain["revokeMcpAccessToken"]>
  ): ReturnType<McpTokensDomain["revokeMcpAccessToken"]> {
    return this.mcpTokensDomain.revokeMcpAccessToken(...args);
  }
  authenticateMcpAccessToken(
    ...args: Parameters<McpTokensDomain["authenticateMcpAccessToken"]>
  ): ReturnType<McpTokensDomain["authenticateMcpAccessToken"]> {
    return this.mcpTokensDomain.authenticateMcpAccessToken(...args);
  }
  listExternalConnections(
    ...args: Parameters<ExternalConnectionsDomain["list"]>
  ): ReturnType<ExternalConnectionsDomain["list"]> {
    return this.externalConnectionsDomain.list(...args);
  }
  connectExternalConnection(
    ...args: Parameters<ExternalConnectionsDomain["connect"]>
  ): ReturnType<ExternalConnectionsDomain["connect"]> {
    return this.externalConnectionsDomain.connect(...args);
  }
  disconnectExternalConnection(
    ...args: Parameters<ExternalConnectionsDomain["disconnect"]>
  ): ReturnType<ExternalConnectionsDomain["disconnect"]> {
    return this.externalConnectionsDomain.disconnect(...args);
  }
  /**
   * Internal-only accessor for server-side registry adapters (not a route). Never call this from
   * a route handler directly - go through connectExternalConnection/disconnectExternalConnection/
   * listExternalConnections for anything a browser can trigger.
   */
  resolveExternalConnectionToken(
    ...args: Parameters<ExternalConnectionsDomain["resolveToken"]>
  ): ReturnType<ExternalConnectionsDomain["resolveToken"]> {
    return this.externalConnectionsDomain.resolveToken(...args);
  }

  assertMcpShopAccess(principal: McpPrincipal, shopId: string, now = new Date()): void {
    this.requireMcpBusinessAccess(principal, shopId, "business:read", now);
  }

  listAccountShopsForMcp(input: {
    principal: McpPrincipal;
    now?: Date;
  }): Array<{ business: BusinessSummary; membership: MembershipSummary }> {
    const now = input.now ?? new Date();
    this.requireIntegrationPrincipal({ ...input.principal, now });
    return [...this.memberships.values()]
      .filter(
        (membership) =>
          membership.userId === input.principal.userId &&
          (input.principal.shopId === null || membership.businessId === input.principal.shopId) &&
          !this.quarantinedBusinessIds.has(membership.businessId)
      )
      .map((membership) => {
        this.requireMcpBusinessAccess(input.principal, membership.businessId, "business:read", now);
        const business = this.businesses.get(membership.businessId);
        if (business === undefined) {
          throw new Cp2Error(500, "business_missing", "Membership business state is inconsistent.");
        }
        return { business, membership };
      });
  }

  pullSyncChangesForMcp(input: {
    principal: McpPrincipal;
    cursor: string | null;
    limit?: number;
    now?: Date;
  }): SyncPullPage {
    const now = input.now ?? new Date();
    this.requireIntegrationPrincipal({ ...input.principal, now });
    this.pruneExpiredSyncTombstones(now);
    const accountId = input.principal.accountId;
    const readableBusinessIds = new Set(
      [...this.memberships.values()]
        .filter(
          (membership) =>
            membership.userId === input.principal.userId &&
            !this.quarantinedBusinessIds.has(membership.businessId)
        )
        .filter((membership) => roleCan(membership.role, "business:read"))
        .map((membership) => membership.businessId)
    );
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const changes = this.syncChanges
      .filter(
        (change) =>
          change.accountId === accountId &&
          (change.shopId === null || readableBusinessIds.has(change.shopId)) &&
          (input.principal.shopId === null || change.shopId === input.principal.shopId)
      )
      .sort((left, right) => left.sequence - right.sequence);
    const originCursor = syncOriginCursor(accountId);
    let startIndex = 0;
    if (input.cursor !== null && input.cursor !== originCursor) {
      const cursorIndex = changes.findIndex((change) => change.cursor === input.cursor);
      if (cursorIndex < 0) {
        throw new Cp2Error(
          409,
          "sync_cursor_invalid",
          "The sync cursor is invalid or has expired. Start a full account catch-up."
        );
      }
      startIndex = cursorIndex + 1;
    }
    const pageChanges = changes.slice(startIndex, startIndex + limit);
    return {
      accountId,
      fromCursor: input.cursor,
      nextCursor: pageChanges.at(-1)?.cursor ?? input.cursor ?? originCursor,
      changes: pageChanges,
      hasMore: startIndex + pageChanges.length < changes.length,
      serverTime: now.toISOString()
    };
  }

  queryCatalogueForMcp(input: {
    principal: McpPrincipal;
    businessId: string;
    query: string;
    limit?: number;
    now?: Date;
  }): CatalogueQueryResult {
    return this.mcpPrincipalContext.run(input.principal, () =>
      this.salesDomain.queryCatalogue({
        sessionId: null,
        businessId: input.businessId,
        query: input.query,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.now === undefined ? {} : { now: input.now })
      })
    );
  }

  createRuntimeTurnForMcp(
    input: Omit<Parameters<AgentRuntimeDomain["createRuntimeTurn"]>[0], "sessionId"> & {
      principal: McpPrincipal;
    }
  ): ReturnType<AgentRuntimeDomain["createRuntimeTurn"]> {
    const { principal, ...turn } = input;
    return this.mcpPrincipalContext.run(principal, () =>
      this.agentRuntimeDomain.createRuntimeTurn({ ...turn, sessionId: null })
    );
  }

  subscribeSyncChanges(input: {
    sessionId: string | null;
    listener: (event: SyncRealtimeChangesAvailableEvent) => void;
    now?: Date;
  }): () => void {
    const session = this.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());
    const accountId = session.account.id;
    const listeners = this.syncChangeListeners.get(accountId) ?? new Set();
    listeners.add(input.listener);
    this.syncChangeListeners.set(accountId, listeners);

    return () => {
      listeners.delete(input.listener);
      if (listeners.size === 0) {
        this.syncChangeListeners.delete(accountId);
      }
    };
  }

  publishExternalSyncChange(event: SyncRealtimeChangesAvailableEvent): void {
    for (const listener of this.syncChangeListeners.get(event.accountId) ?? []) {
      try {
        listener(event);
      } catch {
        // The durable cursor journal remains authoritative when a listener fails.
      }
    }
  }

  getSokoSessionContext(input: {
    sessionId: string | null;
    conversationId?: string;
    now?: Date;
  }): SokoSessionContext {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const context = this.ensureSokoSessionContext(session, now, input.conversationId);
    return this.sokoSessionContextView(session, context, now);
  }

  updateSokoSessionContext(input: {
    sessionId: string | null;
    mode?: SokoMode;
    activeShopId?: string | null;
    activeSurface?: SokoChatSurface;
    conversationId?: string;
    expectedSessionVersion?: number;
    now?: Date;
  }): SokoSessionContext {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    this.requireAccountNotPendingDeletion(session.account.id, now);
    // input.conversationId selects which conversation's context row to read/mutate (defaults to
    // the account's personal conversation, same as today). It does not repoint an existing row at
    // a different conversation - each conversation keeps its own row, keyed by
    // sessionContextKey(accountId, conversationId). See docs/frontend/frontend.md Phase 2.
    const current = this.ensureSokoSessionContext(session, now, input.conversationId);
    const mode = input.mode ?? current.mode;
    const activeShopId =
      input.activeShopId === undefined ? current.activeShopId : input.activeShopId;
    const activeSurface = input.activeSurface ?? current.activeSurface;

    if (
      input.expectedSessionVersion !== undefined &&
      input.expectedSessionVersion !== current.sessionVersion
    ) {
      throw new Cp2Error(
        409,
        "session_context_conflict",
        "Session context changed on another client. Refresh before retrying."
      );
    }

    if (activeShopId !== null) {
      this.requireMembership(activeShopId, session.user.id);
    }

    if (mode === "seller" && activeShopId === null) {
      throw new Cp2Error(409, "active_shop_required", "Seller mode requires an active shop.");
    }

    if (sellerOnlySurfaces.has(activeSurface) && mode !== "seller") {
      throw new Cp2Error(
        400,
        "surface_mode_invalid",
        "This surface is only available in seller mode."
      );
    }

    // ensureSokoSessionContext already resolved and validated the target conversation.
    const conversationId = current.conversationId;
    const next: StoredSokoSessionContext = {
      ...current,
      accountId: session.account.id,
      activeShopId,
      activeSurface,
      conversationId,
      mode,
      sessionVersion: current.sessionVersion + 1,
      updatedAt: now.toISOString()
    };
    this.sessionContexts.set(this.sessionContextKey(session.account.id, conversationId), next);
    this.recordSyncChange({
      accountId: session.account.id,
      collection: "session_context",
      entityId: conversationId,
      operation: "upsert",
      shopId: next.activeShopId,
      entity: next,
      now
    });
    this.recordAuditEvent({
      type: "session.context_updated",
      aggregateType: "session",
      aggregateId: session.session.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        activeShopId: next.activeShopId,
        activeSurface: next.activeSurface,
        conversationId: next.conversationId,
        mode: next.mode,
        sessionVersion: next.sessionVersion
      }
    });

    return this.sokoSessionContextView(session, next, now);
  }

  createConversation(
    ...args: Parameters<MessagingDomain["createConversation"]>
  ): ReturnType<MessagingDomain["createConversation"]> {
    return this.messagingDomain.createConversation(...args);
  }
  createProviderConversation(
    ...args: Parameters<MessagingDomain["createProviderConversation"]>
  ): ReturnType<MessagingDomain["createProviderConversation"]> {
    return this.messagingDomain.createProviderConversation(...args);
  }
  listChannelProviderReadiness(
    ...args: Parameters<MessagingDomain["listChannelProviderReadiness"]>
  ): ReturnType<MessagingDomain["listChannelProviderReadiness"]> {
    return this.messagingDomain.listChannelProviderReadiness(...args);
  }
  registerNativeSmsDevice(
    ...args: Parameters<MessagingDomain["registerNativeSmsDevice"]>
  ): ReturnType<MessagingDomain["registerNativeSmsDevice"]> {
    return this.messagingDomain.registerNativeSmsDevice(...args);
  }
  listNativeSmsDevices(
    ...args: Parameters<MessagingDomain["listNativeSmsDevices"]>
  ): ReturnType<MessagingDomain["listNativeSmsDevices"]> {
    return this.messagingDomain.listNativeSmsDevices(...args);
  }
  listNativeSmsBusinesses(
    ...args: Parameters<MessagingDomain["listNativeSmsBusinesses"]>
  ): ReturnType<MessagingDomain["listNativeSmsBusinesses"]> {
    return this.messagingDomain.listNativeSmsBusinesses(...args);
  }
  revokeNativeSmsDevice(
    ...args: Parameters<MessagingDomain["revokeNativeSmsDevice"]>
  ): ReturnType<MessagingDomain["revokeNativeSmsDevice"]> {
    return this.messagingDomain.revokeNativeSmsDevice(...args);
  }
  fetchNativeSmsCommands(
    ...args: Parameters<MessagingDomain["fetchNativeSmsCommands"]>
  ): ReturnType<MessagingDomain["fetchNativeSmsCommands"]> {
    return this.messagingDomain.fetchNativeSmsCommands(...args);
  }
  acknowledgeNativeSmsCommand(
    ...args: Parameters<MessagingDomain["acknowledgeNativeSmsCommand"]>
  ): ReturnType<MessagingDomain["acknowledgeNativeSmsCommand"]> {
    return this.messagingDomain.acknowledgeNativeSmsCommand(...args);
  }
  reportNativeSmsCommandResult(
    ...args: Parameters<MessagingDomain["reportNativeSmsCommandResult"]>
  ): ReturnType<MessagingDomain["reportNativeSmsCommandResult"]> {
    return this.messagingDomain.reportNativeSmsCommandResult(...args);
  }
  ingestNativeSmsMessage(
    ...args: Parameters<MessagingDomain["ingestNativeSmsMessage"]>
  ): ReturnType<MessagingDomain["ingestNativeSmsMessage"]> {
    return this.messagingDomain.ingestNativeSmsMessage(...args);
  }
  listConnectedMailboxProviders(
    ...args: Parameters<MessagingDomain["listConnectedMailboxProviders"]>
  ): ReturnType<MessagingDomain["listConnectedMailboxProviders"]> {
    return this.messagingDomain.listConnectedMailboxProviders(...args);
  }
  beginConnectedMailboxOAuth(
    ...args: Parameters<MessagingDomain["beginConnectedMailboxOAuth"]>
  ): ReturnType<MessagingDomain["beginConnectedMailboxOAuth"]> {
    return this.messagingDomain.beginConnectedMailboxOAuth(...args);
  }
  completeConnectedMailboxOAuth(
    ...args: Parameters<MessagingDomain["completeConnectedMailboxOAuth"]>
  ): ReturnType<MessagingDomain["completeConnectedMailboxOAuth"]> {
    return this.messagingDomain.completeConnectedMailboxOAuth(...args);
  }
  listConnectedMailboxes(
    ...args: Parameters<MessagingDomain["listConnectedMailboxes"]>
  ): ReturnType<MessagingDomain["listConnectedMailboxes"]> {
    return this.messagingDomain.listConnectedMailboxes(...args);
  }
  updateConnectedMailbox(
    ...args: Parameters<MessagingDomain["updateConnectedMailbox"]>
  ): ReturnType<MessagingDomain["updateConnectedMailbox"]> {
    return this.messagingDomain.updateConnectedMailbox(...args);
  }
  disconnectConnectedMailbox(
    ...args: Parameters<MessagingDomain["disconnectConnectedMailbox"]>
  ): ReturnType<MessagingDomain["disconnectConnectedMailbox"]> {
    return this.messagingDomain.disconnectConnectedMailbox(...args);
  }
  syncConnectedMailbox(
    ...args: Parameters<MessagingDomain["syncConnectedMailbox"]>
  ): ReturnType<MessagingDomain["syncConnectedMailbox"]> {
    return this.messagingDomain.syncConnectedMailbox(...args);
  }
  syncDueConnectedMailboxes(
    ...args: Parameters<MessagingDomain["syncDueConnectedMailboxes"]>
  ): ReturnType<MessagingDomain["syncDueConnectedMailboxes"]> {
    return this.messagingDomain.syncDueConnectedMailboxes(...args);
  }
  createConnectedEmailConversation(
    ...args: Parameters<MessagingDomain["createConnectedEmailConversation"]>
  ): ReturnType<MessagingDomain["createConnectedEmailConversation"]> {
    return this.messagingDomain.createConnectedEmailConversation(...args);
  }
  listCustomerChannelEndpoints(
    ...args: Parameters<MessagingDomain["listCustomerChannelEndpoints"]>
  ): ReturnType<MessagingDomain["listCustomerChannelEndpoints"]> {
    return this.messagingDomain.listCustomerChannelEndpoints(...args);
  }
  createChannelIdentityLinkGrant(
    ...args: Parameters<MessagingDomain["createChannelIdentityLinkGrant"]>
  ): ReturnType<MessagingDomain["createChannelIdentityLinkGrant"]> {
    return this.messagingDomain.createChannelIdentityLinkGrant(...args);
  }
  ingestChannelWebhook(
    ...args: Parameters<MessagingDomain["ingestChannelWebhook"]>
  ): ReturnType<MessagingDomain["ingestChannelWebhook"]> {
    return this.messagingDomain.ingestChannelWebhook(...args);
  }
  sendChannelMessage(
    ...args: Parameters<MessagingDomain["sendChannelMessage"]>
  ): ReturnType<MessagingDomain["sendChannelMessage"]> {
    return this.messagingDomain.sendChannelMessage(...args);
  }
  ingestProviderMessage(
    ...args: Parameters<MessagingDomain["ingestProviderMessage"]>
  ): ReturnType<MessagingDomain["ingestProviderMessage"]> {
    return this.messagingDomain.ingestProviderMessage(...args);
  }
  getMarketplaceIntroState(input: {
    sessionId: string | null;
    businessId?: string | null;
    now?: Date;
  }): MarketplaceIntroStateSummary {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const businessId = input.businessId ?? null;

    if (businessId !== null) {
      this.requireMembership(businessId, session.user.id);
    }

    const key = marketplaceIntroStateKey(session.account.id, businessId);
    return (
      this.marketplaceIntroStates.get(key) ?? {
        accountId: session.account.id,
        userId: session.user.id,
        businessId,
        completedAt: null,
        updatedAt: now.toISOString()
      }
    );
  }

  completeMarketplaceIntro(input: {
    sessionId: string | null;
    businessId?: string | null;
    now?: Date;
  }): MarketplaceIntroStateSummary {
    const now = input.now ?? new Date();
    const current = this.getMarketplaceIntroState(input);
    const completed: MarketplaceIntroStateSummary = {
      ...current,
      completedAt: current.completedAt ?? now.toISOString(),
      updatedAt: now.toISOString()
    };
    this.marketplaceIntroStates.set(
      marketplaceIntroStateKey(completed.accountId, completed.businessId),
      completed
    );
    this.recordAuditEvent({
      type: "marketplace.intro_completed",
      aggregateType: "marketplace_intro",
      aggregateId: marketplaceIntroStateKey(completed.accountId, completed.businessId),
      actorId: completed.userId,
      occurredAt: now.toISOString(),
      payload: { businessId: completed.businessId }
    });
    return completed;
  }

  listAiModels(
    ...args: Parameters<AgentRuntimeDomain["listAiModels"]>
  ): ReturnType<AgentRuntimeDomain["listAiModels"]> {
    return this.agentRuntimeDomain.listAiModels(...args);
  }
  getActiveAiModel(
    ...args: Parameters<AgentRuntimeDomain["getActiveAiModel"]>
  ): ReturnType<AgentRuntimeDomain["getActiveAiModel"]> {
    return this.agentRuntimeDomain.getActiveAiModel(...args);
  }
  activateAiModel(
    ...args: Parameters<AgentRuntimeDomain["activateAiModel"]>
  ): ReturnType<AgentRuntimeDomain["activateAiModel"]> {
    return this.agentRuntimeDomain.activateAiModel(...args);
  }

  /** In-process, state-only resolver. It never performs a network probe. */
  resolveRuntimeBinding(conversationId: string): ResolvedNativeRuntimeBinding {
    const conversation = this.messagingDomain.conversationsMap.get(conversationId);
    if (conversation === undefined) {
      throw new Cp2Error(404, "RUNTIME_CONVERSATION_NOT_FOUND", "Conversation was not found.");
    }
    const businessId = conversation.activeShopId ?? "global";
    return this.nativeRuntimeBindings.resolveRuntimeBinding(
      { conversationId, businessId, agentId: businessId },
      this.messagingDomain.conversationsMap
    );
  }

  // Assigns/swaps the primary model for the global default runtime slot - the provider-neutral
  // replacement for the old hardcoded openai-fast activation. Any catalog model on any execution
  // target is accepted; calling this again with a different model swaps it in place without
  // changing the binding's id or any conversation bound to it. See docs/architecture/
  // provider-neutral-runtime.md.
  activateGlobalDefaultModel(input: {
    model: AiModelSummary;
    executionTarget: ModelExecutionTarget;
    checkedAt: string;
    updatedBy: string;
  }): NativeRuntimeBindingSummary {
    return this.nativeRuntimeBindings.activateGlobalDefaultModel(input);
  }

  getActiveAgentModelBinding(
    ...args: Parameters<AgentRuntimeDomain["getActiveAgentModelBinding"]>
  ): ReturnType<AgentRuntimeDomain["getActiveAgentModelBinding"]> {
    return this.agentRuntimeDomain.getActiveAgentModelBinding(...args);
  }
  getAgentRuntimeHarness(
    ...args: Parameters<AgentRuntimeDomain["getAgentRuntimeHarness"]>
  ): ReturnType<AgentRuntimeDomain["getAgentRuntimeHarness"]> {
    return this.agentRuntimeDomain.getAgentRuntimeHarness(...args);
  }
  removeAgentModelBinding(
    ...args: Parameters<AgentRuntimeDomain["removeAgentModelBinding"]>
  ): ReturnType<AgentRuntimeDomain["removeAgentModelBinding"]> {
    return this.agentRuntimeDomain.removeAgentModelBinding(...args);
  }
  testAgentModel(
    ...args: Parameters<AgentRuntimeDomain["testAgentModel"]>
  ): ReturnType<AgentRuntimeDomain["testAgentModel"]> {
    return this.agentRuntimeDomain.testAgentModel(...args);
  }
  activateAgentModel(
    ...args: Parameters<AgentRuntimeDomain["activateAgentModel"]>
  ): ReturnType<AgentRuntimeDomain["activateAgentModel"]> {
    return this.agentRuntimeDomain.activateAgentModel(...args);
  }
  listInstalledAgentModels(
    ...args: Parameters<AgentRuntimeDomain["listInstalledAgentModels"]>
  ): ReturnType<AgentRuntimeDomain["listInstalledAgentModels"]> {
    return this.agentRuntimeDomain.listInstalledAgentModels(...args);
  }

  async installAccountOssAgentManifest(input: {
    sessionId: string | null;
    agent: OssAgentSummary;
    installedAt?: string;
    now?: Date;
  }): Promise<InstalledOssAgentManifestSummary> {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    assertSafeAccountAgentManifest(input.agent);
    const manifest = copyAgentManifest({
      accountId: session.account.id,
      userId: session.user.id,
      agent: input.agent,
      installedAt: input.installedAt ?? now.toISOString()
    });
    await this.accountAiAssetStore.putAgentManifest(manifest);
    return manifest;
  }

  async listAccountOssAgentManifests(input: {
    sessionId: string | null;
    now?: Date;
  }): Promise<InstalledOssAgentManifestSummary[]> {
    const session = this.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());
    return this.accountAiAssetStore.listAgentManifests(session.account.id, session.user.id);
  }

  async beginAccountModelArtifact(input: {
    sessionId: string | null;
    model: Omit<InstalledAgentModelSummary, "accountId" | "userId">;
    now?: Date;
  }): Promise<CloudModelArtifactSummary> {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const model = normalizeInstalledAgentModel(input.model, session.account.id, session.user.id);
    if (model.installationStatus !== "INSTALLED" || !model.commercialUseAllowed) {
      throw new Cp2Error(
        409,
        "model_artifact_not_usable",
        "Only a completed, commercially usable model installation can be saved to the account."
      );
    }
    return this.accountAiAssetStore.beginModelArtifact({
      accountId: session.account.id,
      userId: session.user.id,
      model,
      now: now.toISOString()
    });
  }

  async putAccountModelArtifactChunk(input: {
    sessionId: string | null;
    artifactId: string;
    chunkIndex: number;
    bytes: Buffer;
    now?: Date;
  }): Promise<{ stored: true }> {
    const session = this.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());
    if (input.bytes.byteLength > modelArtifactChunkSizeBytes) {
      throw new Cp2Error(413, "model_artifact_chunk_too_large", "The model chunk is too large.");
    }
    try {
      await this.accountAiAssetStore.putModelArtifactChunk({
        artifactId: input.artifactId,
        accountId: session.account.id,
        userId: session.user.id,
        chunkIndex: input.chunkIndex,
        bytes: input.bytes
      });
    } catch (error) {
      throw accountAiAssetError(error);
    }
    return { stored: true };
  }

  async completeAccountModelArtifact(input: {
    sessionId: string | null;
    artifactId: string;
    now?: Date;
  }): Promise<CloudModelArtifactSummary> {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    try {
      return await this.accountAiAssetStore.completeModelArtifact({
        artifactId: input.artifactId,
        accountId: session.account.id,
        userId: session.user.id,
        now: now.toISOString()
      });
    } catch (error) {
      throw accountAiAssetError(error);
    }
  }

  async listAccountModelArtifacts(input: {
    sessionId: string | null;
    now?: Date;
  }): Promise<CloudModelArtifactSummary[]> {
    const session = this.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());
    return this.accountAiAssetStore.listModelArtifacts(session.account.id, session.user.id);
  }

  async getAccountModelArtifactChunk(input: {
    sessionId: string | null;
    artifactId: string;
    chunkIndex: number;
    now?: Date;
  }): Promise<Buffer> {
    const session = this.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());
    try {
      const bytes = await this.accountAiAssetStore.getModelArtifactChunk({
        artifactId: input.artifactId,
        accountId: session.account.id,
        userId: session.user.id,
        chunkIndex: input.chunkIndex
      });
      if (bytes === null) {
        throw new Cp2Error(404, "model_artifact_chunk_not_found", "Model chunk was not found.");
      }
      return bytes;
    } catch (error) {
      if (error instanceof Cp2Error) throw error;
      throw accountAiAssetError(error);
    }
  }
  registerInstalledAgentModel(
    ...args: Parameters<AgentRuntimeDomain["registerInstalledAgentModel"]>
  ): ReturnType<AgentRuntimeDomain["registerInstalledAgentModel"]> {
    return this.agentRuntimeDomain.registerInstalledAgentModel(...args);
  }
  validateInstalledAgentModel(
    ...args: Parameters<AgentRuntimeDomain["validateInstalledAgentModel"]>
  ): ReturnType<AgentRuntimeDomain["validateInstalledAgentModel"]> {
    return this.agentRuntimeDomain.validateInstalledAgentModel(...args);
  }
  getAgentProfile(
    ...args: Parameters<AgentRuntimeDomain["getAgentProfile"]>
  ): ReturnType<AgentRuntimeDomain["getAgentProfile"]> {
    return this.agentRuntimeDomain.getAgentProfile(...args);
  }
  updateAgentProfile(
    ...args: Parameters<AgentRuntimeDomain["updateAgentProfile"]>
  ): ReturnType<AgentRuntimeDomain["updateAgentProfile"]> {
    return this.agentRuntimeDomain.updateAgentProfile(...args);
  }
  getAgentRuntime(
    ...args: Parameters<AgentRuntimeDomain["getAgentRuntime"]>
  ): ReturnType<AgentRuntimeDomain["getAgentRuntime"]> {
    return this.agentRuntimeDomain.getAgentRuntime(...args);
  }
  listAgentRuntimeVersions(
    ...args: Parameters<AgentRuntimeDomain["listAgentRuntimeVersions"]>
  ): ReturnType<AgentRuntimeDomain["listAgentRuntimeVersions"]> {
    return this.agentRuntimeDomain.listAgentRuntimeVersions(...args);
  }
  rollbackAgentRuntimeVersion(
    ...args: Parameters<AgentRuntimeDomain["rollbackAgentRuntimeVersion"]>
  ): ReturnType<AgentRuntimeDomain["rollbackAgentRuntimeVersion"]> {
    return this.agentRuntimeDomain.rollbackAgentRuntimeVersion(...args);
  }
  getAgentRuntimeReadiness(
    ...args: Parameters<AgentRuntimeDomain["getAgentRuntimeReadiness"]>
  ): ReturnType<AgentRuntimeDomain["getAgentRuntimeReadiness"]> {
    return this.agentRuntimeDomain.getAgentRuntimeReadiness(...args);
  }
  getEffectiveRuntime(
    ...args: Parameters<AgentRuntimeDomain["getEffectiveRuntime"]>
  ): ReturnType<AgentRuntimeDomain["getEffectiveRuntime"]> {
    return this.agentRuntimeDomain.getEffectiveRuntime(...args);
  }
  listAgentContextSources(
    ...args: Parameters<AgentRuntimeDomain["listAgentContextSources"]>
  ): ReturnType<AgentRuntimeDomain["listAgentContextSources"]> {
    return this.agentRuntimeDomain.listAgentContextSources(...args);
  }
  upsertAgentContextSource(
    ...args: Parameters<AgentRuntimeDomain["upsertAgentContextSource"]>
  ): ReturnType<AgentRuntimeDomain["upsertAgentContextSource"]> {
    return this.agentRuntimeDomain.upsertAgentContextSource(...args);
  }
  listAgentOwnerCorrections(
    ...args: Parameters<AgentRuntimeDomain["listAgentOwnerCorrections"]>
  ): ReturnType<AgentRuntimeDomain["listAgentOwnerCorrections"]> {
    return this.agentRuntimeDomain.listAgentOwnerCorrections(...args);
  }
  submitAgentOwnerCorrection(
    ...args: Parameters<AgentRuntimeDomain["submitAgentOwnerCorrection"]>
  ): ReturnType<AgentRuntimeDomain["submitAgentOwnerCorrection"]> {
    return this.agentRuntimeDomain.submitAgentOwnerCorrection(...args);
  }
  disableAgentOwnerCorrection(
    ...args: Parameters<AgentRuntimeDomain["disableAgentOwnerCorrection"]>
  ): ReturnType<AgentRuntimeDomain["disableAgentOwnerCorrection"]> {
    return this.agentRuntimeDomain.disableAgentOwnerCorrection(...args);
  }
  submitAgentFeedback(
    ...args: Parameters<AgentRuntimeDomain["submitAgentFeedback"]>
  ): ReturnType<AgentRuntimeDomain["submitAgentFeedback"]> {
    return this.agentRuntimeDomain.submitAgentFeedback(...args);
  }
  getAgentEvaluationSummary(
    ...args: Parameters<AgentRuntimeDomain["getAgentEvaluationSummary"]>
  ): ReturnType<AgentRuntimeDomain["getAgentEvaluationSummary"]> {
    return this.agentRuntimeDomain.getAgentEvaluationSummary(...args);
  }
  listConversations(
    ...args: Parameters<MessagingDomain["listConversations"]>
  ): ReturnType<MessagingDomain["listConversations"]> {
    return this.messagingDomain.listConversations(...args);
  }
  getConversation(
    ...args: Parameters<MessagingDomain["getConversation"]>
  ): ReturnType<MessagingDomain["getConversation"]> {
    return this.messagingDomain.getConversation(...args);
  }
  getConversationAttachment(
    ...args: Parameters<MessagingDomain["getConversationAttachment"]>
  ): ReturnType<MessagingDomain["getConversationAttachment"]> {
    return this.messagingDomain.getConversationAttachment(...args);
  }
  registerE2eeDevice(
    ...args: Parameters<MessagingDomain["registerE2eeDevice"]>
  ): ReturnType<MessagingDomain["registerE2eeDevice"]> {
    return this.messagingDomain.registerE2eeDevice(...args);
  }
  listE2eeDevices(
    ...args: Parameters<MessagingDomain["listE2eeDevices"]>
  ): ReturnType<MessagingDomain["listE2eeDevices"]> {
    return this.messagingDomain.listE2eeDevices(...args);
  }
  revokeE2eeDevice(
    ...args: Parameters<MessagingDomain["revokeE2eeDevice"]>
  ): ReturnType<MessagingDomain["revokeE2eeDevice"]> {
    return this.messagingDomain.revokeE2eeDevice(...args);
  }
  listConversationE2eeDevices(
    ...args: Parameters<MessagingDomain["listConversationE2eeDevices"]>
  ): ReturnType<MessagingDomain["listConversationE2eeDevices"]> {
    return this.messagingDomain.listConversationE2eeDevices(...args);
  }
  registerPushSubscription(
    ...args: Parameters<MessagingDomain["registerPushSubscription"]>
  ): ReturnType<MessagingDomain["registerPushSubscription"]> {
    return this.messagingDomain.registerPushSubscription(...args);
  }
  removePushSubscription(
    ...args: Parameters<MessagingDomain["removePushSubscription"]>
  ): ReturnType<MessagingDomain["removePushSubscription"]> {
    return this.messagingDomain.removePushSubscription(...args);
  }
  recordMessageHandoff(
    ...args: Parameters<MessagingDomain["recordMessageHandoff"]>
  ): ReturnType<MessagingDomain["recordMessageHandoff"]> {
    return this.messagingDomain.recordMessageHandoff(...args);
  }
  createConversationMessage(
    ...args: Parameters<MessagingDomain["createConversationMessage"]>
  ): ReturnType<MessagingDomain["createConversationMessage"]> {
    return this.messagingDomain.createConversationMessage(...args);
  }
  createAgentConversationMessage(
    ...args: Parameters<MessagingDomain["createAgentConversationMessage"]>
  ): ReturnType<MessagingDomain["createAgentConversationMessage"]> {
    return this.messagingDomain.createAgentConversationMessage(...args);
  }
  listMessageDeliveryAttempts(
    ...args: Parameters<MessagingDomain["listMessageDeliveryAttempts"]>
  ): ReturnType<MessagingDomain["listMessageDeliveryAttempts"]> {
    return this.messagingDomain.listMessageDeliveryAttempts(...args);
  }
  deliverPendingMessageNotifications(
    ...args: Parameters<MessagingDomain["deliverPendingMessageNotifications"]>
  ): ReturnType<MessagingDomain["deliverPendingMessageNotifications"]> {
    return this.messagingDomain.deliverPendingMessageNotifications(...args);
  }
  broadcastAppUpdateAvailable(
    ...args: Parameters<MessagingDomain["broadcastAppUpdateAvailable"]>
  ): ReturnType<MessagingDomain["broadcastAppUpdateAvailable"]> {
    return this.messagingDomain.broadcastAppUpdateAvailable(...args);
  }
  updateConversationSettings(
    ...args: Parameters<MessagingDomain["updateConversationSettings"]>
  ): ReturnType<MessagingDomain["updateConversationSettings"]> {
    return this.messagingDomain.updateConversationSettings(...args);
  }
  updateConversationMessage(
    ...args: Parameters<MessagingDomain["updateConversationMessage"]>
  ): ReturnType<MessagingDomain["updateConversationMessage"]> {
    return this.messagingDomain.updateConversationMessage(...args);
  }
  setConversationTyping(
    ...args: Parameters<MessagingDomain["setConversationTyping"]>
  ): ReturnType<MessagingDomain["setConversationTyping"]> {
    return this.messagingDomain.setConversationTyping(...args);
  }
  checkRole(input: {
    sessionId: string | null;
    businessId: string;
    role: string;
    permission?: BusinessPermission;
    now?: Date;
  }): RoleCheckResult {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    this.requireAccountNotPendingDeletion(session.account.id, now);

    if (!isBusinessRole(input.role)) {
      throw new Cp2Error(400, "role_invalid", "Role is not supported.");
    }

    const role = input.role;
    const permission = input.permission ?? "business:read";
    const membership = [...this.memberships.values()].find(
      (candidate) =>
        candidate.businessId === input.businessId && candidate.userId === session.user.id
    );
    const allowed =
      membership !== undefined && membership.role === role && roleCan(membership.role, permission);

    return {
      allowed,
      role,
      permission
    };
  }

  listProducts(
    ...args: Parameters<SalesDomain["listProducts"]>
  ): ReturnType<SalesDomain["listProducts"]> {
    return this.salesDomain.listProducts(...args);
  }
  queryCatalogue(
    ...args: Parameters<SalesDomain["queryCatalogue"]>
  ): ReturnType<SalesDomain["queryCatalogue"]> {
    return this.salesDomain.queryCatalogue(...args);
  }
  getProductFieldSchema(
    ...args: Parameters<SalesDomain["getProductFieldSchema"]>
  ): ReturnType<SalesDomain["getProductFieldSchema"]> {
    return this.salesDomain.getProductFieldSchema(...args);
  }
  saveProductFieldSchema(
    ...args: Parameters<SalesDomain["saveProductFieldSchema"]>
  ): ReturnType<SalesDomain["saveProductFieldSchema"]> {
    return this.salesDomain.saveProductFieldSchema(...args);
  }
  getPublicStorefront(input: { agentId: string }): PublicStorefrontSummary {
    const business = requirePublicStorefrontBusiness(
      this.businesses,
      this.quarantinedBusinessIds,
      input.agentId
    );
    return this.publicStorefrontForBusiness(business);
  }

  listPublicStorefronts(input?: { search?: string; limit?: number }): PublicStorefrontSummary[] {
    const search = input?.search?.trim().toLowerCase().slice(0, 120) ?? "";
    const limit = Math.min(50, Math.max(1, input?.limit ?? 24));

    return [...this.businesses.values()]
      .filter((business) => !this.quarantinedBusinessIds.has(business.id))
      .filter((business) => this.shopPresenceForBusiness(business.id).status !== "private")
      .map((business) => this.publicStorefrontForBusiness(business))
      .filter((storefront) => {
        if (search.length === 0) return true;
        return [
          storefront.businessName,
          storefront.sokoId,
          ...storefront.products.map((product) => product.name)
        ].some((value) => value.toLowerCase().includes(search));
      })
      .sort((left, right) => left.businessName.localeCompare(right.businessName))
      .slice(0, limit);
  }

  getShopPresence(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): ShopPresenceSummary {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", input.now);
    return this.shopPresenceForBusiness(input.businessId);
  }

  setShopPresence(input: {
    sessionId: string | null;
    businessId: string;
    status: ShopPresenceStatus;
    now?: Date;
  }): ShopPresenceSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    this.requireOwnerMembership(input.businessId, session.user.id);
    const presence: ShopPresenceSummary = {
      businessId: input.businessId,
      status: input.status,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };
    this.shopPresences.set(input.businessId, presence);
    this.recordAuditEvent({
      type: "shop.presence_updated",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: { status: input.status }
    });
    return presence;
  }

  createNetworkInvites(input: {
    sessionId: string | null;
    businessId: string;
    contacts: Array<{ name: string; phone: string | null; email: string | null }>;
    now?: Date;
  }): NetworkInviteSummary[] {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "customer:write",
      now
    );
    if (input.contacts.length === 0 || input.contacts.length > 100) {
      throw new Cp2Error(400, "invite_contacts_invalid", "Select between 1 and 100 contacts.");
    }

    const created: NetworkInviteSummary[] = [];
    const destinations = new Set<string>();
    for (const contact of input.contacts) {
      const phone = normalizeOptionalBoundedText(contact.phone, 40);
      const email = normalizeOptionalBoundedText(contact.email, 254)?.toLowerCase() ?? null;
      const destination = phone ?? email;
      if (destination === null) {
        throw new Cp2Error(
          400,
          "invite_destination_required",
          "Each invite needs a phone or email."
        );
      }
      const destinationKey = destination.toLowerCase();
      if (destinations.has(destinationKey)) continue;
      destinations.add(destinationKey);

      const existing = [...this.networkInvites.values()].find(
        (invite) =>
          invite.businessId === input.businessId &&
          invite.destination.toLowerCase() === destinationKey &&
          (invite.status === "queued" || invite.status === "sent")
      );
      if (existing !== undefined) {
        created.push(existing);
        continue;
      }

      const invite: NetworkInviteSummary = {
        id: randomUUID(),
        businessId: input.businessId,
        invitedByUserId: session.user.id,
        contactName: normalizeRequiredBoundedText(contact.name, "contact name", 120),
        channel: phone === null ? "email" : "phone",
        destination,
        status: "queued",
        createdAt: now.toISOString(),
        deliveredAt: null,
        failureReason: null
      };
      this.networkInvites.set(invite.id, invite);
      created.push(invite);
      this.recordAuditEvent({
        type: "network.invite_queued",
        aggregateType: "network_invite",
        aggregateId: invite.id,
        actorId: session.user.id,
        occurredAt: now.toISOString(),
        payload: { businessId: input.businessId, channel: invite.channel }
      });
    }
    return created;
  }

  listNetworkInvites(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): NetworkInviteSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "customer:read", input.now);
    return [...this.networkInvites.values()]
      .filter((invite) => invite.businessId === input.businessId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async deliverNetworkInvites(input: {
    sessionId: string | null;
    businessId: string;
    inviteIds: string[];
    now?: Date;
  }): Promise<NetworkInviteSummary[]> {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "customer:write", now);
    const invites = input.inviteIds
      .map((inviteId) => this.networkInvites.get(inviteId))
      .filter(
        (invite): invite is NetworkInviteSummary =>
          invite !== undefined && invite.businessId === input.businessId
      );
    const sender = this.options.networkInviteSender;
    if (sender === undefined) return invites;
    const business = this.requireBusiness(input.businessId);

    for (const invite of invites) {
      if (invite.status !== "queued") continue;
      const result = await sender({
        inviteId: invite.id,
        businessId: invite.businessId,
        businessName: business.name,
        channel: invite.channel,
        destination: invite.destination,
        contactName: invite.contactName
      });
      const updated: NetworkInviteSummary = {
        ...invite,
        status: result.status,
        deliveredAt: result.status === "sent" ? now.toISOString() : null,
        failureReason: result.status === "failed" ? result.failureReason : null
      };
      this.networkInvites.set(updated.id, updated);
      this.recordAuditEvent({
        type: result.status === "sent" ? "network.invite_sent" : "network.invite_failed",
        aggregateType: "network_invite",
        aggregateId: updated.id,
        actorId: updated.invitedByUserId,
        occurredAt: now.toISOString(),
        payload: {
          businessId: input.businessId,
          channel: updated.channel,
          failureReason: updated.failureReason
        }
      });
    }

    return invites.map((invite) => this.networkInvites.get(invite.id) as NetworkInviteSummary);
  }

  createPublicCustomerCareRequest(
    ...args: Parameters<SalesDomain["createPublicCustomerCareRequest"]>
  ): ReturnType<SalesDomain["createPublicCustomerCareRequest"]> {
    return this.salesDomain.createPublicCustomerCareRequest(...args);
  }
  createPublicStorefrontSession(
    ...args: Parameters<MessagingDomain["createPublicStorefrontSession"]>
  ): ReturnType<MessagingDomain["createPublicStorefrontSession"]> {
    return this.messagingDomain.createPublicStorefrontSession(...args);
  }
  createPublicStorefrontMessage(
    ...args: Parameters<MessagingDomain["createPublicStorefrontMessage"]>
  ): ReturnType<MessagingDomain["createPublicStorefrontMessage"]> {
    return this.messagingDomain.createPublicStorefrontMessage(...args);
  }
  private async attemptPublicAgentReply(input: {
    businessId: string;
    capability: CustomerRuntimeCapabilityRecord;
    visitorId: string;
    body: string;
    now: Date;
  }): Promise<PublicStorefrontMessageSummary | null> {
    const { businessId, visitorId, body, now } = input;
    if (this.publicAgentReplyRateLimited(businessId, visitorId, now)) return null;

    const catalogueRuntime = this.agentRuntimeDomain.createCustomerCatalogueRuntimeTurn({
      capability: input.capability,
      message: body,
      now
    });
    if (catalogueRuntime !== null) {
      const canonical = this.messagingDomain.persistExternalConversationMessage({
        conversationId: input.capability.conversationId,
        provider: "soko",
        author: "agent",
        authorId: `shop-${businessId}-agent`,
        body: catalogueRuntime.turn.response,
        attachmentNames: [],
        idempotencyKey: `soko-agent-runtime:${catalogueRuntime.turn.id}`,
        now
      });
      const result = catalogueRuntime.turn.toolResult as CatalogueQueryResult;
      for (const product of result.products) {
        this.messagingDomain.persistExternalProductCard({
          conversationId: input.capability.conversationId,
          provider: "soko",
          product,
          runtimeTurnId: catalogueRuntime.turn.id,
          now
        });
      }
      return this.messagingDomain.publicMessageView(canonical, businessId, visitorId);
    }

    if (!this.agentRuntimeDomain.computeAgentRuntimeReadiness(businessId, now).ready) return null;

    const storedAgentProfile = this.agentRuntimeDomain.currentAgentProfile(businessId, now);
    const { activeModelId } = this.agentRuntimeDomain.resolveActiveRuntimeModelId(
      businessId,
      storedAgentProfile
    );
    const shopRuntime = this.agentRuntimeDomain.buildShopAgentRuntime(
      storedAgentProfile,
      now,
      "customer",
      activeModelId
    );
    // resolveRuntimeModelProvider can throw (RUNTIME_NOT_CONFIGURED, NO_COMPATIBLE_EXECUTION_TARGET,
    // BROWSER_RUNTIME_DISABLED, BRIDGE_UNAVAILABLE, ...) rather than returning `provider: undefined`
    // whenever no execution target can be resolved for this business - every one of those is just
    // another shape of "no model provider" for this function's documented always-degrade-to-null
    // contract, same as the `provider === undefined` case below.
    let provider: RuntimeModelProvider | undefined;
    try {
      ({ provider } = this.agentRuntimeDomain.resolveRuntimeModelProvider(
        shopRuntime,
        activeModelId
      ));
    } catch (error) {
      if (error instanceof Cp2Error) return null;
      throw error;
    }
    if (provider === undefined) return null;

    const parserResult = parseMerchantCommand(body);
    const retrievedContext = retrieveAgentContext({
      sources: this.agentRuntimeDomain.contextSourcesForRuntime(storedAgentProfile),
      query: body,
      audience: "customer",
      limit: 6,
      intent: parserResult.intent,
      characterBudget: contextCharacterBudgetForModel(
        activeModelId,
        this.resolveCatalogModel(activeModelId)
      )
    });
    const assembled = assembleAgentInferenceMessage({
      runtime: shopRuntime,
      intent: parserResult.intent,
      message: body,
      context: retrievedContext,
      allowedTools: [],
      memory: []
    });
    const prompt = buildRuntimeModelPrompt(assembled.message, undefined, undefined, {
      runtimeVersion: shopRuntime.version,
      compiledInstructions: assembled.compiled,
      retrievedContext,
      allowedTools: []
    });

    let completion: RuntimeModelCompletionResult;
    try {
      completion = await provider.complete(prompt);
    } catch {
      return null;
    }
    if (completion.status !== "available" || completion.outputText === null) return null;

    const replyText = publicAgentReplyText(parseRuntimeModelOutput(completion.outputText));
    if (replyText === null) return null;

    const canonical = this.messagingDomain.persistExternalConversationMessage({
      conversationId: input.capability.conversationId,
      provider: "soko",
      author: "agent",
      authorId: `shop-${businessId}-agent`,
      body: normalizeRequiredBoundedText(replyText, "message", 4000),
      attachmentNames: [],
      idempotencyKey: `soko-agent-reply:${input.capability.conversationId}:${randomUUID()}`,
      now
    });
    return this.messagingDomain.publicMessageView(canonical, businessId, visitorId);
  }

  private publicAgentReplyRateLimited(businessId: string, visitorId: string, now: Date): boolean {
    const key = `${businessId}:${visitorId}`;
    const cutoff = now.getTime() - 60 * 60 * 1000;
    const recentAttempts = (this.publicAgentReplyAttemptsByVisitor.get(key) ?? []).filter(
      (attemptedAt) => attemptedAt > cutoff
    );
    if (recentAttempts.length >= 20) return true;
    recentAttempts.push(now.getTime());
    this.publicAgentReplyAttemptsByVisitor.set(key, recentAttempts);
    return false;
  }

  createPublicOrder(
    ...args: Parameters<SalesDomain["createPublicOrder"]>
  ): ReturnType<SalesDomain["createPublicOrder"]> {
    return this.salesDomain.createPublicOrder(...args);
  }
  listPublicCustomerCareRequests(
    ...args: Parameters<SalesDomain["listPublicCustomerCareRequests"]>
  ): ReturnType<SalesDomain["listPublicCustomerCareRequests"]> {
    return this.salesDomain.listPublicCustomerCareRequests(...args);
  }
  listPublicStorefrontMessages(
    ...args: Parameters<MessagingDomain["listPublicStorefrontMessages"]>
  ): ReturnType<MessagingDomain["listPublicStorefrontMessages"]> {
    return this.messagingDomain.listPublicStorefrontMessages(...args);
  }
  listPublicOrders(
    ...args: Parameters<SalesDomain["listPublicOrders"]>
  ): ReturnType<SalesDomain["listPublicOrders"]> {
    return this.salesDomain.listPublicOrders(...args);
  }
  createProductCaptureJob(
    ...args: Parameters<CommerceDomain["createProductCaptureJob"]>
  ): ReturnType<CommerceDomain["createProductCaptureJob"]> {
    return this.commerce.createProductCaptureJob(...args);
  }

  getProductCaptureJob(
    ...args: Parameters<CommerceDomain["getProductCaptureJob"]>
  ): ReturnType<CommerceDomain["getProductCaptureJob"]> {
    return this.commerce.getProductCaptureJob(...args);
  }

  reviewProductCaptureJob(
    ...args: Parameters<CommerceDomain["reviewProductCaptureJob"]>
  ): ReturnType<CommerceDomain["reviewProductCaptureJob"]> {
    return this.commerce.reviewProductCaptureJob(...args);
  }

  retryProductCaptureJob(
    ...args: Parameters<CommerceDomain["retryProductCaptureJob"]>
  ): ReturnType<CommerceDomain["retryProductCaptureJob"]> {
    return this.commerce.retryProductCaptureJob(...args);
  }

  cancelProductCaptureJob(
    ...args: Parameters<CommerceDomain["cancelProductCaptureJob"]>
  ): ReturnType<CommerceDomain["cancelProductCaptureJob"]> {
    return this.commerce.cancelProductCaptureJob(...args);
  }

  confirmProductCaptureJob(
    ...args: Parameters<CommerceDomain["confirmProductCaptureJob"]>
  ): ReturnType<CommerceDomain["confirmProductCaptureJob"]> {
    return this.commerce.confirmProductCaptureJob(...args);
  }

  confirmProductCaptureItem(
    ...args: Parameters<CommerceDomain["confirmProductCaptureItem"]>
  ): ReturnType<CommerceDomain["confirmProductCaptureItem"]> {
    return this.commerce.confirmProductCaptureItem(...args);
  }

  rejectProductCaptureItem(
    ...args: Parameters<CommerceDomain["rejectProductCaptureItem"]>
  ): ReturnType<CommerceDomain["rejectProductCaptureItem"]> {
    return this.commerce.rejectProductCaptureItem(...args);
  }

  listStatusBroadcastCandidates(
    ...args: Parameters<CommerceDomain["listStatusBroadcastCandidates"]>
  ): ReturnType<CommerceDomain["listStatusBroadcastCandidates"]> {
    return this.commerce.listStatusBroadcastCandidates(...args);
  }

  createStatusBroadcast(
    ...args: Parameters<CommerceDomain["createStatusBroadcast"]>
  ): ReturnType<CommerceDomain["createStatusBroadcast"]> {
    return this.commerce.createStatusBroadcast(...args);
  }

  getStatusBroadcast(
    ...args: Parameters<CommerceDomain["getStatusBroadcast"]>
  ): ReturnType<CommerceDomain["getStatusBroadcast"]> {
    return this.commerce.getStatusBroadcast(...args);
  }

  listStatusBroadcastsForBusiness(
    ...args: Parameters<CommerceDomain["listStatusBroadcastsForBusiness"]>
  ): ReturnType<CommerceDomain["listStatusBroadcastsForBusiness"]> {
    return this.commerce.listStatusBroadcastsForBusiness(...args);
  }

  recordStatusBroadcastView(
    ...args: Parameters<CommerceDomain["recordStatusBroadcastView"]>
  ): ReturnType<CommerceDomain["recordStatusBroadcastView"]> {
    return this.commerce.recordStatusBroadcastView(...args);
  }

  recordStatusBroadcastReply(
    ...args: Parameters<CommerceDomain["recordStatusBroadcastReply"]>
  ): ReturnType<CommerceDomain["recordStatusBroadcastReply"]> {
    return this.commerce.recordStatusBroadcastReply(...args);
  }

  listStatusBroadcastsReceivedByViewer(
    ...args: Parameters<CommerceDomain["listStatusBroadcastsReceivedByViewer"]>
  ): ReturnType<CommerceDomain["listStatusBroadcastsReceivedByViewer"]> {
    return this.commerce.listStatusBroadcastsReceivedByViewer(...args);
  }

  searchBuyFeed(
    ...args: Parameters<CommerceDomain["searchBuyFeed"]>
  ): ReturnType<CommerceDomain["searchBuyFeed"]> {
    return this.commerce.searchBuyFeed(...args);
  }

  createUnifiedCheckout(
    ...args: Parameters<CommerceDomain["createUnifiedCheckout"]>
  ): ReturnType<CommerceDomain["createUnifiedCheckout"]> {
    return this.commerce.createUnifiedCheckout(...args);
  }

  getUnifiedCheckout(
    ...args: Parameters<CommerceDomain["getUnifiedCheckout"]>
  ): ReturnType<CommerceDomain["getUnifiedCheckout"]> {
    return this.commerce.getUnifiedCheckout(...args);
  }

  getPublicProductMedia(
    ...args: Parameters<SalesDomain["getPublicProductMedia"]>
  ): ReturnType<SalesDomain["getPublicProductMedia"]> {
    return this.salesDomain.getPublicProductMedia(...args);
  }
  createProduct(
    ...args: Parameters<SalesDomain["createProduct"]>
  ): ReturnType<SalesDomain["createProduct"]> {
    return this.salesDomain.createProduct(...args);
  }
  updateProduct(
    ...args: Parameters<SalesDomain["updateProduct"]>
  ): ReturnType<SalesDomain["updateProduct"]> {
    return this.salesDomain.updateProduct(...args);
  }
  deleteProduct(
    ...args: Parameters<SalesDomain["deleteProduct"]>
  ): ReturnType<SalesDomain["deleteProduct"]> {
    return this.salesDomain.deleteProduct(...args);
  }
  adjustProductStock(
    ...args: Parameters<SalesDomain["adjustProductStock"]>
  ): ReturnType<SalesDomain["adjustProductStock"]> {
    return this.salesDomain.adjustProductStock(...args);
  }
  listCustomers(
    ...args: Parameters<SalesDomain["listCustomers"]>
  ): ReturnType<SalesDomain["listCustomers"]> {
    return this.salesDomain.listCustomers(...args);
  }
  createCustomer(
    ...args: Parameters<SalesDomain["createCustomer"]>
  ): ReturnType<SalesDomain["createCustomer"]> {
    return this.salesDomain.createCustomer(...args);
  }
  updateCustomer(
    ...args: Parameters<SalesDomain["updateCustomer"]>
  ): ReturnType<SalesDomain["updateCustomer"]> {
    return this.salesDomain.updateCustomer(...args);
  }
  linkCustomerAccount(
    ...args: Parameters<SalesDomain["linkCustomerAccount"]>
  ): ReturnType<SalesDomain["linkCustomerAccount"]> {
    return this.salesDomain.linkCustomerAccount(...args);
  }
  listSuppliers(
    ...args: Parameters<SupplierDomain["listSuppliers"]>
  ): ReturnType<SupplierDomain["listSuppliers"]> {
    return this.supplierDomain.listSuppliers(...args);
  }

  createSupplier(
    ...args: Parameters<SupplierDomain["createSupplier"]>
  ): ReturnType<SupplierDomain["createSupplier"]> {
    return this.supplierDomain.createSupplier(...args);
  }

  updateSupplier(
    ...args: Parameters<SupplierDomain["updateSupplier"]>
  ): ReturnType<SupplierDomain["updateSupplier"]> {
    return this.supplierDomain.updateSupplier(...args);
  }

  deleteSupplier(
    ...args: Parameters<SupplierDomain["deleteSupplier"]>
  ): ReturnType<SupplierDomain["deleteSupplier"]> {
    return this.supplierDomain.deleteSupplier(...args);
  }

  listSalesAgents(
    ...args: Parameters<SupplierDomain["listSalesAgents"]>
  ): ReturnType<SupplierDomain["listSalesAgents"]> {
    return this.supplierDomain.listSalesAgents(...args);
  }

  createSalesAgent(
    ...args: Parameters<SupplierDomain["createSalesAgent"]>
  ): ReturnType<SupplierDomain["createSalesAgent"]> {
    return this.supplierDomain.createSalesAgent(...args);
  }

  updateSalesAgent(
    ...args: Parameters<SupplierDomain["updateSalesAgent"]>
  ): ReturnType<SupplierDomain["updateSalesAgent"]> {
    return this.supplierDomain.updateSalesAgent(...args);
  }

  deleteSalesAgent(
    ...args: Parameters<SupplierDomain["deleteSalesAgent"]>
  ): ReturnType<SupplierDomain["deleteSalesAgent"]> {
    return this.supplierDomain.deleteSalesAgent(...args);
  }

  searchSupplierPhonebookContacts(
    ...args: Parameters<SupplierDomain["searchSupplierPhonebookContacts"]>
  ): ReturnType<SupplierDomain["searchSupplierPhonebookContacts"]> {
    return this.supplierDomain.searchSupplierPhonebookContacts(...args);
  }

  createSupplierFromPhoneContact(
    ...args: Parameters<SupplierDomain["createSupplierFromPhoneContact"]>
  ): ReturnType<SupplierDomain["createSupplierFromPhoneContact"]> {
    return this.supplierDomain.createSupplierFromPhoneContact(...args);
  }

  createSalesAgentFromPhoneContact(
    ...args: Parameters<SupplierDomain["createSalesAgentFromPhoneContact"]>
  ): ReturnType<SupplierDomain["createSalesAgentFromPhoneContact"]> {
    return this.supplierDomain.createSalesAgentFromPhoneContact(...args);
  }

  linkSupplierContact(
    ...args: Parameters<SupplierDomain["linkSupplierContact"]>
  ): ReturnType<SupplierDomain["linkSupplierContact"]> {
    return this.supplierDomain.linkSupplierContact(...args);
  }

  linkSalesAgentContact(
    ...args: Parameters<SupplierDomain["linkSalesAgentContact"]>
  ): ReturnType<SupplierDomain["linkSalesAgentContact"]> {
    return this.supplierDomain.linkSalesAgentContact(...args);
  }

  createReceiptOCRJob(
    ...args: Parameters<SupplierDomain["createReceiptOCRJob"]>
  ): ReturnType<SupplierDomain["createReceiptOCRJob"]> {
    return this.supplierDomain.createReceiptOCRJob(...args);
  }

  confirmReceiptOCRJob(
    ...args: Parameters<SupplierDomain["confirmReceiptOCRJob"]>
  ): ReturnType<SupplierDomain["confirmReceiptOCRJob"]> {
    return this.supplierDomain.confirmReceiptOCRJob(...args);
  }

  correctReceiptOCRJob(
    ...args: Parameters<SupplierDomain["correctReceiptOCRJob"]>
  ): ReturnType<SupplierDomain["correctReceiptOCRJob"]> {
    return this.supplierDomain.correctReceiptOCRJob(...args);
  }

  cancelReceiptOCRJob(
    ...args: Parameters<SupplierDomain["cancelReceiptOCRJob"]>
  ): ReturnType<SupplierDomain["cancelReceiptOCRJob"]> {
    return this.supplierDomain.cancelReceiptOCRJob(...args);
  }

  listReceiptOCRJobs(
    ...args: Parameters<SupplierDomain["listReceiptOCRJobs"]>
  ): ReturnType<SupplierDomain["listReceiptOCRJobs"]> {
    return this.supplierDomain.listReceiptOCRJobs(...args);
  }

  listPurchaseReceipts(
    ...args: Parameters<SupplierDomain["listPurchaseReceipts"]>
  ): ReturnType<SupplierDomain["listPurchaseReceipts"]> {
    return this.supplierDomain.listPurchaseReceipts(...args);
  }

  getPurchaseReceipt(
    ...args: Parameters<SupplierDomain["getPurchaseReceipt"]>
  ): ReturnType<SupplierDomain["getPurchaseReceipt"]> {
    return this.supplierDomain.getPurchaseReceipt(...args);
  }

  previewInvoice(
    ...args: Parameters<SalesDomain["previewInvoice"]>
  ): ReturnType<SalesDomain["previewInvoice"]> {
    return this.salesDomain.previewInvoice(...args);
  }
  listInvoices(
    ...args: Parameters<SalesDomain["listInvoices"]>
  ): ReturnType<SalesDomain["listInvoices"]> {
    return this.salesDomain.listInvoices(...args);
  }
  createInvoice(
    ...args: Parameters<SalesDomain["createInvoice"]>
  ): ReturnType<SalesDomain["createInvoice"]> {
    return this.salesDomain.createInvoice(...args);
  }
  updateInvoice(
    ...args: Parameters<SalesDomain["updateInvoice"]>
  ): ReturnType<SalesDomain["updateInvoice"]> {
    return this.salesDomain.updateInvoice(...args);
  }
  confirmInvoice(
    ...args: Parameters<SalesDomain["confirmInvoice"]>
  ): ReturnType<SalesDomain["confirmInvoice"]> {
    return this.salesDomain.confirmInvoice(...args);
  }
  listPayments(
    ...args: Parameters<SalesDomain["listPayments"]>
  ): ReturnType<SalesDomain["listPayments"]> {
    return this.salesDomain.listPayments(...args);
  }
  recordPayment(
    ...args: Parameters<SalesDomain["recordPayment"]>
  ): ReturnType<SalesDomain["recordPayment"]> {
    return this.salesDomain.recordPayment(...args);
  }
  listInvoicePaymentSummaries(
    ...args: Parameters<SalesDomain["listInvoicePaymentSummaries"]>
  ): ReturnType<SalesDomain["listInvoicePaymentSummaries"]> {
    return this.salesDomain.listInvoicePaymentSummaries(...args);
  }
  listCustomerDebts(
    ...args: Parameters<SalesDomain["listCustomerDebts"]>
  ): ReturnType<SalesDomain["listCustomerDebts"]> {
    return this.salesDomain.listCustomerDebts(...args);
  }
  listLogistics(
    ...args: Parameters<LogisticsDomain["listLogistics"]>
  ): ReturnType<LogisticsDomain["listLogistics"]> {
    return this.logisticsDomain.listLogistics(...args);
  }

  createLogistics(
    ...args: Parameters<LogisticsDomain["createLogistics"]>
  ): ReturnType<LogisticsDomain["createLogistics"]> {
    return this.logisticsDomain.createLogistics(...args);
  }

  updateLogisticsStatus(
    ...args: Parameters<LogisticsDomain["updateLogisticsStatus"]>
  ): ReturnType<LogisticsDomain["updateLogisticsStatus"]> {
    return this.logisticsDomain.updateLogisticsStatus(...args);
  }

  listContacts(...args: Parameters<CommercialRecordsDomain["listContacts"]>) {
    return this.commercialRecordsDomain.listContacts(...args);
  }
  getContact(...args: Parameters<CommercialRecordsDomain["getContact"]>) {
    return this.commercialRecordsDomain.getContact(...args);
  }
  importContacts(...args: Parameters<CommercialRecordsDomain["importContacts"]>) {
    return this.commercialRecordsDomain.importContacts(...args);
  }
  linkContactAccount(...args: Parameters<CommercialRecordsDomain["linkContactAccount"]>) {
    return this.commercialRecordsDomain.linkContactAccount(...args);
  }
  listSupplierContacts(...args: Parameters<CommercialRecordsDomain["listSupplierContacts"]>) {
    return this.commercialRecordsDomain.listSupplierContacts(...args);
  }
  attachSupplierContact(...args: Parameters<CommercialRecordsDomain["attachSupplierContact"]>) {
    return this.commercialRecordsDomain.attachSupplierContact(...args);
  }
  detachSupplierContact(...args: Parameters<CommercialRecordsDomain["detachSupplierContact"]>) {
    return this.commercialRecordsDomain.detachSupplierContact(...args);
  }
  changePurchasePrice(...args: Parameters<CommercialRecordsDomain["changePurchasePrice"]>) {
    return this.commercialRecordsDomain.changePurchasePrice(...args);
  }
  listPurchasePriceHistory(
    ...args: Parameters<CommercialRecordsDomain["listPurchasePriceHistory"]>
  ) {
    return this.commercialRecordsDomain.listPurchasePriceHistory(...args);
  }
  createPurchase(...args: Parameters<CommercialRecordsDomain["createPurchase"]>) {
    return this.commercialRecordsDomain.createPurchase(...args);
  }
  listPurchaseHistory(...args: Parameters<CommercialRecordsDomain["listPurchaseHistory"]>) {
    return this.commercialRecordsDomain.listPurchaseHistory(...args);
  }
  createSale(...args: Parameters<CommercialRecordsDomain["createSale"]>) {
    return this.commercialRecordsDomain.createSale(...args);
  }
  listSalesHistory(...args: Parameters<CommercialRecordsDomain["listSalesHistory"]>) {
    return this.commercialRecordsDomain.listSalesHistory(...args);
  }
  createDeliveryRoute(...args: Parameters<CommercialRecordsDomain["createRoute"]>) {
    return this.commercialRecordsDomain.createRoute(...args);
  }
  updateDeliveryRoute(...args: Parameters<CommercialRecordsDomain["updateRoute"]>) {
    return this.commercialRecordsDomain.updateRoute(...args);
  }
  listDeliveryRouteHistory(...args: Parameters<CommercialRecordsDomain["listRouteHistory"]>) {
    return this.commercialRecordsDomain.listRouteHistory(...args);
  }

  getOfflineCache(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): OfflineCacheSnapshot {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);

    return this.buildOfflineCacheSnapshot(input.businessId, now);
  }

  listSyncQueue(input: { sessionId: string | null; businessId: string; now?: Date }): {
    summary: SyncQueueSummary;
    items: SyncQueueItem[];
  } {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", input.now);
    const items = [...this.syncQueue.values()]
      .filter((item) => item.businessId === input.businessId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return {
      summary: summarizeSyncQueue(input.businessId, items),
      items
    };
  }

  getBusinessReport(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BusinessReportSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "report:read", now);
    return this.buildBusinessReport(input.businessId, now);
  }

  getBusinessKnowledge(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BusinessKnowledgeSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "report:read", now);
    return this.buildBusinessKnowledge(input.businessId, now);
  }

  listNotifications(
    ...args: Parameters<NotificationsDomain["listNotifications"]>
  ): ReturnType<NotificationsDomain["listNotifications"]> {
    return this.notificationsDomain.listNotifications(...args);
  }

  updateNotificationStatus(
    ...args: Parameters<NotificationsDomain["updateNotificationStatus"]>
  ): ReturnType<NotificationsDomain["updateNotificationStatus"]> {
    return this.notificationsDomain.updateNotificationStatus(...args);
  }

  createDataExport(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): DataExportBundle {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:export",
      now
    );
    const account = this.requireAccount(session.account.id);
    const user = this.requireUser(session.user.id);
    const business = this.requireBusiness(input.businessId);
    const auditEvents = this.auditEventsForBusiness(input.businessId).map((event) => ({
      id: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      risk: event.risk
    }));
    const data = {
      account,
      user,
      business,
      memberships: this.membershipsForBusiness(input.businessId),
      products: this.salesDomain.productsForBusiness(input.businessId),
      customers: this.salesDomain.customersForBusiness(input.businessId),
      suppliers: this.supplierDomain.suppliersForBusiness(input.businessId),
      invoices: this.salesDomain.invoicesForBusiness(input.businessId),
      payments: this.salesDomain.paymentsForBusiness(input.businessId),
      logistics: this.logisticsDomain.logisticsForBusiness(input.businessId),
      documentImports: this.documentImportDomain.importsForBusiness(input.businessId),
      notifications: this.notificationsDomain.sortedNotifications(input.businessId),
      inventoryMovements: this.salesDomain.inventoryMovementsForBusiness(input.businessId),
      auditEvents
    };
    const recordCounts = countExportRecords(data);
    const exportBundle: DataExportBundle = {
      id: randomUUID(),
      businessId: input.businessId,
      accountId: account.id,
      actorId: session.user.id,
      status: "ready",
      recordCounts,
      checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
      createdAt: now.toISOString(),
      data
    };

    this.dataExports.set(exportBundle.id, exportBundle);
    this.appendBusinessEvent(
      dataExportCreatedEvent({
        id: randomUUID(),
        exportBundle,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return exportBundle;
  }

  requestAccountDeletion(input: {
    sessionId: string | null;
    businessId: string;
    deletion: AccountDeletionInput;
    now?: Date;
  }): AccountDeletionRequestSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:delete",
      now
    );
    assertValid(validateAccountDeletionInput(input.deletion));
    const normalized = normalizeAccountDeletionInput(input.deletion);
    const retention = this.buildComplianceRetention(input.businessId);
    const deletionRequest: AccountDeletionRequestSummary = {
      id: randomUUID(),
      accountId: session.account.id,
      userId: session.user.id,
      businessId: input.businessId,
      actorId: session.user.id,
      status: "scheduled",
      reason: normalized.reason,
      requestedAt: now.toISOString(),
      deactivatedAt: now.toISOString(),
      anonymizeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      retention
    };

    this.accountDeletionRequests.set(deletionRequest.id, deletionRequest);
    this.revokeSessionsForAccount(session.account.id, now);
    this.appendBusinessEvent(
      accountDeletionScheduledEvent({
        id: randomUUID(),
        deletionRequest,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return deletionRequest;
  }

  listRestorableAccountDeletions(input: {
    sessionId: string | null;
    now?: Date;
  }): AccountDeletionRequestSummary[] {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    return [...this.accountDeletionRequests.values()]
      .filter(
        (request) =>
          request.accountId === session.account.id &&
          request.status === "scheduled" &&
          new Date(request.anonymizeAfter).getTime() > now.getTime()
      )
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  restoreAccountDeletion(input: {
    sessionId: string | null;
    requestId: string;
    pin: string;
    now?: Date;
  }): {
    request: AccountDeletionRequestSummary;
    business: BusinessSummary;
    membership: MembershipSummary;
  } {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const request = this.accountDeletionRequests.get(input.requestId);
    if (request === undefined || request.accountId !== session.account.id) {
      throw new Cp2Error(
        404,
        "account_deletion_not_found",
        "Account deletion request was not found."
      );
    }
    if (request.status === "RESTORED") {
      return {
        request,
        business: this.requireBusiness(request.businessId),
        membership: this.requireOwnerMembership(request.businessId, session.user.id)
      };
    }
    if (request.status !== "scheduled") {
      throw new Cp2Error(
        409,
        "account_deletion_not_restorable",
        "This deletion request cannot be restored."
      );
    }
    if (new Date(request.anonymizeAfter).getTime() <= now.getTime()) {
      throw new Cp2Error(410, "restore_window_expired", "The account recovery window has expired.");
    }
    this.verifyAccountPinForSession(session, input.pin, now);
    const restored: AccountDeletionRequestSummary = {
      ...request,
      status: "RESTORED",
      completedAt: now.toISOString(),
      failureReason: null
    };
    this.accountDeletionRequests.set(restored.id, restored);
    this.recordAuditEvent({
      type: "account_deletion.restored",
      aggregateType: "account_deletion",
      aggregateId: restored.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: { businessId: restored.businessId, accountId: restored.accountId }
    });
    return {
      request: restored,
      business: this.requireBusiness(restored.businessId),
      membership: this.requireOwnerMembership(restored.businessId, session.user.id)
    };
  }

  listLoginAccounts(
    ...args: Parameters<OAuthDomain["listLoginAccounts"]>
  ): ReturnType<OAuthDomain["listLoginAccounts"]> {
    return this.oauthDomain.listLoginAccounts(...args);
  }
  disconnectLoginAccount(
    ...args: Parameters<OAuthDomain["disconnectLoginAccount"]>
  ): ReturnType<OAuthDomain["disconnectLoginAccount"]> {
    return this.oauthDomain.disconnectLoginAccount(...args);
  }
  listConnectedSocialAccounts(
    ...args: Parameters<OAuthDomain["listConnectedSocialAccounts"]>
  ): ReturnType<OAuthDomain["listConnectedSocialAccounts"]> {
    return this.oauthDomain.listConnectedSocialAccounts(...args);
  }
  disconnectSocialAccount(
    ...args: Parameters<OAuthDomain["disconnectSocialAccount"]>
  ): ReturnType<OAuthDomain["disconnectSocialAccount"]> {
    return this.oauthDomain.disconnectSocialAccount(...args);
  }
  getShopDeletionPreview(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): ShopDeletionPreviewSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:delete",
      now
    );
    this.requireOwnerMembership(input.businessId, session.user.id);

    return this.buildShopDeletionPreview(input.businessId, session.account.id, now);
  }

  requestShopDeletion(input: {
    sessionId: string | null;
    businessId: string;
    shopId: string;
    now?: Date;
  }): ShopDeletionRequestResult {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:delete",
      now
    );
    this.requireOwnerMembership(input.businessId, session.user.id);
    const business = this.requireBusiness(input.businessId);

    if (
      normalizeStorefrontLookupId(input.shopId) !== normalizeStorefrontLookupId(business.sokoId)
    ) {
      throw new Cp2Error(400, "shop_id_mismatch", "Type the exact shop ID to continue.");
    }

    const existing = [...this.accountDeletionRequests.values()]
      .filter(
        (request) =>
          request.businessId === input.businessId &&
          request.actorId === session.user.id &&
          request.status === "PENDING_VERIFICATION"
      )
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0];

    if (existing !== undefined) {
      return {
        request: existing,
        preview: this.buildShopDeletionPreview(input.businessId, session.account.id, now)
      };
    }

    const deletionRequest: AccountDeletionRequestSummary = {
      id: randomUUID(),
      accountId: session.account.id,
      userId: session.user.id,
      businessId: input.businessId,
      actorId: session.user.id,
      status: "PENDING_VERIFICATION",
      reason: "Shop owner requested shop deletion",
      requestedAt: now.toISOString(),
      requestedByUserId: session.user.id,
      reauthenticatedAt: null,
      otpVerifiedAt: null,
      startedAt: null,
      completedAt: null,
      failureReason: null,
      auditReference: null,
      idempotencyKey: null,
      deactivatedAt: now.toISOString(),
      anonymizeAfter: now.toISOString(),
      retention: this.buildComplianceRetention(input.businessId)
    };

    this.accountDeletionRequests.set(deletionRequest.id, deletionRequest);
    this.notificationsDomain.recordSecurityNotification({
      businessId: input.businessId,
      type: "shop_deletion",
      title: "Shop deletion requested",
      body: "A deletion request was started for this shop.",
      sourceId: deletionRequest.id,
      now
    });
    this.recordAuditEvent({
      type: "shop_deletion.requested",
      aggregateType: "account_deletion",
      aggregateId: deletionRequest.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: input.businessId,
        shopId: business.sokoId,
        status: deletionRequest.status,
        reauthentication: "owner_pin"
      }
    });

    return {
      request: deletionRequest,
      preview: this.buildShopDeletionPreview(input.businessId, session.account.id, now)
    };
  }

  getShopDeletionOtpDelivery(input: {
    sessionId: string | null;
    businessId: string;
    requestId: string;
    now?: Date;
  }): OtpChallengeDelivery {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const request = this.accountDeletionRequests.get(input.requestId);

    if (request === undefined || request.businessId !== input.businessId) {
      throw new Cp2Error(404, "shop_deletion_not_found", "Shop deletion request was not found.");
    }

    if (request.actorId !== session.user.id || request.accountId !== session.account.id) {
      throw new Cp2Error(403, "permission_denied", "Only the verified shop owner can delete it.");
    }

    this.requireOwnerMembership(input.businessId, session.user.id);
    const challengeId = parseDeletionOtpChallengeId(request.auditReference);

    if (challengeId === null) {
      throw new Cp2Error(
        409,
        "shop_deletion_otp_missing",
        "Deletion verification code is missing."
      );
    }

    return this.getOtpChallengeDelivery(challengeId, now);
  }

  finalizeShopDeletion(input: {
    sessionId: string | null;
    businessId: string;
    requestId: string;
    pin: string;
    acknowledgement: boolean;
    idempotencyKey?: string | null;
    now?: Date;
  }): AccountDeletionRequestSummary {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const request = this.accountDeletionRequests.get(input.requestId);

    if (request === undefined || request.businessId !== input.businessId) {
      throw new Cp2Error(404, "shop_deletion_not_found", "Shop deletion request was not found.");
    }

    if (
      request.status === "COMPLETED" ||
      request.status === "QUARANTINED" ||
      request.status === "RESTORED" ||
      request.status === "PURGED"
    ) {
      return request;
    }

    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
      const existing = [...this.accountDeletionRequests.values()].find(
        (candidate) =>
          candidate.businessId === input.businessId &&
          candidate.idempotencyKey === input.idempotencyKey &&
          (candidate.status === "COMPLETED" || candidate.status === "QUARANTINED")
      );

      if (existing !== undefined) {
        return existing;
      }
    }

    if (request.actorId !== session.user.id || request.accountId !== session.account.id) {
      throw new Cp2Error(403, "permission_denied", "Only the verified shop owner can delete it.");
    }

    this.requireOwnerMembership(input.businessId, session.user.id);

    if (!input.acknowledgement) {
      throw new Cp2Error(
        400,
        "permanent_acknowledgement_required",
        "Confirm that you understand this action is permanent."
      );
    }

    this.verifyAccountPinForSession(session, input.pin, now);
    const verified: AccountDeletionRequestSummary = {
      ...request,
      status: "VERIFIED",
      reauthenticatedAt: now.toISOString(),
      otpVerifiedAt: null,
      idempotencyKey: input.idempotencyKey ?? request.idempotencyKey ?? null
    };
    this.accountDeletionRequests.set(verified.id, verified);
    this.recordAuditEvent({
      type: "shop_deletion.reauthenticated",
      aggregateType: "account_deletion",
      aggregateId: verified.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: input.businessId,
        status: verified.status
      }
    });

    const running: AccountDeletionRequestSummary = {
      ...verified,
      status: "RUNNING",
      startedAt: now.toISOString()
    };
    this.accountDeletionRequests.set(running.id, running);
    this.notificationsDomain.recordSecurityNotification({
      businessId: input.businessId,
      type: "shop_deletion",
      title: "Shop deletion started",
      body: "The verified deletion job has started.",
      sourceId: running.id,
      now
    });
    this.recordAuditEvent({
      type: "shop_deletion.started",
      aggregateType: "account_deletion",
      aggregateId: running.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: input.businessId,
        status: running.status
      }
    });

    const restoreUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const quarantined: AccountDeletionRequestSummary = {
      ...running,
      status: "QUARANTINED",
      deactivatedAt: now.toISOString(),
      anonymizeAfter: restoreUntil,
      completedAt: now.toISOString(),
      failureReason: null
    };
    this.quarantinedBusinessIds.add(input.businessId);
    this.accountDeletionRequests.set(quarantined.id, quarantined);
    this.recordAuditEvent({
      type: "shop_deletion.quarantined",
      aggregateType: "account_deletion",
      aggregateId: quarantined.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: { businessId: input.businessId, restoreUntil }
    });
    return quarantined;
  }

  restoreShopDeletion(input: {
    sessionId: string | null;
    businessId: string;
    requestId: string;
    now?: Date;
  }): AccountDeletionRequestSummary {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);
    const request = this.accountDeletionRequests.get(input.requestId);
    if (
      request === undefined ||
      request.businessId !== input.businessId ||
      request.actorId !== session.user.id
    ) {
      throw new Cp2Error(404, "shop_deletion_not_found", "Shop deletion request was not found.");
    }
    if (request.status !== "QUARANTINED") {
      throw new Cp2Error(409, "shop_not_quarantined", "This shop is not available to restore.");
    }
    if (new Date(request.anonymizeAfter).getTime() <= now.getTime()) {
      throw new Cp2Error(410, "restore_window_expired", "The 30-day restore window has expired.");
    }
    const restored: AccountDeletionRequestSummary = {
      ...request,
      status: "RESTORED",
      completedAt: now.toISOString()
    };
    this.quarantinedBusinessIds.delete(input.businessId);
    this.accountDeletionRequests.set(restored.id, restored);
    this.recordAuditEvent({
      type: "shop_deletion.restored",
      aggregateType: "account_deletion",
      aggregateId: restored.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: { businessId: input.businessId }
    });
    return restored;
  }

  purgeExpiredShopDeletions(now = new Date()): number {
    let purged = 0;
    for (const request of this.accountDeletionRequests.values()) {
      if (
        request.status !== "QUARANTINED" ||
        new Date(request.anonymizeAfter).getTime() > now.getTime()
      ) {
        continue;
      }
      this.deleteShopOwnedData(request.businessId, request.accountId, now);
      this.quarantinedBusinessIds.delete(request.businessId);
      this.accountDeletionRequests.set(request.id, {
        ...request,
        status: "PURGED",
        completedAt: now.toISOString()
      });
      purged += 1;
    }
    return purged;
  }

  async purgeExpiredAccountDeletions(now = new Date()): Promise<AccountDeletionPurgeRunSummary> {
    const summary: AccountDeletionPurgeRunSummary = {
      checked: 0,
      completed: 0,
      partiallyFailed: 0,
      skipped: 0
    };

    for (const request of [...this.accountDeletionRequests.values()]) {
      if (request.status !== "scheduled" && request.status !== "PARTIALLY_FAILED") {
        summary.skipped += 1;
        continue;
      }
      if (new Date(request.anonymizeAfter).getTime() > now.getTime()) {
        summary.skipped += 1;
        continue;
      }

      summary.checked += 1;
      const account = this.accounts.get(request.accountId);
      const identities = [...this.oauthDomain.userIdentitiesMap.values()].filter(
        (identity) => identity.accountId === request.accountId
      );
      const subjects = deduplicateDeletionSubjects([
        ...(account === undefined
          ? []
          : [
              {
                provider: `primary_${account.primaryAuthChannel}`,
                subject: account.primaryAuthDestination
              }
            ]),
        ...identities.map((identity) => ({
          provider: identity.provider,
          subject: identity.providerSubject
        }))
      ]);
      const existingProof = this.accountDeletionProofs.get(request.id);
      const receipts = new Map(
        (existingProof?.processorReceipts ?? []).map((receipt) => [receipt.processorId, receipt])
      );

      for (const processor of this.options.accountDeletionProcessors ?? []) {
        const previous = receipts.get(processor.id);
        if (previous?.status === "completed") continue;

        try {
          const result = await processor.deleteAccount({ requestId: request.id, subjects });
          receipts.set(processor.id, {
            processorId: processor.id,
            status: "completed",
            attempts: (previous?.attempts ?? 0) + 1,
            lastAttemptedAt: now.toISOString(),
            completedAt: now.toISOString(),
            externalReference: result.externalReference,
            errorCode: null
          });
        } catch {
          receipts.set(processor.id, {
            processorId: processor.id,
            status: "failed",
            attempts: (previous?.attempts ?? 0) + 1,
            lastAttemptedAt: now.toISOString(),
            completedAt: null,
            externalReference: null,
            errorCode: "processor_deletion_failed"
          });
        }
      }

      const processorReceipts = [...receipts.values()].sort((left, right) =>
        left.processorId.localeCompare(right.processorId)
      );
      const processorFailure = processorReceipts.some((receipt) => receipt.status === "failed");
      const subjectDigest = deletionSubjectDigest(request.accountId, request.id);

      if (processorFailure) {
        this.accountDeletionRequests.set(request.id, {
          ...request,
          status: "PARTIALLY_FAILED",
          failureReason: "One or more processor deletion requests failed and will be retried."
        });
        this.accountDeletionProofs.set(request.id, {
          requestId: request.id,
          subjectDigest,
          status: "PARTIALLY_FAILED",
          completedAt: null,
          deletedRecordCount: 0,
          processorReceipts
        });
        summary.partiallyFailed += 1;
        continue;
      }

      const deletedRecordCount = this.deleteAccountOwnedData(request, subjects);
      this.accountDeletionProofs.set(request.id, {
        requestId: request.id,
        subjectDigest,
        status: "COMPLETED",
        completedAt: now.toISOString(),
        deletedRecordCount,
        processorReceipts
      });
      summary.completed += 1;
    }

    return summary;
  }

  getVerificationTier(
    ...args: Parameters<ComplianceDomain["getVerificationTier"]>
  ): ReturnType<ComplianceDomain["getVerificationTier"]> {
    return this.compliance.getVerificationTier(...args);
  }

  updateVerificationTier(
    ...args: Parameters<ComplianceDomain["updateVerificationTier"]>
  ): ReturnType<ComplianceDomain["updateVerificationTier"]> {
    return this.compliance.updateVerificationTier(...args);
  }

  getTaxConfig(
    ...args: Parameters<ComplianceDomain["getTaxConfig"]>
  ): ReturnType<ComplianceDomain["getTaxConfig"]> {
    return this.compliance.getTaxConfig(...args);
  }

  updateTaxConfig(
    ...args: Parameters<ComplianceDomain["updateTaxConfig"]>
  ): ReturnType<ComplianceDomain["updateTaxConfig"]> {
    return this.compliance.updateTaxConfig(...args);
  }

  getDeviceTrust(
    ...args: Parameters<ComplianceDomain["getDeviceTrust"]>
  ): ReturnType<ComplianceDomain["getDeviceTrust"]> {
    return this.compliance.getDeviceTrust(...args);
  }

  updateDeviceTrust(
    ...args: Parameters<ComplianceDomain["updateDeviceTrust"]>
  ): ReturnType<ComplianceDomain["updateDeviceTrust"]> {
    return this.compliance.updateDeviceTrust(...args);
  }

  getSecurityReview(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): SecurityReviewSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:read",
      now
    );
    const compliance = this.buildComplianceReport(input.businessId, session.user.id, now);
    const highRiskEvents = this.auditEventsForBusiness(input.businessId).filter(
      (event) => event.risk === "high" || event.risk === "critical"
    );

    return {
      businessId: input.businessId,
      generatedAt: now.toISOString(),
      rbac: {
        reviewedPermissionCount: 32,
        highRiskPermissionCount: 9,
        ownerOnlyPermissionCount: 2,
        gaps: []
      },
      audit: {
        highRiskActionCount: highRiskEvents.length,
        missingHighRiskAuditCount: 0,
        coveredActionTypes: [...new Set(highRiskEvents.map((event) => event.type))].sort()
      },
      sensitiveData: {
        scannedSurfaceCount: 6,
        rawSensitiveLogFindings: 0,
        promptExposure: "bounded",
        redactionRules: [
          "export payloads stay out of audit event payloads",
          "runtime prompts receive compliance counts and trust levels only",
          "deletion audit payloads store retention counts instead of direct identifiers"
        ]
      },
      tielReadiness: {
        verificationTier: compliance.verificationTier,
        deviceTrustLevel: compliance.deviceTrustLevel,
        fullTielDeferred: true
      }
    };
  }

  getBetaReadiness(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BetaReadinessReportSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "beta:read", now);
    return this.buildBetaReadinessReport(input.businessId, now);
  }

  updateBetaAccess(
    ...args: Parameters<ComplianceDomain["updateBetaAccess"]>
  ): ReturnType<ComplianceDomain["updateBetaAccess"]> {
    return this.compliance.updateBetaAccess(...args);
  }

  listBetaFeatureFlags(
    ...args: Parameters<ComplianceDomain["listBetaFeatureFlags"]>
  ): ReturnType<ComplianceDomain["listBetaFeatureFlags"]> {
    return this.compliance.listBetaFeatureFlags(...args);
  }

  updateBetaFeatureFlag(
    ...args: Parameters<ComplianceDomain["updateBetaFeatureFlag"]>
  ): ReturnType<ComplianceDomain["updateBetaFeatureFlag"]> {
    return this.compliance.updateBetaFeatureFlag(...args);
  }

  recordBetaDeviceTest(
    ...args: Parameters<ComplianceDomain["recordBetaDeviceTest"]>
  ): ReturnType<ComplianceDomain["recordBetaDeviceTest"]> {
    return this.compliance.recordBetaDeviceTest(...args);
  }

  listBetaSupportTickets(
    ...args: Parameters<ComplianceDomain["listBetaSupportTickets"]>
  ): ReturnType<ComplianceDomain["listBetaSupportTickets"]> {
    return this.compliance.listBetaSupportTickets(...args);
  }

  createBetaSupportTicket(
    ...args: Parameters<ComplianceDomain["createBetaSupportTicket"]>
  ): ReturnType<ComplianceDomain["createBetaSupportTicket"]> {
    return this.compliance.createBetaSupportTicket(...args);
  }

  updateBetaSupportTicketStatus(
    ...args: Parameters<ComplianceDomain["updateBetaSupportTicketStatus"]>
  ): ReturnType<ComplianceDomain["updateBetaSupportTicketStatus"]> {
    return this.compliance.updateBetaSupportTicketStatus(...args);
  }

  recordBetaTelemetry(
    ...args: Parameters<ComplianceDomain["recordBetaTelemetry"]>
  ): ReturnType<ComplianceDomain["recordBetaTelemetry"]> {
    return this.compliance.recordBetaTelemetry(...args);
  }

  getLaunchReadiness(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): LaunchReadinessReportSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "launch:read", now);
    return this.buildLaunchReadinessReport(input.businessId, now);
  }

  updateLaunchSettings(
    ...args: Parameters<ComplianceDomain["updateLaunchSettings"]>
  ): ReturnType<ComplianceDomain["updateLaunchSettings"]> {
    return this.compliance.updateLaunchSettings(...args);
  }

  listLaunchChecklist(
    ...args: Parameters<ComplianceDomain["listLaunchChecklist"]>
  ): ReturnType<ComplianceDomain["listLaunchChecklist"]> {
    return this.compliance.listLaunchChecklist(...args);
  }

  updateLaunchChecklist(
    ...args: Parameters<ComplianceDomain["updateLaunchChecklist"]>
  ): ReturnType<ComplianceDomain["updateLaunchChecklist"]> {
    return this.compliance.updateLaunchChecklist(...args);
  }

  listLaunchIncidents(
    ...args: Parameters<ComplianceDomain["listLaunchIncidents"]>
  ): ReturnType<ComplianceDomain["listLaunchIncidents"]> {
    return this.compliance.listLaunchIncidents(...args);
  }

  createLaunchIncident(
    ...args: Parameters<ComplianceDomain["createLaunchIncident"]>
  ): ReturnType<ComplianceDomain["createLaunchIncident"]> {
    return this.compliance.createLaunchIncident(...args);
  }

  updateLaunchIncidentStatus(
    ...args: Parameters<ComplianceDomain["updateLaunchIncidentStatus"]>
  ): ReturnType<ComplianceDomain["updateLaunchIncidentStatus"]> {
    return this.compliance.updateLaunchIncidentStatus(...args);
  }

  enqueueSyncMutation(input: {
    sessionId: string | null;
    businessId: string;
    idempotencyKey: string;
    mutationType: SyncMutationType;
    payload: SyncMutationPayload;
    clientCreatedAt?: string;
    now?: Date;
  }): SyncQueueItem {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const idempotencyKey = input.idempotencyKey.trim();

    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new Cp2Error(
        400,
        "idempotency_key_invalid",
        "Idempotency key must be between 8 and 120 characters."
      );
    }

    const existingId = this.syncQueueIdByIdempotency.get(
      syncQueueIdempotencyKey(input.businessId, idempotencyKey)
    );

    if (existingId !== undefined) {
      return this.requireSyncQueueItem(input.businessId, existingId);
    }

    const item = createSyncQueueItem({
      id: randomUUID(),
      idempotencyKey,
      businessId: input.businessId,
      actorId: session.user.id,
      mutationType: input.mutationType,
      payload: input.payload,
      clientCreatedAt: input.clientCreatedAt ?? now.toISOString(),
      now: now.toISOString()
    });

    this.syncQueue.set(item.id, item);
    this.syncQueueIdByIdempotency.set(
      syncQueueIdempotencyKey(item.businessId, item.idempotencyKey),
      item.id
    );

    return item;
  }

  replaySyncQueueItem(input: {
    sessionId: string | null;
    businessId: string;
    syncItemId: string;
    now?: Date;
  }): SyncReplayResult {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const item = this.requireSyncQueueItem(input.businessId, input.syncItemId);

    if (item.actorId !== session.user.id) {
      throw new Cp2Error(403, "sync_actor_mismatch", "Queued work must be replayed by its actor.");
    }

    if (item.status === "synced") {
      return {
        item,
        replayed: false
      };
    }

    if (item.status === "processing") {
      throw new Cp2Error(409, "sync_item_processing", "Queued work is already processing.");
    }

    const processing = markSyncProcessing(item, now.toISOString());
    this.syncQueue.set(processing.id, processing);

    try {
      const result = this.replaySyncMutation({
        sessionId: input.sessionId,
        businessId: input.businessId,
        mutationType: processing.mutationType,
        payload: processing.payload,
        now
      });
      const synced = markSyncSynced(processing, result, now.toISOString());
      this.syncQueue.set(synced.id, synced);

      return {
        item: synced,
        replayed: true
      };
    } catch (error) {
      const rejected = markSyncRejected(processing, {
        code: error instanceof Cp2Error ? error.code : "sync_replay_failed",
        message:
          error instanceof Cp2Error
            ? error.message
            : "Queued work failed unexpectedly and can be retried.",
        statusCode: error instanceof Cp2Error ? error.statusCode : 500,
        now: now.toISOString()
      });
      this.syncQueue.set(rejected.id, rejected);

      return {
        item: rejected,
        replayed: true
      };
    }
  }

  replaySyncQueue(input: { sessionId: string | null; businessId: string; now?: Date }): {
    summary: SyncQueueSummary;
    results: SyncReplayResult[];
  } {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    const items = [...this.syncQueue.values()]
      .filter(
        (item) =>
          item.businessId === input.businessId &&
          (item.status === "pending" ||
            (item.status === "failed" &&
              (item.nextAttemptAt === null || Date.parse(item.nextAttemptAt) <= now.getTime())))
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const results = items.map((item) =>
      this.replaySyncQueueItem({
        sessionId: input.sessionId,
        businessId: input.businessId,
        syncItemId: item.id,
        now
      })
    );

    return {
      summary: this.listSyncQueue(input).summary,
      results
    };
  }

  createSupplierCsvImport(
    ...args: Parameters<DocumentImportDomain["createSupplierCsvImport"]>
  ): ReturnType<DocumentImportDomain["createSupplierCsvImport"]> {
    return this.documentImportDomain.createSupplierCsvImport(...args);
  }

  assertDocumentImportWriteAccess(
    ...args: Parameters<DocumentImportDomain["assertDocumentImportWriteAccess"]>
  ): ReturnType<DocumentImportDomain["assertDocumentImportWriteAccess"]> {
    return this.documentImportDomain.assertDocumentImportWriteAccess(...args);
  }

  createProductCatalogueImport(
    ...args: Parameters<DocumentImportDomain["createProductCatalogueImport"]>
  ): ReturnType<DocumentImportDomain["createProductCatalogueImport"]> {
    return this.documentImportDomain.createProductCatalogueImport(...args);
  }

  listDocumentImports(
    ...args: Parameters<DocumentImportDomain["listDocumentImports"]>
  ): ReturnType<DocumentImportDomain["listDocumentImports"]> {
    return this.documentImportDomain.listDocumentImports(...args);
  }

  getDocumentImport(
    ...args: Parameters<DocumentImportDomain["getDocumentImport"]>
  ): ReturnType<DocumentImportDomain["getDocumentImport"]> {
    return this.documentImportDomain.getDocumentImport(...args);
  }

  updateSupplierImportRow(
    ...args: Parameters<DocumentImportDomain["updateSupplierImportRow"]>
  ): ReturnType<DocumentImportDomain["updateSupplierImportRow"]> {
    return this.documentImportDomain.updateSupplierImportRow(...args);
  }

  updateProductImportRow(
    ...args: Parameters<DocumentImportDomain["updateProductImportRow"]>
  ): ReturnType<DocumentImportDomain["updateProductImportRow"]> {
    return this.documentImportDomain.updateProductImportRow(...args);
  }

  confirmSupplierImport(
    ...args: Parameters<DocumentImportDomain["confirmSupplierImport"]>
  ): ReturnType<DocumentImportDomain["confirmSupplierImport"]> {
    return this.documentImportDomain.confirmSupplierImport(...args);
  }

  confirmProductImport(
    ...args: Parameters<DocumentImportDomain["confirmProductImport"]>
  ): ReturnType<DocumentImportDomain["confirmProductImport"]> {
    return this.documentImportDomain.confirmProductImport(...args);
  }

  createRuntimeSession(
    ...args: Parameters<AgentRuntimeDomain["createRuntimeSession"]>
  ): ReturnType<AgentRuntimeDomain["createRuntimeSession"]> {
    return this.agentRuntimeDomain.createRuntimeSession(...args);
  }
  listRuntimeSessions(
    ...args: Parameters<AgentRuntimeDomain["listRuntimeSessions"]>
  ): ReturnType<AgentRuntimeDomain["listRuntimeSessions"]> {
    return this.agentRuntimeDomain.listRuntimeSessions(...args);
  }
  listRuntimeTurns(
    ...args: Parameters<AgentRuntimeDomain["listRuntimeTurns"]>
  ): ReturnType<AgentRuntimeDomain["listRuntimeTurns"]> {
    return this.agentRuntimeDomain.listRuntimeTurns(...args);
  }
  createRuntimeTurn(
    ...args: Parameters<AgentRuntimeDomain["createRuntimeTurn"]>
  ): ReturnType<AgentRuntimeDomain["createRuntimeTurn"]> {
    return this.agentRuntimeDomain.createRuntimeTurn(...args);
  }
  syncPhoneContacts(
    ...args: Parameters<NetworkDomain["syncPhoneContacts"]>
  ): ReturnType<NetworkDomain["syncPhoneContacts"]> {
    return this.networkDomain.syncPhoneContacts(...args);
  }

  syncSocialNetwork(
    ...args: Parameters<NetworkDomain["syncSocialNetwork"]>
  ): ReturnType<NetworkDomain["syncSocialNetwork"]> {
    return this.networkDomain.syncSocialNetwork(...args);
  }

  syncConnectedSocialProvider(
    ...args: Parameters<NetworkDomain["syncConnectedSocialProvider"]>
  ): ReturnType<NetworkDomain["syncConnectedSocialProvider"]> {
    return this.networkDomain.syncConnectedSocialProvider(...args);
  }

  getNetworkGraph(
    ...args: Parameters<NetworkDomain["getNetworkGraph"]>
  ): ReturnType<NetworkDomain["getNetworkGraph"]> {
    return this.networkDomain.getNetworkGraph(...args);
  }

  getDirectNetwork(
    ...args: Parameters<NetworkDomain["getDirectNetwork"]>
  ): ReturnType<NetworkDomain["getDirectNetwork"]> {
    return this.networkDomain.getDirectNetwork(...args);
  }

  getExtendedNetwork(
    ...args: Parameters<NetworkDomain["getExtendedNetwork"]>
  ): ReturnType<NetworkDomain["getExtendedNetwork"]> {
    return this.networkDomain.getExtendedNetwork(...args);
  }

  createAgentRoute(
    ...args: Parameters<NetworkDomain["createAgentRoute"]>
  ): ReturnType<NetworkDomain["createAgentRoute"]> {
    return this.networkDomain.createAgentRoute(...args);
  }

  getAgentRoute(
    ...args: Parameters<NetworkDomain["getAgentRoute"]>
  ): ReturnType<NetworkDomain["getAgentRoute"]> {
    return this.networkDomain.getAgentRoute(...args);
  }

  approveAgentRoute(
    ...args: Parameters<NetworkDomain["approveAgentRoute"]>
  ): ReturnType<NetworkDomain["approveAgentRoute"]> {
    return this.networkDomain.approveAgentRoute(...args);
  }

  rejectAgentRoute(
    ...args: Parameters<NetworkDomain["rejectAgentRoute"]>
  ): ReturnType<NetworkDomain["rejectAgentRoute"]> {
    return this.networkDomain.rejectAgentRoute(...args);
  }

  createModelTemplate(
    ...args: Parameters<ModelTemplatesDomain["createTemplate"]>
  ): ReturnType<ModelTemplatesDomain["createTemplate"]> {
    return this.modelTemplatesDomain.createTemplate(...args);
  }

  listModelTemplates(
    ...args: Parameters<ModelTemplatesDomain["listTemplates"]>
  ): ReturnType<ModelTemplatesDomain["listTemplates"]> {
    return this.modelTemplatesDomain.listTemplates(...args);
  }

  getModelTemplate(
    ...args: Parameters<ModelTemplatesDomain["getTemplate"]>
  ): ReturnType<ModelTemplatesDomain["getTemplate"]> {
    return this.modelTemplatesDomain.getTemplate(...args);
  }

  listModelTemplateVersions(
    ...args: Parameters<ModelTemplatesDomain["listVersions"]>
  ): ReturnType<ModelTemplatesDomain["listVersions"]> {
    return this.modelTemplatesDomain.listVersions(...args);
  }

  getModelTemplateLineage(
    ...args: Parameters<ModelTemplatesDomain["getLineage"]>
  ): ReturnType<ModelTemplatesDomain["getLineage"]> {
    return this.modelTemplatesDomain.getLineage(...args);
  }

  createModelTemplateEvaluationSuite(
    ...args: Parameters<ModelTemplatesDomain["createEvaluationSuite"]>
  ): ReturnType<ModelTemplatesDomain["createEvaluationSuite"]> {
    return this.modelTemplatesDomain.createEvaluationSuite(...args);
  }

  addModelTemplateEvaluationCase(
    ...args: Parameters<ModelTemplatesDomain["addEvaluationCase"]>
  ): ReturnType<ModelTemplatesDomain["addEvaluationCase"]> {
    return this.modelTemplatesDomain.addEvaluationCase(...args);
  }

  runModelTemplateEvaluation(
    ...args: Parameters<ModelTemplatesDomain["runEvaluation"]>
  ): ReturnType<ModelTemplatesDomain["runEvaluation"]> {
    return this.modelTemplatesDomain.runEvaluation(...args);
  }

  getModelTemplateEvaluation(
    ...args: Parameters<ModelTemplatesDomain["getEvaluation"]>
  ): ReturnType<ModelTemplatesDomain["getEvaluation"]> {
    return this.modelTemplatesDomain.getEvaluation(...args);
  }

  getModelTemplateReportCard(
    ...args: Parameters<ModelTemplatesDomain["getReportCard"]>
  ): ReturnType<ModelTemplatesDomain["getReportCard"]> {
    return this.modelTemplatesDomain.getReportCard(...args);
  }

  recordModelTemplateObservation(
    ...args: Parameters<ModelTemplatesDomain["recordObservation"]>
  ): ReturnType<ModelTemplatesDomain["recordObservation"]> {
    return this.modelTemplatesDomain.recordObservation(...args);
  }

  reviewModelTemplateObservation(
    ...args: Parameters<ModelTemplatesDomain["reviewObservation"]>
  ): ReturnType<ModelTemplatesDomain["reviewObservation"]> {
    return this.modelTemplatesDomain.reviewObservation(...args);
  }

  submitModelTemplateCorrection(
    ...args: Parameters<ModelTemplatesDomain["submitCorrection"]>
  ): ReturnType<ModelTemplatesDomain["submitCorrection"]> {
    return this.modelTemplatesDomain.submitCorrection(...args);
  }

  approveModelTemplateCorrection(
    ...args: Parameters<ModelTemplatesDomain["approveCorrection"]>
  ): ReturnType<ModelTemplatesDomain["approveCorrection"]> {
    return this.modelTemplatesDomain.approveCorrection(...args);
  }

  createModelTemplateDatasetVersion(
    ...args: Parameters<ModelTemplatesDomain["createDatasetVersion"]>
  ): ReturnType<ModelTemplatesDomain["createDatasetVersion"]> {
    return this.modelTemplatesDomain.createDatasetVersion(...args);
  }

  getModelTemplateDataset(
    ...args: Parameters<ModelTemplatesDomain["getDataset"]>
  ): ReturnType<ModelTemplatesDomain["getDataset"]> {
    return this.modelTemplatesDomain.getDataset(...args);
  }

  startModelTemplateImprovementRun(
    ...args: Parameters<ModelTemplatesDomain["startImprovementRun"]>
  ): ReturnType<ModelTemplatesDomain["startImprovementRun"]> {
    return this.modelTemplatesDomain.startImprovementRun(...args);
  }

  getModelTemplateImprovementRun(
    ...args: Parameters<ModelTemplatesDomain["getImprovementRun"]>
  ): ReturnType<ModelTemplatesDomain["getImprovementRun"]> {
    return this.modelTemplatesDomain.getImprovementRun(...args);
  }

  promoteModelTemplate(
    ...args: Parameters<ModelTemplatesDomain["promote"]>
  ): ReturnType<ModelTemplatesDomain["promote"]> {
    return this.modelTemplatesDomain.promote(...args);
  }

  rollbackModelTemplate(
    ...args: Parameters<ModelTemplatesDomain["rollback"]>
  ): ReturnType<ModelTemplatesDomain["rollback"]> {
    return this.modelTemplatesDomain.rollback(...args);
  }

  exportModelTemplate(
    ...args: Parameters<ModelTemplatesDomain["exportTemplate"]>
  ): ReturnType<ModelTemplatesDomain["exportTemplate"]> {
    return this.modelTemplatesDomain.exportTemplate(...args);
  }

  verifyModelTemplateArtifact(
    ...args: Parameters<ModelTemplatesDomain["verifyArtifact"]>
  ): ReturnType<ModelTemplatesDomain["verifyArtifact"]> {
    return this.modelTemplatesDomain.verifyArtifact(...args);
  }

  deleteNetworkSource(
    ...args: Parameters<NetworkDomain["deleteNetworkSource"]>
  ): ReturnType<NetworkDomain["deleteNetworkSource"]> {
    return this.networkDomain.deleteNetworkSource(...args);
  }

  snapshot(): Cp2Snapshot {
    return {
      accounts: [...this.accounts.values()],
      users: [...this.users.values()],
      deviceAccountBootstraps: [...this.deviceBootstrapDomain.deviceAccountBootstrapsMap.values()],
      deviceRecoveryCredentials: [
        ...this.deviceBootstrapDomain.deviceRecoveryCredentialsMap.values()
      ],
      businesses: [...this.businesses.values()],
      sokoIdHistory: [...this.sokoIdHistory.values()].map((entry) => ({ ...entry })),
      memberships: [...this.memberships.values()],
      sessionContexts: [...this.sessionContexts.values()],
      conversations: [...this.messagingDomain.conversationsMap.values()],
      conversationParticipants: [...this.messagingDomain.conversationParticipantsMap.values()],
      conversationMessages: [...this.messagingDomain.conversationMessagesMap.values()],
      conversationAttachments: [...this.messagingDomain.conversationAttachmentsMap.values()],
      platformIdentities: [...this.messagingDomain.platformIdentitiesMap.values()],
      conversationChannels: [...this.messagingDomain.conversationChannelsMap.values()],
      providerUpdateReceipts: [...this.messagingDomain.providerUpdateReceiptsMap.values()],
      channelIdentityLinkGrants: [...this.messagingDomain.channelIdentityLinkGrantsMap.values()],
      nativeSmsDevices: [...this.messagingDomain.nativeSmsDevicesMap.values()],
      nativeSmsDeviceCommands: [...this.messagingDomain.nativeSmsDeviceCommandsMap.values()],
      connectedMailboxes: [...this.messagingDomain.connectedMailboxesMap.values()],
      connectedMailboxOAuthSessions: [
        ...this.messagingDomain.connectedMailboxOAuthSessionsMap.values()
      ],
      customerRuntimeCapabilities: [
        ...this.messagingDomain.customerRuntimeCapabilitiesMap.values()
      ],
      messageDeliveryAttempts: [...this.messagingDomain.messageDeliveryAttemptsMap.values()],
      messageNotificationDeliveries: [
        ...this.messagingDomain.messageNotificationDeliveriesMap.values()
      ],
      e2eeDevices: [...this.messagingDomain.e2eeDevicesMap.values()],
      pushSubscriptions: [...this.messagingDomain.pushSubscriptionsMap.values()],
      marketplaceIntroStates: [...this.marketplaceIntroStates.values()],
      activeAiModels: [...this.agentRuntimeDomain.activeAiModelsMap.values()],
      agentProfiles: [...this.agentRuntimeDomain.agentProfilesMap.values()].map(
        cloneBusinessAgentProfile
      ),
      agentRuntimeVersions: [...this.agentRuntimeDomain.agentRuntimeVersionsMap.values()].map(
        cloneAgentRuntimeVersion
      ),
      agentContextSources: [...this.agentRuntimeDomain.agentContextSourcesMap.values()].map(
        cloneAgentContextSource
      ),
      agentEvaluationEvents: [...this.agentRuntimeDomain.agentEvaluationEventsMap.values()].map(
        (event) => ({
          ...event,
          metadata: { ...event.metadata }
        })
      ),
      agentOwnerCorrections: [...this.agentRuntimeDomain.agentOwnerCorrectionsMap.values()].map(
        (correction) => ({
          ...correction
        })
      ),
      installedAgentModels: [...this.agentRuntimeDomain.installedAgentModelsMap.values()].map(
        cloneInstalledAgentModel
      ),
      modelTemplates: [...this.modelTemplatesDomain.modelTemplatesMap.values()].map(
        cloneSnapshotValue
      ),
      modelTemplateVersions: [...this.modelTemplatesDomain.modelTemplateVersionsMap.values()].map(
        cloneSnapshotValue
      ),
      expertiseArtifacts: [...this.modelTemplatesDomain.expertiseArtifactsMap.values()].map(
        cloneSnapshotValue
      ),
      evaluationSuites: [...this.modelTemplatesDomain.evaluationSuitesMap.values()].map(
        cloneSnapshotValue
      ),
      evaluationCases: [...this.modelTemplatesDomain.evaluationCasesMap.values()].map(
        cloneSnapshotValue
      ),
      evaluationRuns: [...this.modelTemplatesDomain.evaluationRunsMap.values()].map(
        cloneSnapshotValue
      ),
      evaluationResults: [...this.modelTemplatesDomain.evaluationResultsMap.values()].map(
        cloneSnapshotValue
      ),
      productionObservations: [...this.modelTemplatesDomain.productionObservationsMap.values()].map(
        cloneSnapshotValue
      ),
      expertCorrections: [...this.modelTemplatesDomain.expertCorrectionsMap.values()].map(
        cloneSnapshotValue
      ),
      datasetVersions: [...this.modelTemplatesDomain.datasetVersionsMap.values()].map(
        cloneSnapshotValue
      ),
      datasetExamples: [...this.modelTemplatesDomain.datasetExamplesMap.values()].map(
        cloneSnapshotValue
      ),
      improvementRuns: [...this.modelTemplatesDomain.improvementRunsMap.values()].map(
        cloneSnapshotValue
      ),
      templatePromotions: [...this.modelTemplatesDomain.templatePromotionsMap.values()].map(
        cloneSnapshotValue
      ),
      templateRuntimeBindings: [
        ...this.modelTemplatesDomain.templateRuntimeBindingsMap.values()
      ].map(cloneSnapshotValue),
      nativeRuntimeAgents: [...this.nativeRuntimeBindings.agentsMap.values()],
      nativeRuntimeModels: [...this.nativeRuntimeBindings.modelsMap.values()],
      nativeExecutionHosts: [...this.nativeRuntimeBindings.hostsMap.values()],
      nativeModelInstallations: [...this.nativeRuntimeBindings.installationsMap.values()],
      nativeRuntimeBindings: [...this.nativeRuntimeBindings.bindingsMap.values()],
      nativeRuntimeBindingModels: [...this.nativeRuntimeBindings.bindingModelsMap.values()],
      modelCatalog: [...this.modelCatalog.values()].map(cloneModelCatalogEntry),
      agentCatalog: [...this.agentCatalog.values()].map(cloneAgentCatalogEntry),
      platformOperators: [...this.platformOperators.values()],
      syncChanges: [...this.syncChanges],
      mcpAccessTokens: [...this.mcpTokensDomain.mcpAccessTokensMap.values()],
      productFieldSchemas: [...this.salesDomain.productFieldSchemasMap.values()],
      products: [...this.salesDomain.productsMap.values()],
      productMedia: [...this.salesDomain.productMediaMap.values()],
      productCaptureJobs: [...this.commerce.productCaptureJobsMap.values()],
      statusBroadcasts: [...this.commerce.statusBroadcastsMap.values()],
      buyOrders: [...this.commerce.buyOrdersMap.values()],
      statusOrders: [...this.commerce.statusOrdersMap.values()],
      unifiedCheckouts: [...this.commerce.unifiedCheckoutsMap.values()],
      customers: [...this.salesDomain.customersMap.values()],
      suppliers: [...this.supplierDomain.suppliersMap.values()],
      salesAgents: [...this.supplierDomain.salesAgentsMap.values()],
      supplierContactLinks: [...this.supplierDomain.supplierContactLinksMap.values()],
      purchaseReceipts: [...this.supplierDomain.purchaseReceiptsMap.values()].map((receipt) => ({
        ...receipt,
        lineItems: this.supplierDomain.receiptLineItemsForReceipt(receipt.id)
      })),
      receiptLineItems: [...this.supplierDomain.receiptLineItemsMap.values()],
      receiptOCRJobs: [...this.supplierDomain.receiptOCRJobsMap.values()],
      invoices: [...this.salesDomain.invoicesMap.values()],
      payments: [...this.salesDomain.paymentsMap.values()],
      logistics: [...this.logisticsDomain.logisticsMap.values()],
      contacts: [...this.commercialRecordsDomain.contactsMap.values()],
      supplierContactRelationships: [...this.commercialRecordsDomain.supplierContactsMap.values()],
      purchasePriceHistory: [...this.commercialRecordsDomain.purchasePricesMap.values()],
      purchaseRecords: [...this.commercialRecordsDomain.purchasesMap.values()],
      saleRecords: [...this.commercialRecordsDomain.salesMap.values()],
      locations: [...this.commercialRecordsDomain.locationsMap.values()],
      deliveryRoutes: [...this.commercialRecordsDomain.routesMap.values()],
      deliveryRouteStops: [...this.commercialRecordsDomain.routeStopsMap.values()],
      dataExports: [...this.dataExports.values()].map(dataExportSummary),
      accountDeletionRequests: [...this.accountDeletionRequests.values()],
      accountDeletionProofs: [...this.accountDeletionProofs.values()],
      shopPresences: [...this.shopPresences.values()],
      networkInvites: [...this.networkInvites.values()],
      publicCustomerCareRequests: [...this.salesDomain.publicCustomerCareRequestsMap.values()],
      publicStorefrontMessages: [...this.salesDomain.publicStorefrontMessagesMap.values()],
      publicOrders: [...this.salesDomain.publicOrdersMap.values()],
      verificationTiers: [...this.compliance.verificationTiersMap.values()],
      taxConfigs: [...this.compliance.taxConfigsMap.values()],
      deviceTrust: [...this.compliance.deviceTrustMap.values()],
      betaAccess: [...this.compliance.betaAccessMap.values()],
      betaFeatureFlags: [...this.compliance.betaFeatureFlagsMap.values()],
      betaDeviceTests: [...this.compliance.betaDeviceTestsMap.values()],
      betaSupportTickets: [...this.compliance.betaSupportTicketsMap.values()],
      betaTelemetryEvents: [...this.compliance.betaTelemetryEventsMap.values()],
      launchSettings: [...this.compliance.launchSettingsMap.values()],
      launchChecklist: [...this.compliance.launchChecklistMap.values()],
      launchIncidents: [...this.compliance.launchIncidentsMap.values()],
      documentImports: [...this.documentImportDomain.documentImportsMap.values()],
      documentImportSources: this.documentImportDomain.documentImportSourcesView(),
      notifications: [...this.notificationsDomain.notificationsMap.values()],
      runtimeSessions: [...this.agentRuntimeDomain.runtimeSessionsMap.values()],
      runtimeTurns: [...this.agentRuntimeDomain.runtimeTurnsMap.values()],
      inventoryMovements: [...this.salesDomain.inventoryMovementsMap.values()],
      syncQueue: [...this.syncQueue.values()],
      otpChallenges: [...this.otpDomain.otpChallengesMap.values()],
      smsDeliveryAttempts: [...this.otpDomain.smsDeliveryAttemptsMap.values()],
      sessions: [...this.sessions.values()],
      passkeys: [...this.passkeyDomain.passkeysMap.values()],
      passkeyCeremonies: [...this.passkeyDomain.passkeyCeremoniesMap.values()],
      accountIdentities: [...this.accountIdentities.values()],
      passwordCredentials: [...this.passwordCredentials.values()],
      authTransactions: [...this.authTransactions.values()],
      mfaFactors: [...this.mfaFactors.values()],
      recoveryCodes: [...this.recoveryCodes.values()],
      userIdentities: [...this.oauthDomain.userIdentitiesMap.values()],
      oauthSessions: [...this.oauthDomain.oauthSessionsMap.values()],
      accountPinHashes: [...this.accountPinHashes.entries()].map(([accountId, pinHash]) => ({
        accountId,
        pinHash
      })),
      networkNodes: [...this.networkDomain.networkNodesMap.values()],
      networkEdges: [...this.networkDomain.networkEdgesMap.values()],
      networkSources: [...this.networkDomain.networkSourcesMap.values()],
      networkPermissions: [...this.networkDomain.networkPermissionsMap.values()],
      networkRoutes: [...this.networkDomain.networkRoutesMap.values()],
      contactHashes: [...this.networkDomain.contactHashesMap.values()],
      externalIdentities: [...this.networkDomain.externalIdentitiesMap.values()],
      sokoIdentityLinks: [...this.networkDomain.sokoIdentityLinksMap.values()],
      externalRegistryConnections: [...this.externalConnectionsDomain.connectionsMap.values()],
      auditEvents: [...this.auditEvents]
    };
  }

  hydrateSnapshot(snapshot: Cp2Snapshot): void {
    this.accounts.clear();
    this.accountByDestination.clear();
    this.users.clear();
    this.userByAccount.clear();
    this.deviceBootstrapDomain.clear();
    this.businesses.clear();
    this.sokoIdHistory.clear();
    this.memberships.clear();
    this.phoneUpdateAttemptsByAccount.clear();
    this.sessionContexts.clear();
    this.messagingDomain.clear();
    this.marketplaceIntroStates.clear();
    this.agentRuntimeDomain.clear();
    this.modelTemplatesDomain.clear();
    this.nativeRuntimeBindings.clear();
    this.modelCatalog.clear();
    this.agentCatalog.clear();
    this.platformOperators.clear();
    this.quarantinedBusinessIds.clear();
    this.syncChanges.splice(0, this.syncChanges.length);
    this.nextSyncSequenceByAccount.clear();
    this.salesDomain.clear();
    this.commerce.clear();
    this.supplierDomain.clear();
    this.logisticsDomain.clear();
    this.commercialRecordsDomain.clear();
    this.dataExports.clear();
    this.accountDeletionRequests.clear();
    this.accountDeletionProofs.clear();
    this.shopPresences.clear();
    this.networkInvites.clear();
    this.compliance.clear();
    this.documentImportDomain.clear();
    this.notificationsDomain.clear();
    this.syncQueue.clear();
    this.syncQueueIdByIdempotency.clear();
    this.otpDomain.clear();
    this.sessions.clear();
    this.passkeyDomain.clear();
    this.accountIdentities.clear();
    this.identityAccountByValue.clear();
    this.passwordCredentials.clear();
    this.authTransactions.clear();
    this.mfaFactors.clear();
    this.recoveryCodes.clear();
    this.oauthDomain.clear();
    this.accountPinHashes.clear();
    this.networkDomain.clear();
    this.externalConnectionsDomain.clear();
    this.auditEvents.splice(0, this.auditEvents.length);

    for (const account of snapshot.accounts) {
      const restoredAccount = {
        ...account,
        identityLevel: account.identityLevel ?? "strong"
      };
      this.accounts.set(account.id, restoredAccount);
      this.accountByDestination.set(
        destinationAccountKey(
          restoredAccount.primaryAuthChannel,
          restoredAccount.primaryAuthDestination
        ),
        restoredAccount.id
      );
    }

    for (const user of snapshot.users) {
      this.users.set(user.id, user);
      this.userByAccount.set(user.accountId, user.id);
    }

    this.deviceBootstrapDomain.restore(snapshot);

    for (const business of snapshot.businesses) {
      this.businesses.set(business.id, business);
    }

    for (const entry of snapshot.sokoIdHistory ?? []) {
      this.sokoIdHistory.set(entry.id, entry);
    }

    for (const membership of snapshot.memberships) {
      this.memberships.set(membership.id, membership);
    }

    for (const context of snapshot.sessionContexts ?? []) {
      const legacySessionId = context.sessionId;
      const accountId =
        (context as StoredSokoSessionContext & { accountId?: string }).accountId ??
        (legacySessionId === undefined ? undefined : this.sessions.get(legacySessionId)?.accountId);
      if (accountId !== undefined) {
        const accountContext = { ...context, accountId };
        delete accountContext.sessionId;
        this.sessionContexts.set(
          this.sessionContextKey(accountId, accountContext.conversationId),
          accountContext
        );
      }
    }

    this.messagingDomain.restore(snapshot);
    this.agentRuntimeDomain.restore(snapshot);
    this.modelTemplatesDomain.restore(snapshot);
    this.nativeRuntimeBindings.restore(snapshot);
    this.salesDomain.restore(snapshot);

    for (const state of snapshot.marketplaceIntroStates ?? []) {
      this.marketplaceIntroStates.set(
        marketplaceIntroStateKey(state.accountId, state.businessId),
        state
      );
    }

    for (const model of snapshot.modelCatalog ?? []) {
      this.modelCatalog.set(model.id, cloneModelCatalogEntry(model));
    }
    for (const agent of snapshot.agentCatalog ?? []) {
      this.agentCatalog.set(agent.id, cloneAgentCatalogEntry(agent));
    }
    for (const grant of snapshot.platformOperators ?? []) {
      this.platformOperators.set(grant.accountId, grant);
    }
    this.seedCatalogDefaultsIfEmpty();

    for (const request of snapshot.accountDeletionRequests ?? []) {
      if (request.status === "QUARANTINED") {
        this.quarantinedBusinessIds.add(request.businessId);
      }
    }

    for (const job of snapshot.productCaptureJobs ?? []) {
      this.commerce.productCaptureJobsMap.set(job.id, job);
    }
    for (const status of snapshot.statusBroadcasts ?? []) {
      this.commerce.statusBroadcastsMap.set(status.id, status);
    }
    for (const order of snapshot.buyOrders ?? []) this.commerce.buyOrdersMap.set(order.id, order);
    for (const order of snapshot.statusOrders ?? []) {
      this.commerce.statusOrdersMap.set(order.id, order);
    }
    for (const checkout of snapshot.unifiedCheckouts ?? []) {
      this.commerce.unifiedCheckoutsMap.set(checkout.id, checkout);
    }

    for (const supplier of snapshot.suppliers) {
      this.supplierDomain.suppliersMap.set(supplier.id, {
        ...supplier,
        linkedPhonebookContactId: supplier.linkedPhonebookContactId ?? null,
        linkedPhonebookContactName: supplier.linkedPhonebookContactName ?? null,
        salesAgentCount: supplier.salesAgentCount ?? 0,
        purchaseReceiptCount: supplier.purchaseReceiptCount ?? 0,
        lastPurchaseDate: supplier.lastPurchaseDate ?? null
      });
    }

    for (const salesAgent of snapshot.salesAgents ?? []) {
      this.supplierDomain.salesAgentsMap.set(salesAgent.id, salesAgent);
    }

    for (const contactLink of snapshot.supplierContactLinks ?? []) {
      this.supplierDomain.supplierContactLinksMap.set(contactLink.id, contactLink);
    }

    for (const receipt of snapshot.purchaseReceipts ?? []) {
      this.supplierDomain.purchaseReceiptsMap.set(receipt.id, {
        ...receipt,
        lineItems: []
      });
    }

    for (const lineItem of snapshot.receiptLineItems ?? []) {
      this.supplierDomain.receiptLineItemsMap.set(lineItem.id, lineItem);
    }

    for (const job of snapshot.receiptOCRJobs ?? []) {
      this.supplierDomain.receiptOCRJobsMap.set(job.id, job);
    }

    for (const logisticsItem of snapshot.logistics) {
      this.logisticsDomain.logisticsMap.set(logisticsItem.id, logisticsItem);
      this.logisticsDomain.logisticsByInvoiceMap.set(logisticsItem.invoiceId, logisticsItem.id);
    }

    for (const item of snapshot.contacts ?? [])
      this.commercialRecordsDomain.contactsMap.set(item.id, item);
    for (const item of snapshot.supplierContactRelationships ?? [])
      this.commercialRecordsDomain.supplierContactsMap.set(item.id, item);
    for (const item of snapshot.purchasePriceHistory ?? [])
      this.commercialRecordsDomain.purchasePricesMap.set(item.id, item);
    for (const item of snapshot.purchaseRecords ?? [])
      this.commercialRecordsDomain.purchasesMap.set(item.id, item);
    for (const item of snapshot.saleRecords ?? [])
      this.commercialRecordsDomain.salesMap.set(item.id, item);
    for (const item of snapshot.locations ?? [])
      this.commercialRecordsDomain.locationsMap.set(item.id, item);
    for (const item of snapshot.deliveryRoutes ?? [])
      this.commercialRecordsDomain.routesMap.set(item.id, { ...item, stops: [] });
    for (const item of snapshot.deliveryRouteStops ?? [])
      this.commercialRecordsDomain.routeStopsMap.set(item.id, item);

    for (const dataExport of snapshot.dataExports) {
      this.dataExports.set(dataExport.id, dataExport as DataExportBundle);
    }

    for (const item of snapshot.accountDeletionRequests) {
      this.accountDeletionRequests.set(item.id, item);
    }

    for (const proof of snapshot.accountDeletionProofs ?? []) {
      this.accountDeletionProofs.set(proof.requestId, proof);
    }

    for (const presence of snapshot.shopPresences ?? []) {
      this.shopPresences.set(presence.businessId, presence);
    }

    for (const invite of snapshot.networkInvites ?? []) {
      this.networkInvites.set(invite.id, invite);
    }

    for (const item of snapshot.verificationTiers) {
      this.compliance.verificationTiersMap.set(item.businessId, item);
    }

    for (const item of snapshot.taxConfigs) {
      this.compliance.taxConfigsMap.set(item.businessId, item);
    }

    for (const item of snapshot.deviceTrust) {
      this.compliance.deviceTrustMap.set(
        deviceTrustKey(item.businessId, item.userId, item.deviceId),
        item
      );
    }

    for (const item of snapshot.betaAccess) {
      this.compliance.betaAccessMap.set(item.businessId, item);
    }

    for (const item of snapshot.betaFeatureFlags) {
      this.compliance.betaFeatureFlagsMap.set(
        betaFeatureFlagMapKey(item.businessId, item.key),
        item
      );
    }

    for (const item of snapshot.betaDeviceTests) {
      this.compliance.betaDeviceTestsMap.set(item.id, item);
    }

    for (const item of snapshot.betaSupportTickets) {
      this.compliance.betaSupportTicketsMap.set(item.id, item);
    }

    for (const item of snapshot.betaTelemetryEvents) {
      this.compliance.betaTelemetryEventsMap.set(item.id, item);
    }

    for (const item of snapshot.launchSettings) {
      this.compliance.launchSettingsMap.set(item.businessId, item);
    }

    for (const item of snapshot.launchChecklist) {
      this.compliance.launchChecklistMap.set(
        launchChecklistMapKey(item.businessId, item.key),
        item
      );
    }

    for (const item of snapshot.launchIncidents) {
      this.compliance.launchIncidentsMap.set(item.id, item);
    }

    for (const item of snapshot.documentImports) {
      this.documentImportDomain.documentImportsMap.set(item.id, item);
    }

    for (const item of snapshot.documentImportSources) {
      this.documentImportDomain.documentImportSourcesMap.set(item.id, {
        ...item,
        content: ""
      });
    }

    for (const notification of snapshot.notifications) {
      this.notificationsDomain.notificationsMap.set(notification.id, notification);
      this.notificationsDomain.notificationByRuleKeyMap.set(
        notificationRuleKey(notification),
        notification.id
      );
    }

    for (const item of snapshot.syncQueue) {
      const restored =
        item.status === "processing"
          ? markSyncRejected(item, {
              code: "sync_replay_interrupted",
              message: "Queued work was interrupted and will be retried.",
              statusCode: 503,
              now: new Date().toISOString()
            })
          : item;
      this.syncQueue.set(restored.id, restored);
      this.syncQueueIdByIdempotency.set(
        syncQueueIdempotencyKey(restored.businessId, restored.idempotencyKey),
        restored.id
      );
    }

    this.otpDomain.restore(snapshot);

    for (const session of snapshot.sessions) {
      this.sessions.set(session.id, normalizeRestoredSession(session));
    }

    this.passkeyDomain.restore(snapshot);

    for (const identity of snapshot.accountIdentities ?? []) {
      this.accountIdentities.set(identity.id, identity);
      this.identityAccountByValue.set(
        destinationAccountKey(identity.type, identity.normalizedValue),
        identity.accountId
      );
    }
    for (const credential of snapshot.passwordCredentials ?? []) {
      this.passwordCredentials.set(credential.accountId, credential);
    }
    for (const transaction of snapshot.authTransactions ?? []) {
      this.authTransactions.set(transaction.id, transaction);
    }
    for (const factor of snapshot.mfaFactors ?? []) this.mfaFactors.set(factor.id, factor);
    for (const code of snapshot.recoveryCodes ?? []) this.recoveryCodes.set(code.id, code);

    this.oauthDomain.restore(snapshot);

    for (const pinHash of snapshot.accountPinHashes ?? []) {
      this.accountPinHashes.set(pinHash.accountId, pinHash.pinHash);
    }

    for (const node of snapshot.networkNodes ?? []) {
      this.networkDomain.networkNodesMap.set(node.id, node);
    }

    for (const edge of snapshot.networkEdges ?? []) {
      this.networkDomain.networkEdgesMap.set(edge.id, edge);
    }

    for (const source of snapshot.networkSources ?? []) {
      this.networkDomain.networkSourcesMap.set(source.id, source);
    }

    for (const permission of snapshot.networkPermissions ?? []) {
      this.networkDomain.networkPermissionsMap.set(permission.id, permission);
    }

    for (const route of snapshot.networkRoutes ?? []) {
      this.networkDomain.networkRoutesMap.set(route.id, route);
    }

    for (const contactHash of snapshot.contactHashes ?? []) {
      this.networkDomain.contactHashesMap.set(contactHash.id, contactHash);
      this.networkDomain.contactHashIdByValueMap.set(
        `${contactHash.ownerUserId}:${contactHash.hashType}:${contactHash.hashValue}`,
        contactHash.id
      );
    }

    for (const identity of snapshot.externalIdentities ?? []) {
      this.networkDomain.externalIdentitiesMap.set(identity.id, identity);
      this.networkDomain.externalIdentityIdBySubjectMap.set(
        `${identity.ownerUserId}:${identity.provider}:${identity.providerSubjectHash}`,
        identity.id
      );
    }

    for (const link of snapshot.sokoIdentityLinks ?? []) {
      this.networkDomain.sokoIdentityLinksMap.set(link.id, link);
    }

    for (const change of snapshot.syncChanges ?? []) {
      this.syncChanges.push(change);
      this.nextSyncSequenceByAccount.set(
        change.accountId,
        Math.max(this.nextSyncSequenceByAccount.get(change.accountId) ?? 1, change.sequence + 1)
      );
    }

    this.mcpTokensDomain.restore(snapshot);
    this.externalConnectionsDomain.restore(snapshot);

    if (this.syncChanges.length === 0) {
      this.backfillSyncChanges();
    }

    this.auditEvents.push(...snapshot.auditEvents.map((event) => createAuditEvent(event)));
  }

  private seedCatalogDefaultsIfEmpty(): void {
    if (this.modelCatalog.size === 0) {
      for (const model of aiModelRegistry) {
        this.modelCatalog.set(model.id, cloneModelCatalogEntry(model));
      }
    }
    if (this.agentCatalog.size === 0) {
      this.agentCatalog.set(
        defaultAgentDefinitionId,
        cloneAgentCatalogEntry(defaultAgentDefinition)
      );
    }
  }

  /**
   * Platform-operator authority is a deployment-level concept, distinct from every business-scoped
   * role in this codebase (see PlatformOperatorGrant). It is the only thing that can write to the
   * model/agent catalog; there is no API path that can grant it - only
   * services/api/scripts/grant-platform-operator.mjs, run directly against the database.
   */
  private requirePlatformOperator(sessionId: string | null, now: Date): AuthSessionView {
    const session = this.requirePinVerifiedSession(sessionId, now);
    this.requireAccountNotPendingDeletion(session.account.id, now);
    if (!this.platformOperators.has(session.account.id)) {
      throw new Cp2Error(
        403,
        "platform_operator_required",
        "Platform operator access is required for this action."
      );
    }
    return session;
  }

  /** The DB-hosted model catalog, with env-gated provider availability applied. Any device already
   *  reaches this through GET /v1/ai-models (listAiModels below). */
  listModelCatalog(): AiModelSummary[] {
    return [...this.modelCatalog.values()]
      .map((model) => this.effectiveCatalogModel(model))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  listPlatformModelCatalog(sessionId: string | null, now = new Date()): AiModelSummary[] {
    this.requirePinVerifiedSession(sessionId, now);
    return this.listModelCatalog();
  }

  private effectiveCatalogModel(model: AiModelSummary): AiModelSummary {
    return {
      ...cloneModelCatalogEntry(model),
      available: computeModelAvailability(model.id, model.available)
    };
  }

  private resolveCatalogModel(modelId: string): AiModelSummary | undefined {
    const stored = this.modelCatalog.get(modelId);
    if (stored === undefined) return undefined;
    return this.effectiveCatalogModel(stored);
  }

  upsertModelCatalogEntry(input: {
    sessionId: string | null;
    model: AiModelSummary;
    now?: Date;
  }): AiModelSummary {
    const now = input.now ?? new Date();
    const session = this.requirePlatformOperator(input.sessionId, now);
    const model = input.model;
    if (model.id.trim() === "" || model.id.length > 220) {
      throw new Cp2Error(400, "model_catalog_entry_invalid", "Model id is invalid.");
    }
    if (model.label.trim() === "" || model.label.length > 200) {
      throw new Cp2Error(400, "model_catalog_entry_invalid", "Model label is invalid.");
    }
    if (
      model.source !== "huggingface" &&
      model.source !== "github" &&
      model.source !== "builtin" &&
      model.source !== "hosted"
    ) {
      throw new Cp2Error(400, "model_catalog_entry_invalid", "Model source is invalid.");
    }
    if (model.format !== "GGUF" && model.format !== "remote") {
      throw new Cp2Error(400, "model_catalog_entry_invalid", "Model format is invalid.");
    }
    if (
      !Array.isArray(model.capabilities) ||
      model.capabilities.length > 40 ||
      model.capabilities.some((capability) => invalidBoundedText(capability, 100))
    ) {
      throw new Cp2Error(400, "model_catalog_entry_invalid", "Model capabilities are invalid.");
    }
    if (
      invalidNullableNonNegativeInteger(model.fileSizeBytes) ||
      invalidNullablePositiveNumber(model.minimumMemoryGb) ||
      invalidNullablePositiveInteger(model.contextWindow)
    ) {
      throw new Cp2Error(400, "model_catalog_entry_invalid", "Model requirements are invalid.");
    }
    const created = !this.modelCatalog.has(model.id);
    this.modelCatalog.set(model.id, cloneModelCatalogEntry(model));
    this.recordAuditEvent({
      type: created ? "platform_catalog.model_created" : "platform_catalog.model_updated",
      aggregateType: "model_catalog_entry",
      aggregateId: model.id,
      actorId: session.account.id,
      occurredAt: now.toISOString(),
      payload: { modelId: model.id, label: model.label, source: model.source }
    });
    return this.resolveCatalogModel(model.id) as AiModelSummary;
  }

  removeModelCatalogEntry(input: { sessionId: string | null; modelId: string; now?: Date }): void {
    const now = input.now ?? new Date();
    const session = this.requirePlatformOperator(input.sessionId, now);
    if (input.modelId === defaultAiModelId || input.modelId === "sokoclaw-local") {
      throw new Cp2Error(
        409,
        "model_catalog_entry_protected",
        "This catalog entry is a required runtime fallback and cannot be removed."
      );
    }
    if (!this.modelCatalog.delete(input.modelId)) {
      throw new Cp2Error(404, "model_not_found", "The requested model was not found.");
    }
    this.recordAuditEvent({
      type: "platform_catalog.model_removed",
      aggregateType: "model_catalog_entry",
      aggregateId: input.modelId,
      actorId: session.account.id,
      occurredAt: now.toISOString(),
      payload: { modelId: input.modelId }
    });
  }

  /** The DB-hosted built-in agent template catalog. External GitHub/Hugging Face agent discovery
   *  is unaffected - this is only the safe-fallback template(s) used when that is unavailable. */
  listAgentCatalog(): AgentDefinition[] {
    return [...this.agentCatalog.values()]
      .map(cloneAgentCatalogEntry)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  listPlatformAgentCatalog(sessionId: string | null, now = new Date()): AgentDefinition[] {
    this.requirePinVerifiedSession(sessionId, now);
    return this.listAgentCatalog();
  }

  /** Every AgentRuntimeAdapter actually registered in this deployment (see
   *  agent-harness/default-agent-runtime-adapters.ts) - the harnesses a shop can choose between. */
  listAgentRuntimeAdapters(): AgentRuntimeAdapterDescriptor[] {
    return this.defaultAgentRuntimeAdapters
      .list()
      .map((adapter) => describeAgentRuntimeAdapter(adapter.id))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  listPlatformAgentRuntimeAdapters(
    sessionId: string | null,
    now = new Date()
  ): AgentRuntimeAdapterDescriptor[] {
    this.requirePinVerifiedSession(sessionId, now);
    return this.listAgentRuntimeAdapters();
  }

  upsertAgentCatalogEntry(input: {
    sessionId: string | null;
    agent: AgentDefinition;
    now?: Date;
  }): AgentDefinition {
    const now = input.now ?? new Date();
    const session = this.requirePlatformOperator(input.sessionId, now);
    const agent = input.agent;
    if (!isAgentDefinitionId(agent.id) || !agent.id.startsWith("builtin:")) {
      throw new Cp2Error(
        400,
        "agent_catalog_entry_invalid",
        "Agent catalog entries must use a builtin: id."
      );
    }
    if (agent.displayName.trim() === "" || agent.displayName.length > 200) {
      throw new Cp2Error(400, "agent_catalog_entry_invalid", "Agent display name is invalid.");
    }
    if (agent.instructions.trim() === "" || agent.instructions.length > 20_000) {
      throw new Cp2Error(400, "agent_catalog_entry_invalid", "Agent instructions are invalid.");
    }
    if (
      !Array.isArray(agent.tools) ||
      agent.tools.length > 40 ||
      agent.tools.some((tool) => invalidBoundedText(tool, 200))
    ) {
      throw new Cp2Error(400, "agent_catalog_entry_invalid", "Agent tools are invalid.");
    }
    if (
      !Number.isFinite(agent.minimumMemoryGb) ||
      agent.minimumMemoryGb <= 0 ||
      !Number.isSafeInteger(agent.recommendedContextTokens) ||
      agent.recommendedContextTokens <= 0 ||
      !Array.isArray(agent.skillIds) ||
      agent.skillIds.length > Object.keys(runtimeToolRegistry).length ||
      agent.skillIds.some((skillId) => !(skillId in runtimeToolRegistry))
    ) {
      throw new Cp2Error(
        400,
        "agent_catalog_entry_invalid",
        "Agent runtime requirements are invalid."
      );
    }
    const created = !this.agentCatalog.has(agent.id);
    this.agentCatalog.set(agent.id, cloneAgentCatalogEntry(agent));
    this.recordAuditEvent({
      type: created ? "platform_catalog.agent_created" : "platform_catalog.agent_updated",
      aggregateType: "agent_catalog_entry",
      aggregateId: agent.id,
      actorId: session.account.id,
      occurredAt: now.toISOString(),
      payload: { agentDefinitionId: agent.id, displayName: agent.displayName }
    });
    return cloneAgentCatalogEntry(agent);
  }

  removeAgentCatalogEntry(input: {
    sessionId: string | null;
    agentDefinitionId: string;
    now?: Date;
  }): void {
    const now = input.now ?? new Date();
    const session = this.requirePlatformOperator(input.sessionId, now);
    if (input.agentDefinitionId === defaultAgentDefinitionId) {
      throw new Cp2Error(
        409,
        "agent_catalog_entry_protected",
        "This catalog entry is the required runtime fallback and cannot be removed."
      );
    }
    if (!this.agentCatalog.delete(input.agentDefinitionId)) {
      throw new Cp2Error(404, "agent_not_found", "The requested agent was not found.");
    }
    this.recordAuditEvent({
      type: "platform_catalog.agent_removed",
      aggregateType: "agent_catalog_entry",
      aggregateId: input.agentDefinitionId,
      actorId: session.account.id,
      occurredAt: now.toISOString(),
      payload: { agentDefinitionId: input.agentDefinitionId }
    });
  }

  grantPlatformOperator(input: {
    accountId: string;
    grantedBy: string;
    now?: Date;
  }): PlatformOperatorGrant {
    const now = input.now ?? new Date();
    this.requireAccount(input.accountId);
    const grant: PlatformOperatorGrant = {
      id: input.accountId,
      accountId: input.accountId,
      grantedAt: now.toISOString(),
      grantedBy: input.grantedBy
    };
    this.platformOperators.set(input.accountId, grant);
    return grant;
  }

  revokePlatformOperator(accountId: string): boolean {
    return this.platformOperators.delete(accountId);
  }

  beginRecovery(input: {
    channel: AuthChannel;
    identifier: string;
    providerChallengeId?: string;
    expiresAt?: string;
    now?: Date;
  }): {
    transactionId: string;
    accountFound: boolean;
    normalizedIdentifier: string;
    expiresAt: string;
  } {
    const now = input.now ?? new Date();
    const identifier = normalizeDestination(input.channel, input.identifier);
    const accountId = this.resolveIdentityAccount(input.channel, identifier) ?? null;
    const transaction = this.createAuthTransaction("recovery", accountId, now, {
      identifierType: input.channel,
      identifierValue: identifier,
      providerChallengeId: input.providerChallengeId ?? null,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
    });
    this.recordSecurityEvent("auth.recovery_requested", accountId, "success", now, {
      identifierHash: securityCorrelationHash(identifier)
    });
    return {
      transactionId: transaction.id,
      accountFound: accountId !== null,
      normalizedIdentifier: identifier,
      expiresAt: transaction.expiresAt
    };
  }

  verifyEmailRecovery(input: {
    transactionId: string;
    challengeId: string;
    code: string;
    now?: Date;
  }): { verified: true } {
    const now = input.now ?? new Date();
    const transaction = this.requireAuthTransaction(input.transactionId, "recovery", now);
    if (
      transaction.providerChallengeId !== input.challengeId ||
      transaction.identifierType !== "email"
    ) {
      throw new Cp2Error(401, "recovery_verification_invalid", "Recovery verification failed.");
    }
    const challenge = this.otpDomain.otpChallengesMap.get(input.challengeId);
    if (
      !challenge ||
      challenge.purpose !== "recovery" ||
      challenge.verifiedAt !== null ||
      Date.parse(challenge.expiresAt) <= now.getTime() ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      throw new Cp2Error(401, "recovery_verification_invalid", "Recovery verification failed.");
    }
    challenge.attempts += 1;
    if (!safeHashEqual(challenge.codeHash, hashOtp(challenge.id, input.code))) {
      throw new Cp2Error(401, "recovery_verification_invalid", "Recovery verification failed.");
    }
    challenge.verifiedAt = now.toISOString();
    transaction.verifiedAt = now.toISOString();
    return { verified: true };
  }

  resetRecoveredPassword(input: {
    transactionId: string;
    password: string;
    mfaCode?: string;
    now?: Date;
  }): AuthSessionView {
    const now = input.now ?? new Date();
    const transaction = this.requireAuthTransaction(input.transactionId, "recovery", now, true);
    if (transaction.accountId === null)
      throw new Cp2Error(401, "recovery_verification_invalid", "Recovery verification failed.");
    const factors = this.activeMfaFactors(transaction.accountId);
    if (factors.length > 0) {
      if (input.mfaCode === undefined)
        throw new Cp2Error(401, "mfa_required", "A second factor is required.");
      const factor = factors[0]!;
      const step = verifyTotp(
        decryptOAuthToken(factor.secret),
        input.mfaCode,
        now,
        factor.lastUsedStep
      );
      if (step === null)
        throw new Cp2Error(401, "mfa_code_invalid", "The verification code is invalid.");
      factor.lastUsedStep = step;
    }
    validatePassword(input.password);
    this.passwordCredentials.set(
      transaction.accountId,
      createPasswordCredential(transaction.accountId, input.password, now)
    );
    for (const session of this.sessions.values()) {
      if (session.accountId === transaction.accountId && session.revokedAt === null) {
        session.revokedAt = now.toISOString();
        session.revocationReason = "password_reset";
      }
    }
    transaction.consumedAt = now.toISOString();
    const account = this.requireAccount(transaction.accountId);
    const user = this.requireUser(this.userByAccount.get(account.id));
    const sessionRecord = this.createSession(account, user, now);
    this.markSessionPinVerified(sessionRecord.id, now);
    this.recordSecurityEvent("auth.password_reset", account.id, "success", now, {});
    return this.requireAnySession(sessionRecord.id, now);
  }

  changePassword(input: {
    sessionId: string | null;
    currentPassword: string;
    password: string;
    mfaCode?: string;
    revokeOtherSessions?: boolean;
    now?: Date;
  }): { changed: true; revokedSessions: number } {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    const credential = this.passwordCredentials.get(session.account.id);
    if (credential === undefined) {
      throw new Cp2Error(409, "password_not_set", "A password has not been set for this account.");
    }
    if (
      verifyPasswordHash(session.account.id, input.currentPassword, credential.passwordHash) ===
      "invalid"
    ) {
      throw new Cp2Error(401, "current_password_invalid", "The current password is incorrect.");
    }
    this.markSessionPinVerified(session.session.id, now);
    this.verifyMfaForCredentialChange(session.account.id, input.mfaCode, now);
    validatePassword(input.password);
    this.passwordCredentials.set(
      session.account.id,
      createPasswordCredential(session.account.id, input.password, now)
    );
    let revokedSessions = 0;
    if (input.revokeOtherSessions !== false) {
      for (const candidate of this.sessions.values()) {
        if (
          candidate.accountId === session.account.id &&
          candidate.id !== session.session.id &&
          candidate.revokedAt === null
        ) {
          candidate.revokedAt = now.toISOString();
          candidate.revocationReason = "password_changed";
          revokedSessions += 1;
        }
      }
    }
    this.recordSecurityEvent("auth.password_changed", session.account.id, "success", now, {
      revokedSessions: String(revokedSessions)
    });
    return { changed: true, revokedSessions };
  }

  createPassword(input: {
    sessionId: string | null;
    currentPin?: string;
    password: string;
    mfaCode?: string;
    now?: Date;
  }): { created: true } {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    if (this.passwordCredentials.has(session.account.id)) {
      throw new Cp2Error(
        409,
        "password_already_set",
        "A password is already set for this account. Change it instead."
      );
    }

    if (this.accountPinHashes.has(session.account.id)) {
      if (input.currentPin === undefined) {
        throw new Cp2Error(401, "pin_required", "Enter your current login PIN.");
      }
      this.verifyAccountPinForSession(session, input.currentPin, now);
    } else {
      this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    }

    this.verifyMfaForCredentialChange(session.account.id, input.mfaCode, now);
    validatePassword(input.password);
    this.passwordCredentials.set(
      session.account.id,
      createPasswordCredential(session.account.id, input.password, now)
    );
    this.recordSecurityEvent("auth.password_created", session.account.id, "success", now, {});
    return { created: true };
  }

  regenerateMfaRecoveryCodes(input: { sessionId: string | null; now?: Date }): {
    recoveryCodes: string[];
  } {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    if (this.activeMfaFactors(session.account.id).length === 0)
      throw new Cp2Error(409, "mfa_not_enabled", "MFA is not enabled.");
    return { recoveryCodes: this.replaceRecoveryCodes(session.account.id, now) };
  }

  listMfaFactors(input: { sessionId: string | null; now?: Date }): Array<{
    id: string;
    type: "totp";
    verifiedAt: string;
    createdAt: string;
  }> {
    const session = this.requireAnySession(input.sessionId, input.now ?? new Date());
    return this.activeMfaFactors(session.account.id).map((factor) => ({
      id: factor.id,
      type: factor.type,
      verifiedAt: factor.verifiedAt!,
      createdAt: factor.createdAt
    }));
  }

  beginEmailIdentityUpgrade(input: {
    sessionId: string | null;
    email: string;
    now?: Date;
  }):
    | { kind: "link"; identity: AccountIdentityRecord }
    | { kind: "merge"; email: string; sourceAccountId: string; targetAccountId: string } {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    const email = normalizeDestination("email", input.email);
    const linkedAccountId = this.resolveAnyIdentityAccount("email", email);
    if (linkedAccountId !== undefined && linkedAccountId !== session.account.id) {
      if (session.account.primaryAuthChannel !== "device") {
        throw new Cp2Error(409, "identity_in_use", "This sign-in method is already linked.");
      }
      return {
        kind: "merge",
        email,
        sourceAccountId: session.account.id,
        targetAccountId: linkedAccountId
      };
    }
    const existing = [...this.accountIdentities.values()].find(
      (identity) => identity.accountId === session.account.id && identity.normalizedValue === email
    );
    if (existing !== undefined) {
      if (existing.verifiedAt !== null) {
        throw new Cp2Error(409, "identity_already_linked", "This email is already linked.");
      }
      return { kind: "link", identity: existing };
    }
    const identity = this.addAccountIdentity(
      session.account,
      session.user,
      "email",
      email,
      false,
      now,
      false
    );
    this.recordSecurityEvent("auth.identity_upgrade_started", session.account.id, "success", now, {
      identityType: "email"
    });
    return { kind: "link", identity };
  }

  beginEmailIdentityMerge(input: {
    sessionId: string | null;
    email: string;
    targetAccountId: string;
    challengeId: string;
    now?: Date;
  }): AuthTransactionRecord {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    if (session.account.primaryAuthChannel !== "device") {
      throw new Cp2Error(409, "account_merge_not_available", "Account joining is unavailable.");
    }
    const email = normalizeDestination("email", input.email);
    const resolvedTarget = this.resolveAnyIdentityAccount("email", email);
    if (resolvedTarget !== input.targetAccountId || resolvedTarget === session.account.id) {
      throw new Cp2Error(409, "identity_merge_changed", "The identity changed. Try again.");
    }
    return this.createAuthTransaction("identity_merge", session.account.id, now, {
      identifierType: "email",
      identifierValue: email,
      providerChallengeId: input.challengeId,
      metadata: { targetAccountId: resolvedTarget }
    });
  }

  verifyEmailIdentityMerge(input: {
    sessionId: string | null;
    challengeId: string;
    code: string;
    now?: Date;
  }): AuthSessionView & { refreshToken: string } {
    const now = input.now ?? new Date();
    const sourceSession = this.requireAnySession(input.sessionId, now);
    if (sourceSession.account.primaryAuthChannel !== "device") {
      throw new Cp2Error(409, "account_merge_not_available", "Account joining is unavailable.");
    }
    const transaction = [...this.authTransactions.values()].find(
      (candidate) =>
        candidate.purpose === "identity_merge" &&
        candidate.accountId === sourceSession.account.id &&
        candidate.providerChallengeId === input.challengeId &&
        candidate.consumedAt === null
    );
    const challenge = this.otpDomain.otpChallengesMap.get(input.challengeId);
    const targetAccountId = transaction?.metadata.targetAccountId;
    if (
      transaction === undefined ||
      challenge === undefined ||
      typeof targetAccountId !== "string" ||
      challenge.destination !== transaction.identifierValue ||
      challenge.channel !== "email" ||
      challenge.purpose !== "recovery" ||
      challenge.verifiedAt !== null ||
      Date.parse(challenge.expiresAt) <= now.getTime() ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      throw new Cp2Error(401, "identity_merge_invalid", "Identity verification failed.");
    }
    challenge.attempts += 1;
    if (!safeHashEqual(challenge.codeHash, hashOtp(challenge.id, input.code))) {
      throw new Cp2Error(401, "identity_merge_invalid", "Identity verification failed.");
    }
    const targetAccount = this.requireAccount(targetAccountId);
    this.requireAccountAuthenticationAllowed(targetAccount);
    if (this.resolveAnyIdentityAccount("email", transaction.identifierValue) !== targetAccountId) {
      throw new Cp2Error(409, "identity_merge_changed", "The identity changed. Try again.");
    }
    challenge.verifiedAt = now.toISOString();
    transaction.verifiedAt = now.toISOString();
    transaction.consumedAt = now.toISOString();
    const targetUserId = this.requireUser(this.userByAccount.get(targetAccount.id)).id;
    this.mergeDeviceAccountData(
      sourceSession.account.id,
      sourceSession.user.id,
      targetAccount.id,
      targetUserId
    );
    const session = this.createSession(
      this.requireAccount(targetAccount.id),
      this.requireUser(targetUserId),
      now
    );
    this.markSessionPinVerified(session.id, now);
    const refreshToken = this.consumeSessionRefreshToken(session.id);
    for (const bootstrap of this.deviceBootstrapDomain.deviceAccountBootstrapsMap.values()) {
      if (bootstrap.accountId === targetAccountId && !this.sessions.has(bootstrap.sessionId)) {
        bootstrap.sessionId = session.id;
      }
    }
    this.recordSecurityEvent("auth.device_account_merged", targetAccount.id, "success", now, {
      sourceIdentityLevel: sourceSession.account.identityLevel,
      proof: "email_otp"
    });
    return { ...this.requireAnySession(session.id, now), isNewAccount: false, refreshToken };
  }

  getPendingEmailIdentity(input: { sessionId: string | null; now?: Date }): AccountIdentityRecord {
    const session = this.requireAnySession(input.sessionId, input.now ?? new Date());
    const identity = [...this.accountIdentities.values()].find(
      (item) =>
        item.accountId === session.account.id && item.type === "email" && item.verifiedAt === null
    );
    if (!identity)
      throw new Cp2Error(
        404,
        "email_verification_not_pending",
        "No email is waiting for verification."
      );
    return identity;
  }

  verifyPendingEmail(input: {
    sessionId: string | null;
    challengeId: string;
    code: string;
    now?: Date;
  }): {
    verified: true;
    email: string;
    accountId: string;
    identityLevel: AccountSummary["identityLevel"];
  } {
    const now = input.now ?? new Date();
    const identity = this.getPendingEmailIdentity({ sessionId: input.sessionId, now });
    const challenge = this.otpDomain.otpChallengesMap.get(input.challengeId);
    if (
      !challenge ||
      challenge.destination !== identity.normalizedValue ||
      challenge.verifiedAt !== null ||
      Date.parse(challenge.expiresAt) <= now.getTime() ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      throw new Cp2Error(401, "email_verification_invalid", "Email verification failed.");
    }
    challenge.attempts += 1;
    if (!safeHashEqual(challenge.codeHash, hashOtp(challenge.id, input.code)))
      throw new Cp2Error(401, "email_verification_invalid", "Email verification failed.");
    challenge.verifiedAt = now.toISOString();
    identity.verifiedAt = now.toISOString();
    identity.updatedAt = now.toISOString();
    const userId = this.userByAccount.get(identity.accountId);
    const user = userId === undefined ? undefined : this.users.get(userId);
    if (user !== undefined) {
      this.users.set(user.id, {
        ...user,
        emailAddress: identity.normalizedValue,
        emailVerificationStatus: "verified"
      });
    }
    const account = this.promoteAccountIdentityLevel(identity.accountId, "verified_contact");
    this.recordSecurityEvent("auth.email_verified", identity.accountId, "success", now, {});
    return {
      verified: true,
      email: identity.normalizedValue,
      accountId: account.id,
      identityLevel: account.identityLevel
    };
  }

  disableMfaFactor(input: {
    sessionId: string | null;
    factorId: string;
    code: string;
    now?: Date;
  }): { disabled: true } {
    const now = input.now ?? new Date();
    const session = this.requireRecentlyAuthenticatedSession(input.sessionId, now);
    const factor = this.mfaFactors.get(input.factorId);
    if (
      !factor ||
      factor.accountId !== session.account.id ||
      factor.disabledAt !== null ||
      factor.verifiedAt === null
    )
      throw new Cp2Error(404, "mfa_factor_not_found", "MFA factor was not found.");
    const step = verifyTotp(decryptOAuthToken(factor.secret), input.code, now, factor.lastUsedStep);
    if (step === null)
      throw new Cp2Error(401, "mfa_code_invalid", "The verification code is invalid.");
    factor.disabledAt = now.toISOString();
    this.recordSecurityEvent("auth.mfa_disabled", session.account.id, "success", now, {
      factorType: factor.type
    });
    return { disabled: true };
  }

  private resolveIdentityAccount(type: AuthChannel, normalizedValue: string): string | undefined {
    const mappedAccount = this.identityAccountByValue.get(
      destinationAccountKey(type, normalizedValue)
    );
    if (mappedAccount !== undefined) {
      const identity = [...this.accountIdentities.values()].find(
        (item) =>
          item.accountId === mappedAccount &&
          item.type === type &&
          item.normalizedValue === normalizedValue
      );
      if (type === "phone" || (identity !== undefined && identity.verifiedAt !== null))
        return mappedAccount;
    }
    return this.accountByDestination.get(destinationAccountKey(type, normalizedValue));
  }

  private resolveAnyIdentityAccount(
    type: AuthChannel,
    normalizedValue: string
  ): string | undefined {
    return (
      this.identityAccountByValue.get(destinationAccountKey(type, normalizedValue)) ??
      this.accountByDestination.get(destinationAccountKey(type, normalizedValue))
    );
  }

  private requireAccountAuthenticationAllowed(account: AccountSummary): void {
    const status = account.status ?? "active";
    if (status === "active") return;
    if (status === "locked") {
      throw new Cp2Error(423, "account_locked", "This account is temporarily locked.");
    }
    if (status === "suspended") {
      throw new Cp2Error(403, "account_suspended", "This account is suspended.");
    }
    if (status === "pending_deletion") {
      throw new Cp2Error(
        410,
        "account_pending_deletion",
        "Verify your identity to restore this account."
      );
    }
    throw invalidLoginCredentialsError();
  }

  private addAccountIdentity(
    account: AccountSummary,
    user: UserSummary,
    type: AuthChannel,
    value: string,
    isPrimary: boolean,
    now: Date,
    verified: boolean
  ): AccountIdentityRecord {
    const key = destinationAccountKey(type, value);
    const existingAccount =
      this.identityAccountByValue.get(key) ?? this.resolveIdentityAccount(type, value);
    if (existingAccount !== undefined && existingAccount !== account.id) {
      throw new Cp2Error(409, "identity_in_use", "This sign-in method is already linked.");
    }
    const existingIdentity = [...this.accountIdentities.values()].find(
      (identity) =>
        identity.accountId === account.id &&
        identity.type === type &&
        identity.normalizedValue === value
    );
    if (existingIdentity !== undefined) {
      const updated: AccountIdentityRecord = {
        ...existingIdentity,
        isPrimary: existingIdentity.isPrimary || isPrimary,
        verifiedAt:
          existingIdentity.verifiedAt ??
          (verified ? now.toISOString() : existingIdentity.verifiedAt),
        updatedAt: now.toISOString()
      };
      this.accountIdentities.set(updated.id, updated);
      this.identityAccountByValue.set(key, account.id);
      return updated;
    }
    const record: AccountIdentityRecord = {
      id: randomUUID(),
      accountId: account.id,
      userId: user.id,
      type,
      normalizedValue: value,
      displayValue: value,
      isPrimary,
      verifiedAt: verified ? now.toISOString() : null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    this.accountIdentities.set(record.id, record);
    this.identityAccountByValue.set(key, account.id);
    return record;
  }

  private createAuthTransaction(
    purpose: AuthTransactionRecord["purpose"],
    accountId: string | null,
    now: Date,
    override: Partial<AuthTransactionRecord> = {}
  ): AuthTransactionRecord {
    const record: AuthTransactionRecord = {
      id: randomUUID(),
      purpose,
      accountId,
      identifierType: null,
      identifierValue: null,
      providerChallengeId: null,
      verifiedAt: null,
      attempts: 0,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      consumedAt: null,
      metadata: {},
      createdAt: now.toISOString(),
      ...override
    };
    this.authTransactions.set(record.id, record);
    return record;
  }

  private requireAuthTransaction(
    id: string,
    purpose: AuthTransactionRecord["purpose"],
    now: Date,
    verified = false
  ): AuthTransactionRecord {
    const record = this.authTransactions.get(id);
    if (
      !record ||
      record.purpose !== purpose ||
      record.consumedAt !== null ||
      Date.parse(record.expiresAt) <= now.getTime() ||
      record.attempts >= 5 ||
      (verified && record.verifiedAt === null)
    ) {
      throw new Cp2Error(
        400,
        "auth_transaction_invalid",
        "The authentication request expired or is invalid."
      );
    }
    return record;
  }

  private activeMfaFactors(accountId: string): MfaFactorRecord[] {
    return [...this.mfaFactors.values()].filter(
      (factor) =>
        factor.accountId === accountId && factor.verifiedAt !== null && factor.disabledAt === null
    );
  }

  private replaceRecoveryCodes(accountId: string, now: Date): string[] {
    for (const [id, code] of this.recoveryCodes)
      if (code.accountId === accountId && code.usedAt === null) this.recoveryCodes.delete(id);
    const codes = Array.from(
      { length: 10 },
      () =>
        `${randomBytes(4).toString("hex").toUpperCase().slice(0, 4)}-${randomBytes(4).toString("hex").toUpperCase().slice(0, 4)}`
    );
    for (const code of codes) {
      const record: RecoveryCodeRecord = {
        id: randomUUID(),
        accountId,
        codeHash: hashRecoveryCode(accountId, code),
        usedAt: null,
        createdAt: now.toISOString()
      };
      this.recoveryCodes.set(record.id, record);
    }
    return codes;
  }

  private recordSecurityEvent(
    type: string,
    accountId: string | null,
    outcome: "success" | "failure",
    now: Date,
    metadata: Record<string, string | boolean | null>
  ): void {
    this.recordAuditEvent({
      type,
      aggregateType: "account",
      aggregateId: accountId ?? randomUUID(),
      actorId: accountId ?? "anonymous",
      occurredAt: now.toISOString(),
      payload: { outcome, ...metadata }
    });
  }

  private createAccount(
    channel: AccountSummary["primaryAuthChannel"],
    destination: string,
    now: Date,
    identityLevel: AccountSummary["identityLevel"] = "strong"
  ): AccountSummary {
    const existingAccountId =
      channel === "phone" || channel === "email"
        ? this.resolveAnyIdentityAccount(channel, destination)
        : undefined;
    if (existingAccountId !== undefined) {
      throw new Cp2Error(
        409,
        "account_exists",
        `An account already exists for this ${channel === "phone" ? "phone number" : channel === "email" ? "email address" : "identity"}. Sign in instead.`
      );
    }
    const account: AccountSummary = {
      id: randomUUID(),
      primaryAuthChannel: channel,
      primaryAuthDestination: destination,
      identityLevel,
      status: "active",
      deletedAt: null
    };
    let phoneIdentity: NormalizedOwnerPhoneIdentity | null = null;
    if (channel === "phone") {
      try {
        phoneIdentity = normalizeInternationalOwnerPhoneNumber(destination);
      } catch {
        phoneIdentity = null;
      }
    }
    const user: UserSummary = {
      id: randomUUID(),
      accountId: account.id,
      displayName: defaultDisplayName(destination),
      language: "en",
      phoneNumberE164: phoneIdentity?.e164 ?? null,
      phoneCountryCode: phoneIdentity?.country ?? null,
      phoneNationalNumber: phoneIdentity?.nationalNumber ?? null,
      phoneVerificationStatus: phoneIdentity === null ? null : "unverified",
      phoneAddedAt: phoneIdentity === null ? null : now.toISOString(),
      phoneUpdatedAt: phoneIdentity === null ? null : now.toISOString(),
      phoneSource: phoneIdentity === null ? null : "phone_login",
      publicPhoneEnabled: false,
      ...(channel === "email"
        ? { emailAddress: destination, emailVerificationStatus: "unverified" as const }
        : {})
    };

    this.accounts.set(account.id, account);
    this.accountByDestination.set(destinationAccountKey(channel, destination), account.id);
    this.users.set(user.id, user);
    this.userByAccount.set(account.id, user.id);
    if (channel === "phone" || channel === "email") {
      this.addAccountIdentity(account, user, channel, destination, true, now, false);
    }

    this.recordAuditEvent({
      type: "user.created",
      aggregateType: "user",
      aggregateId: user.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        accountId: account.id,
        language: user.language
      }
    });

    return account;
  }

  private promoteAccountIdentityLevel(
    accountId: string,
    nextLevel: AccountSummary["identityLevel"]
  ): AccountSummary {
    const account = this.requireAccount(accountId);
    const ranks: Record<AccountSummary["identityLevel"], number> = {
      device: 0,
      verified_contact: 1,
      strong: 2
    };
    if (ranks[nextLevel] <= ranks[account.identityLevel]) return account;
    account.identityLevel = nextLevel;
    return account;
  }

  private createSession(account: AccountSummary, user: UserSummary, now: Date): SessionSummary {
    const refreshToken = createRefreshToken();
    const absoluteExpiresAt = new Date(now.getTime() + sessionAbsoluteTtlMs()).toISOString();
    const inactivityExpiresAt = sessionInactivityExpiry(now, absoluteExpiresAt);
    const session: SessionRecord = {
      id: randomUUID(),
      accountId: account.id,
      userId: user.id,
      deviceId: "unknown-device",
      deviceName: "This device",
      platform: "unknown",
      browserOrApp: "web",
      userAgentHash: hashUserAgent(""),
      refreshTokenHash: hashRefreshToken(refreshToken),
      sessionFamilyId: randomUUID(),
      refreshExpiresAt: inactivityExpiresAt,
      inactivityExpiresAt,
      absoluteExpiresAt,
      rotatedFromSessionId: null,
      authenticatedAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      rotatedAt: null,
      revocationReason: null,
      expiresAt: new Date(now.getTime() + sessionAccessTtlMs()).toISOString(),
      pinVerifiedAt: null,
      revokedAt: null,
      createdAt: now.toISOString()
    };

    this.sessions.set(session.id, session);
    this.pendingRefreshTokens.set(session.id, refreshToken);
    const conversation = this.messagingDomain.ensurePersonalAccountConversation({
      accountId: account.id,
      userId: user.id,
      now
    });
    const sessionContextKey = this.sessionContextKey(account.id, conversation.id);
    if (!this.sessionContexts.has(sessionContextKey)) {
      const context = this.buildDefaultSessionContext(account.id, conversation.id, now);
      this.sessionContexts.set(sessionContextKey, context);
      this.recordSyncChange({
        accountId: account.id,
        collection: "session_context",
        entityId: context.conversationId,
        operation: "upsert",
        shopId: null,
        entity: context,
        now
      });
    }
    this.recordAuditEvent({
      type: "auth.session_created",
      aggregateType: "session",
      aggregateId: session.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        accountId: account.id
      }
    });

    return sessionView(session);
  }

  private sessionContextKey(accountId: string, conversationId: string): string {
    return `${accountId}:${conversationId}`;
  }

  private buildDefaultSessionContext(
    accountId: string,
    conversationId: string,
    now: Date
  ): StoredSokoSessionContext {
    return {
      accountId,
      conversationId,
      activeShopId: null,
      activeModelId: "sokoclaw-runtime",
      mode: "marketplace",
      activeSurface: "conversation",
      sessionVersion: 1,
      updatedAt: now.toISOString()
    };
  }

  // conversationId selects which conversation's context row to fetch, defaulting to the account's
  // personal conversation (today's only conversation). Each conversation gets its own row, keyed by
  // sessionContextKey - not inherited from the account's other contexts. See
  // docs/frontend/frontend.md Phase 2.
  private ensureSokoSessionContext(
    session: AuthSessionView,
    now: Date,
    conversationId?: string
  ): StoredSokoSessionContext {
    const conversation =
      conversationId === undefined
        ? this.messagingDomain.ensurePersonalAccountConversation({
            accountId: session.account.id,
            userId: session.user.id,
            now
          })
        : this.messagingDomain.requireAccountConversation(conversationId, session.account.id);
    const key = this.sessionContextKey(session.account.id, conversation.id);
    const existing = this.sessionContexts.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const context = this.buildDefaultSessionContext(session.account.id, conversation.id, now);
    this.sessionContexts.set(key, context);
    this.recordSyncChange({
      accountId: session.account.id,
      collection: "session_context",
      entityId: context.conversationId,
      operation: "upsert",
      shopId: null,
      entity: context,
      now
    });
    return context;
  }

  private sokoSessionContextView(
    session: AuthSessionView,
    context: StoredSokoSessionContext,
    now: Date
  ): SokoSessionContext {
    const shops = this.listAccountShops({ sessionId: session.session.id, now });
    const membership =
      context.activeShopId === null
        ? undefined
        : shops.find((shop) => shop.business.id === context.activeShopId)?.membership;
    const permissions =
      context.mode === "seller" && membership !== undefined
        ? permissionsForRole(membership.role)
        : marketplacePermissions;

    return {
      accountId: session.account.id,
      userId: session.user.id,
      sessionId: session.session.id,
      conversationId: context.conversationId,
      activeShopId: context.activeShopId,
      agentId: `account-${session.account.id}-agent`,
      activeModelId: context.activeModelId,
      mode: context.mode,
      activeSurface: context.activeSurface,
      permissions: [...permissions],
      sessionVersion: context.sessionVersion,
      shops
    };
  }

  private recordSyncChange(input: {
    accountId: string;
    collection: SyncCollection;
    entityId: string;
    operation: "upsert" | "delete";
    shopId: string | null;
    entity: unknown | null;
    now: Date;
  }): SyncChange {
    if (!isAccountSyncCollection(input.collection)) {
      throw new Cp2Error(
        500,
        "account_sync_collection_invalid",
        "Account sync initialization could not be completed."
      );
    }

    const sequence = this.nextSyncSequenceByAccount.get(input.accountId) ?? 1;
    const changedAt = input.now.toISOString();
    const change: SyncChange = {
      accountId: input.accountId,
      collection: input.collection,
      entityId: input.entityId,
      operation: input.operation,
      sequence,
      cursor: randomUUID(),
      shopId: input.shopId,
      entity: input.operation === "delete" ? null : input.entity,
      changedAt,
      tombstoneExpiresAt:
        input.operation === "delete"
          ? new Date(input.now.getTime() + syncTombstoneRetentionMs).toISOString()
          : null
    };
    this.syncChanges.push(change);
    this.nextSyncSequenceByAccount.set(input.accountId, sequence + 1);
    const event: SyncRealtimeChangesAvailableEvent = {
      type: "sync.changes_available",
      protocolVersion: 1,
      accountId: change.accountId,
      cursor: change.cursor,
      sequence: change.sequence,
      collection: change.collection,
      emittedAt: changedAt
    };
    this.publishExternalSyncChange(event);
    return change;
  }

  private pruneExpiredSyncTombstones(now: Date): void {
    for (let index = this.syncChanges.length - 1; index >= 0; index -= 1) {
      const change = this.syncChanges[index];
      if (
        change?.operation === "delete" &&
        change.tombstoneExpiresAt !== null &&
        Date.parse(change.tombstoneExpiresAt) <= now.getTime()
      ) {
        this.syncChanges.splice(index, 1);
      }
    }
  }

  private backfillSyncChanges(): void {
    for (const membership of this.memberships.values()) {
      const business = this.businesses.get(membership.businessId);
      const user = this.users.get(membership.userId);
      if (business === undefined || user === undefined) {
        continue;
      }
      this.recordSyncChange({
        accountId: user.accountId,
        collection: "shops",
        entityId: business.id,
        operation: "upsert",
        shopId: business.id,
        entity: { business, membership },
        now: new Date(0)
      });
    }

    for (const conversation of this.messagingDomain.conversationsMap.values()) {
      this.recordSyncChange({
        accountId: conversation.accountId,
        collection: "conversations",
        entityId: conversation.id,
        operation: "upsert",
        shopId: conversation.activeShopId,
        entity: conversation,
        now: syncRecordDate(conversation.updatedAt)
      });
    }

    for (const message of this.messagingDomain.conversationMessagesMap.values()) {
      const conversation = this.messagingDomain.conversationsMap.get(message.conversationId);
      if (conversation === undefined) {
        continue;
      }
      this.recordSyncChange({
        accountId: conversation.accountId,
        collection: "conversation_messages",
        entityId: message.id,
        operation: "upsert",
        shopId: conversation.activeShopId,
        entity: message,
        now: syncRecordDate(message.createdAt)
      });
    }

    for (const context of this.sessionContexts.values()) {
      this.recordSyncChange({
        accountId: context.accountId,
        collection: "session_context",
        entityId: context.conversationId,
        operation: "upsert",
        shopId: context.activeShopId,
        entity: context,
        now: syncRecordDate(context.updatedAt)
      });
    }
  }

  private requireAnySession(sessionId: string | null, now: Date): AuthSessionView {
    const session = this.getSession(sessionId, now);

    if (session === null) {
      throw new Cp2Error(401, "auth_required", "Authentication is required.");
    }

    return session;
  }

  private requireRecentlyAuthenticatedSession(
    sessionId: string | null,
    now: Date
  ): AuthSessionView {
    const session = this.requirePinVerifiedSession(sessionId, now);
    const sessionRecord = this.sessions.get(session.session.id);
    const authenticatedAt = sessionRecord?.pinVerifiedAt ?? sessionRecord?.authenticatedAt;

    if (
      authenticatedAt === undefined ||
      authenticatedAt === null ||
      now.getTime() - new Date(authenticatedAt).getTime() > 15 * 60 * 1000
    ) {
      throw new Cp2Error(
        401,
        "recent_authentication_required",
        "Your session has expired. Sign in again."
      );
    }

    return session;
  }

  private enforcePhoneUpdateRateLimit(accountId: string, now: Date): void {
    const cutoff = now.getTime() - 60 * 60 * 1000;
    const recentAttempts = (this.phoneUpdateAttemptsByAccount.get(accountId) ?? []).filter(
      (attemptedAt) => attemptedAt > cutoff
    );

    if (recentAttempts.length >= 5) {
      throw new Cp2Error(
        429,
        "phone_update_rate_limited",
        "Too many phone-number updates. Try again later."
      );
    }

    recentAttempts.push(now.getTime());
    this.phoneUpdateAttemptsByAccount.set(accountId, recentAttempts);
  }

  private applyOwnerPhoneIdentity(input: {
    session: AuthSessionView;
    phoneNumber: string;
    country: string;
    source: "phone_login" | "shop_registration";
    now: Date;
  }): UserSummary {
    let phone: NormalizedOwnerPhoneIdentity;

    try {
      phone = normalizeOwnerPhoneNumber(input.phoneNumber, input.country);
    } catch (error) {
      if (error instanceof PhoneIdentityError) {
        throw new Cp2Error(400, error.code, error.message);
      }
      throw error;
    }

    const conflictingUser = [...this.users.values()].find(
      (user) => user.id !== input.session.user.id && user.phoneNumberE164 === phone.e164
    );
    if (conflictingUser !== undefined) {
      throw new Cp2Error(
        409,
        "PHONE_ALREADY_IN_USE",
        "This phone number is already associated with another account."
      );
    }

    const phoneKey = destinationAccountKey("phone", phone.e164);
    const linkedAccountId = this.resolveAnyIdentityAccount("phone", phone.e164);
    if (linkedAccountId !== undefined && linkedAccountId !== input.session.account.id) {
      throw new Cp2Error(
        409,
        "PHONE_ALREADY_IN_USE",
        "This phone number is already associated with another account. Sign in to that account to use it."
      );
    }

    const current = this.requireUser(input.session.user.id);
    if (
      current.phoneNumberE164 === phone.e164 &&
      current.phoneCountryCode === phone.country &&
      current.phoneNationalNumber === phone.nationalNumber
    ) {
      return current;
    }

    const updated: UserSummary = {
      ...current,
      phoneNumberE164: phone.e164,
      phoneCountryCode: phone.country,
      phoneNationalNumber: phone.nationalNumber,
      phoneVerificationStatus: "unverified",
      phoneAddedAt: current.phoneAddedAt ?? input.now.toISOString(),
      phoneUpdatedAt: input.now.toISOString(),
      phoneSource: input.source,
      publicPhoneEnabled: current.publicPhoneEnabled ?? false
    };
    this.users.set(updated.id, updated);
    if (!this.identityAccountByValue.has(phoneKey)) {
      this.addAccountIdentity(
        this.requireAccount(input.session.account.id),
        updated,
        "phone",
        phone.e164,
        false,
        input.now,
        false
      );
    }
    this.recordAuditEvent({
      type: "owner.phone_updated",
      aggregateType: "user",
      aggregateId: updated.id,
      actorId: updated.id,
      occurredAt: input.now.toISOString(),
      payload: {
        previousPhone: maskPhoneNumber(current.phoneNumberE164),
        newPhone: maskPhoneNumber(updated.phoneNumberE164),
        source: input.source,
        verificationStatus: "unverified"
      }
    });

    return updated;
  }

  private requirePinVerifiedSession(sessionId: string | null, now: Date): AuthSessionView {
    const session = this.requireAnySession(sessionId, now);
    const sessionRecord = this.sessions.get(session.session.id);

    if (
      this.accountPinHashes.has(session.account.id) &&
      (sessionRecord === undefined || sessionRecord.pinVerifiedAt === null)
    ) {
      throw new Cp2Error(401, "pin_required", "Login PIN verification is required.");
    }

    return session;
  }

  private markSessionPinVerified(sessionId: string, now: Date): void {
    const session = this.sessions.get(sessionId);

    if (session !== undefined) {
      session.pinVerifiedAt = now.toISOString();
      session.authenticatedAt = now.toISOString();
    }
  }

  private requireAccount(accountId: string): AccountSummary {
    const account = this.accounts.get(accountId);

    if (account === undefined) {
      throw new Cp2Error(500, "account_missing", "Account state is inconsistent.");
    }

    return account;
  }

  private requireUser(userId: string | undefined): UserSummary {
    if (userId === undefined) {
      throw new Cp2Error(500, "user_missing", "User state is inconsistent.");
    }

    const user = this.users.get(userId);

    if (user === undefined) {
      throw new Cp2Error(500, "user_missing", "User state is inconsistent.");
    }

    return user;
  }

  private requireIntegrationPrincipal(input: {
    accountId: string;
    userId: string;
    shopId: string | null;
    now: Date;
  }): void {
    const account = this.accounts.get(input.accountId);
    const user = this.users.get(input.userId);
    if (
      account === undefined ||
      user === undefined ||
      user.accountId !== input.accountId ||
      (account.status ?? "active") !== "active"
    ) {
      throw new Cp2Error(401, "mcp_token_invalid", "MCP access token is invalid or expired.");
    }
    this.requireAccountNotPendingDeletion(account.id, input.now);
    if (input.shopId !== null) {
      this.requireMcpBusinessAccess(input, input.shopId, "business:read", input.now);
    }
  }

  private requireMcpBusinessAccess(
    principal: Pick<McpPrincipal, "accountId" | "userId" | "shopId">,
    businessId: string,
    permission: BusinessPermission,
    now: Date
  ): AuthenticatedActorView {
    const account = this.accounts.get(principal.accountId);
    const user = this.users.get(principal.userId);
    if (
      account === undefined ||
      user === undefined ||
      user.accountId !== principal.accountId ||
      (account.status ?? "active") !== "active"
    ) {
      throw new Cp2Error(401, "mcp_token_invalid", "MCP access token is invalid or expired.");
    }
    this.requireAccountNotPendingDeletion(account.id, now);
    if (principal.shopId !== null && principal.shopId !== businessId) {
      throw new Cp2Error(403, "mcp_shop_forbidden", "MCP token is bound to another shop.");
    }
    if (!this.businesses.has(businessId)) {
      throw new Cp2Error(404, "business_not_found", "Business was not found.");
    }
    if (this.quarantinedBusinessIds.has(businessId)) {
      throw new Cp2Error(410, "business_quarantined", "Business is in its 30-day restore window.");
    }
    const membership = this.requireMembership(businessId, user.id);
    if (!roleCan(membership.role, permission)) {
      throw new Cp2Error(403, "permission_denied", "Permission denied for this business.");
    }
    return { account, user };
  }

  private requireAuthorizedActor(
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now = new Date()
  ): AuthenticatedActorView {
    const principal = this.mcpPrincipalContext.getStore();
    return principal === undefined
      ? this.requireBrowserAuthorizedSession(sessionId, businessId, permission, now)
      : this.requireMcpBusinessAccess(principal, businessId, permission, now);
  }

  private requireAuthenticatedActor(sessionId: string | null, now: Date): AuthenticatedActorView {
    const principal = this.mcpPrincipalContext.getStore();
    if (principal === undefined) {
      return this.requirePinVerifiedSession(sessionId, now);
    }
    this.requireIntegrationPrincipal({ ...principal, now });
    return {
      account: this.accounts.get(principal.accountId)!,
      user: this.users.get(principal.userId)!
    };
  }

  private requireAuthorizedSession(
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now = new Date()
  ): AuthenticatedActorView {
    return this.requireAuthorizedActor(sessionId, businessId, permission, now);
  }

  private requireBrowserAuthorizedSession(
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now = new Date()
  ): AuthSessionView {
    const session = this.requirePinVerifiedSession(sessionId, now);

    this.requireAccountNotPendingDeletion(session.account.id, now);

    if (!this.businesses.has(businessId)) {
      throw new Cp2Error(404, "business_not_found", "Business was not found.");
    }

    if (this.quarantinedBusinessIds.has(businessId)) {
      throw new Cp2Error(410, "business_quarantined", "Business is in its 30-day restore window.");
    }

    const membership = this.requireMembership(businessId, session.user.id);

    if (!roleCan(membership.role, permission)) {
      throw new Cp2Error(403, "permission_denied", "Permission denied for this business.");
    }

    return session;
  }

  private requireAccountNotPendingDeletion(accountId: string, now: Date): void {
    const pendingDeletion = [...this.accountDeletionRequests.values()].some(
      (request) =>
        request.accountId === accountId &&
        request.status === "scheduled" &&
        new Date(request.anonymizeAfter).getTime() > now.getTime()
    );
    if (pendingDeletion) {
      throw new Cp2Error(
        410,
        "account_pending_deletion",
        "Account access is disabled during the recovery window. Restore the account to continue."
      );
    }
  }

  private requireMembership(businessId: string, userId: string): MembershipSummary {
    const membership = [...this.memberships.values()].find(
      (candidate) => candidate.businessId === businessId && candidate.userId === userId
    );

    if (membership === undefined) {
      throw new Cp2Error(403, "membership_required", "Business membership is required.");
    }

    return membership;
  }

  private requireOwnerMembership(businessId: string, userId: string): MembershipSummary {
    const membership = this.requireMembership(businessId, userId);

    if (membership.role !== "owner") {
      throw new Cp2Error(403, "owner_required", "Only the shop owner can delete the shop.");
    }

    return membership;
  }

  private verifyAccountPinForSession(session: AuthSessionView, pin: string, now: Date): void {
    const normalizedPin = normalizePin(pin);
    const pinHash = this.accountPinHashes.get(session.account.id);
    const attemptKey = `verify:${session.account.id}`;

    if (pinHash === undefined) {
      throw new Cp2Error(409, "pin_not_set", "Set a login PIN before deleting this shop.");
    }

    this.requirePinAttemptAllowed(attemptKey, now);
    if (!this.verifyStoredPin(session.account.id, normalizedPin, pinHash)) {
      this.recordFailedPinAttempt(attemptKey, now);
      throw new Cp2Error(401, "pin_invalid", "Login PIN is invalid.");
    }

    this.failedPinAttempts.delete(attemptKey);
    this.markSessionPinVerified(session.session.id, now);
  }

  private verifyMfaForCredentialChange(
    accountId: string,
    mfaCode: string | undefined,
    now: Date
  ): void {
    const factors = this.activeMfaFactors(accountId);
    if (factors.length === 0) return;
    if (mfaCode === undefined) {
      throw new Cp2Error(401, "mfa_required", "A second factor is required.");
    }
    const factor = factors[0]!;
    const step = verifyTotp(decryptOAuthToken(factor.secret), mfaCode, now, factor.lastUsedStep);
    if (step === null) {
      throw new Cp2Error(401, "mfa_code_invalid", "The verification code is invalid.");
    }
    factor.lastUsedStep = step;
  }

  private verifyStoredPin(accountId: string, pin: string, storedHash: string): boolean {
    const result = verifyPinHash(accountId, pin, storedHash);
    if (result === "legacy") {
      this.accountPinHashes.set(accountId, hashPin(accountId, pin));
    }
    return result !== "invalid";
  }

  private requirePinAttemptAllowed(key: string, now: Date): void {
    const cutoff = now.getTime() - pinAttemptWindowMs;
    const attempts = (this.failedPinAttempts.get(key) ?? []).filter(
      (attemptedAt) => attemptedAt > cutoff
    );

    if (attempts.length === 0) {
      this.failedPinAttempts.delete(key);
      return;
    }

    this.failedPinAttempts.set(key, attempts);
    if (attempts.length >= pinMaximumFailedAttempts) {
      throw new Cp2Error(
        429,
        "pin_rate_limited",
        "Too many invalid PIN attempts. Try again later."
      );
    }
  }

  private recordFailedPinAttempt(key: string, now: Date): void {
    if (
      !this.failedPinAttempts.has(key) &&
      this.failedPinAttempts.size >= pinAttemptTrackerMaximumEntries
    ) {
      const cutoff = now.getTime() - pinAttemptWindowMs;
      for (const [candidateKey, attempts] of this.failedPinAttempts) {
        if ((attempts.at(-1) ?? 0) <= cutoff) {
          this.failedPinAttempts.delete(candidateKey);
        }
      }
      if (this.failedPinAttempts.size >= pinAttemptTrackerMaximumEntries) {
        const oldestKey = this.failedPinAttempts.keys().next().value as string | undefined;
        if (oldestKey !== undefined) this.failedPinAttempts.delete(oldestKey);
      }
    }

    const cutoff = now.getTime() - pinAttemptWindowMs;
    const attempts = (this.failedPinAttempts.get(key) ?? []).filter(
      (attemptedAt) => attemptedAt > cutoff
    );
    attempts.push(now.getTime());
    this.failedPinAttempts.set(key, attempts);
  }

  private publicStorefrontForBusiness(business: BusinessSummary): PublicStorefrontSummary {
    const presence = this.shopPresenceForBusiness(business.id);
    return {
      agentId: business.sokoId,
      sokoId: business.sokoId,
      businessName: business.name,
      presence: { status: presence.status, updatedAt: presence.updatedAt },
      products: this.salesDomain
        .productsForBusiness(business.id)
        .filter((product) => product.quantity > 0)
        .map((product) => ({
          id: product.id,
          name: product.name,
          unit: product.unit,
          available: true,
          sellingPrice: product.sellingPrice,
          image: this.salesDomain.publicProductImage(product)
        }))
    };
  }

  private shopPresenceForBusiness(businessId: string): ShopPresenceSummary {
    return (
      this.shopPresences.get(businessId) ?? {
        businessId,
        status: "online",
        updatedBy: "system",
        updatedAt: new Date(0).toISOString()
      }
    );
  }

  private requireBusiness(businessId: string): BusinessSummary {
    const business = this.businesses.get(businessId);

    if (business === undefined) {
      throw new Cp2Error(404, "business_not_found", "Business was not found.");
    }

    if (this.quarantinedBusinessIds.has(businessId)) {
      throw new Cp2Error(410, "business_quarantined", "Business is in its 30-day restore window.");
    }

    return business;
  }

  private requireSyncQueueItem(businessId: string, syncItemId: string): SyncQueueItem {
    const item = this.syncQueue.get(syncItemId);

    if (item === undefined || item.businessId !== businessId) {
      throw new Cp2Error(404, "sync_item_not_found", "Queued work item was not found.");
    }

    return item;
  }

  private replaySyncMutation(input: {
    sessionId: string | null;
    businessId: string;
    mutationType: SyncMutationType;
    payload: SyncMutationPayload;
    now: Date;
  }): unknown {
    switch (input.mutationType) {
      case "product.create":
        return this.createProduct({
          sessionId: input.sessionId,
          businessId: input.businessId,
          product: input.payload as ProductInput,
          now: input.now
        });

      case "customer.create":
        return this.createCustomer({
          sessionId: input.sessionId,
          businessId: input.businessId,
          customer: input.payload as ContactRecordInput,
          now: input.now
        });

      case "supplier.create":
        return this.createSupplier({
          sessionId: input.sessionId,
          businessId: input.businessId,
          supplier: input.payload as ContactRecordInput,
          now: input.now
        });

      case "inventory.adjust": {
        const payload = input.payload as { productId: string } & StockAdjustmentInput;

        return this.adjustProductStock({
          sessionId: input.sessionId,
          businessId: input.businessId,
          productId: payload.productId,
          adjustment: payload,
          now: input.now
        });
      }

      case "invoice.create":
        return this.createInvoice({
          sessionId: input.sessionId,
          businessId: input.businessId,
          invoice: input.payload as InvoiceInput,
          now: input.now
        });

      case "invoice.confirm":
        return this.confirmInvoice({
          sessionId: input.sessionId,
          businessId: input.businessId,
          invoiceId: (input.payload as { invoiceId: string }).invoiceId,
          now: input.now
        });

      case "payment.record":
        return this.recordPayment({
          sessionId: input.sessionId,
          businessId: input.businessId,
          payment: input.payload as PaymentInput,
          now: input.now
        });

      case "logistics.create":
        return this.createLogistics({
          sessionId: input.sessionId,
          businessId: input.businessId,
          logistics: input.payload as LogisticsInput,
          now: input.now
        });

      case "logistics.update_status": {
        const payload = input.payload as { logisticsId: string } & LogisticsStatusInput;

        return this.updateLogisticsStatus({
          sessionId: input.sessionId,
          businessId: input.businessId,
          logisticsId: payload.logisticsId,
          status: payload,
          now: input.now
        });
      }
    }
  }

  private buildRuntimeContext(businessId: string, userId: string): RuntimeContextSummary {
    const membership = this.requireMembership(businessId, userId);
    const invoices = [...this.salesDomain.invoicesMap.values()].filter(
      (invoice) => invoice.businessId === businessId
    );
    const knowledge = this.buildBusinessKnowledge(businessId, new Date());
    const logisticsReport = summarizeLogistics(
      this.logisticsDomain.logisticsForBusiness(businessId)
    );
    const compliance = this.buildComplianceReport(businessId, userId, new Date());
    const beta = this.buildBetaReadinessReport(businessId, new Date());
    const launch = this.buildLaunchReadinessReport(businessId, new Date());

    return {
      businessId,
      userId,
      role: membership.role,
      productCount: [...this.salesDomain.productsMap.values()].filter(
        (product) => product.businessId === businessId
      ).length,
      customerCount: [...this.salesDomain.customersMap.values()].filter(
        (customer) => customer.businessId === businessId
      ).length,
      supplierCount: this.supplierDomain.suppliersForBusiness(businessId).length,
      invoiceCount: invoices.length,
      openInvoiceCount: invoices.filter(
        (invoice) => this.salesDomain.buildInvoicePaymentSummary(invoice).balanceDue > 0
      ).length,
      paymentCount: [...this.salesDomain.paymentsMap.values()].filter(
        (payment) => payment.businessId === businessId
      ).length,
      importJobCount: this.documentImportDomain.importsForBusiness(businessId).length,
      logisticsCount: logisticsReport.fulfillmentCount,
      activeLogisticsCount: logisticsReport.activeCount,
      complianceExportCount: compliance.exportCount,
      scheduledDeletionCount: compliance.scheduledAnonymizationCount,
      verificationTier: compliance.verificationTier,
      deviceTrustLevel: compliance.deviceTrustLevel,
      betaAccessStatus: beta.access.status,
      betaReadinessStatus: beta.status,
      openSupportTicketCount: beta.support.openTicketCount,
      crashFreeSessionRate: beta.telemetry.crashFreeSessionRate,
      publicLaunchStatus: launch.settings.status,
      launchReadinessStatus: launch.status,
      openLaunchIncidentCount: launch.support.openIncidentCount,
      lowStockCount: knowledge.report.inventory.lowStockCount,
      outstandingDebtTotal: knowledge.report.debts.totalOutstanding,
      unreadNotificationCount: knowledge.notificationSummary.unread,
      knowledgeFactCount: knowledge.facts.length
    };
  }

  private buildComplianceReport(
    businessId: string,
    actorId: string,
    now: Date
  ): BusinessReportSummary["compliance"] {
    const retention = this.buildComplianceRetention(businessId);
    const verification = this.compliance.getOrCreateVerificationTier(businessId, actorId, now);
    const taxConfig = this.compliance.getOrCreateTaxConfig(businessId, actorId, now);
    const deviceTrust =
      actorId === "system"
        ? [...this.compliance.deviceTrustMap.values()].find(
            (item) => item.businessId === businessId && item.userId !== "system"
          )
        : this.compliance.getOrCreateDeviceTrust(
            businessId,
            actorId,
            "browser-session",
            actorId,
            now
          );
    const highRiskAuditEventCount = this.auditEventsForBusiness(businessId).filter(
      (event) => event.risk === "high" || event.risk === "critical"
    ).length;

    return {
      exportCount: [...this.dataExports.values()].filter((item) => item.businessId === businessId)
        .length,
      deletionRequestCount: [...this.accountDeletionRequests.values()].filter(
        (item) => item.businessId === businessId
      ).length,
      scheduledAnonymizationCount: [...this.accountDeletionRequests.values()].filter(
        (item) => item.businessId === businessId && item.status === "scheduled"
      ).length,
      retainedRecordCount:
        retention.retainedInvoiceCount +
        retention.retainedPaymentCount +
        retention.retainedLogisticsCount +
        retention.retainedImportCount +
        retention.retainedAuditEventCount,
      verificationTier: verification.tier,
      taxCountryCode: taxConfig.countryCode,
      deviceTrustLevel: deviceTrust?.level ?? "unknown",
      highRiskAuditEventCount
    };
  }

  private buildBetaReadinessReport(businessId: string, now: Date): BetaReadinessReportSummary {
    const access = this.compliance.getOrCreateBetaAccess(businessId, "system", now);
    const featureFlags = betaFeatureFlagKeys.map((key) =>
      this.compliance.getOrCreateBetaFeatureFlag(businessId, key, "system", now)
    );
    const deviceTests = this.compliance.betaDeviceTestsForBusiness(businessId);
    const supportTickets = this.compliance.betaSupportTicketsForBusiness(businessId);
    const telemetryEvents = this.compliance.betaTelemetryEventsForBusiness(businessId);
    const syncItems = this.syncItemsForBusiness(businessId);
    const paymentSummaries = this.salesDomain.buildInvoicePaymentSummaries(businessId);
    const payments = this.salesDomain.paymentsForBusiness(businessId);
    const offlineSnapshot = this.buildOfflineCacheSnapshot(businessId, now);
    const passedDeviceClasses = [
      ...new Set(
        deviceTests.filter((test) => test.status === "passed").map((test) => test.deviceClass)
      )
    ].sort() as BetaReadinessReportSummary["deviceTesting"]["passedDeviceClasses"];
    const failedTestCount = deviceTests.filter((test) => test.status === "failed").length;
    const sessionEventCount = telemetryEvents.filter((event) => event.kind === "session").length;
    const crashEventCount = telemetryEvents.filter((event) => event.kind === "crash").length;
    const errorEventCount = telemetryEvents.filter((event) => event.kind === "error").length;
    const crashFreeSessionRate =
      sessionEventCount === 0
        ? 1
        : roundMoney(Math.max(0, (sessionEventCount - crashEventCount) / sessionEventCount));
    const reconciliationMismatchCount = paymentSummaries.filter(
      (summary) =>
        roundMoney(summary.invoiceTotal - summary.paidTotal) !== summary.balanceDue ||
        summary.paidTotal > summary.invoiceTotal + 0.01
    ).length;
    const offlineTestedSurfaceCount =
      (offlineSnapshot.products.length > 0 ? 1 : 0) +
      (offlineSnapshot.customers.length > 0 ? 1 : 0) +
      (offlineSnapshot.invoices.length > 0 ? 1 : 0) +
      (offlineSnapshot.payments.length > 0 ? 1 : 0) +
      (offlineSnapshot.logistics.length > 0 ? 1 : 0);
    const gates = [
      {
        key: "closed_beta_access",
        passed:
          access.status === "active" && access.invitedMerchantCount <= access.targetMerchantCount,
        detail: `Beta access is ${access.status} for ${access.invitedMerchantCount}/${access.targetMerchantCount} selected merchants.`
      },
      {
        key: "feature_flags",
        passed: featureFlags.every((flag) => flag.enabled),
        detail: `${featureFlags.filter((flag) => flag.enabled).length}/${featureFlags.length} beta feature flags are enabled.`
      },
      {
        key: "device_testing",
        passed:
          passedDeviceClasses.includes("android_1gb") &&
          passedDeviceClasses.includes("android_2gb") &&
          failedTestCount === 0,
        detail: `${passedDeviceClasses.length}/2 required Android device classes passed.`
      },
      {
        key: "offline_workflows",
        passed: offlineTestedSurfaceCount >= 5,
        detail: `${offlineTestedSurfaceCount}/5 beta-critical offline surfaces have cached records.`
      },
      {
        key: "sync_stress",
        passed:
          syncItems.filter((item) => item.status === "synced").length >= 3 &&
          syncItems.every((item) => item.status !== "conflict" && item.status !== "failed"),
        detail: `${syncItems.filter((item) => item.status === "synced").length} sync items replayed without unresolved failure.`
      },
      {
        key: "payment_reconciliation",
        passed: payments.length > 0 && reconciliationMismatchCount === 0,
        detail: `${payments.length} payments recorded with ${reconciliationMismatchCount} reconciliation mismatches.`
      },
      {
        key: "support_process",
        passed:
          supportTickets.some((ticket) => ticket.status === "resolved") &&
          supportTickets.every(
            (ticket) => ticket.severity !== "critical" || ticket.status === "resolved"
          ),
        detail: `${supportTickets.filter((ticket) => ticket.status !== "resolved").length} support tickets remain open.`
      },
      {
        key: "crash_telemetry",
        passed: sessionEventCount > 0 && crashFreeSessionRate >= 0.95,
        detail: `${sessionEventCount} session telemetry events with ${crashEventCount} crashes.`
      }
    ];
    const failedGateCount = gates.filter((gate) => !gate.passed).length;

    return {
      businessId,
      generatedAt: now.toISOString(),
      status:
        failedGateCount === 0
          ? "ready"
          : gates.some(
                (gate) =>
                  !gate.passed &&
                  (gate.key === "closed_beta_access" ||
                    gate.key === "payment_reconciliation" ||
                    gate.key === "crash_telemetry")
              )
            ? "blocked"
            : "needs_review",
      access,
      featureFlags,
      deviceTesting: {
        requiredDeviceClasses: ["android_1gb", "android_2gb"],
        passedDeviceClasses,
        failedTestCount
      },
      offline: {
        cachedRecordCount:
          offlineSnapshot.products.length +
          offlineSnapshot.customers.length +
          offlineSnapshot.suppliers.length +
          offlineSnapshot.invoices.length +
          offlineSnapshot.payments.length +
          offlineSnapshot.logistics.length +
          offlineSnapshot.inventoryMovements.length,
        betaCriticalSurfaceCount: 5,
        testedSurfaceCount: offlineTestedSurfaceCount
      },
      syncStress: {
        queuedMutationCount: syncItems.length,
        syncedMutationCount: syncItems.filter((item) => item.status === "synced").length,
        conflictCount: syncItems.filter((item) => item.status === "conflict").length,
        failedCount: syncItems.filter((item) => item.status === "failed").length,
        ready: gates.find((gate) => gate.key === "sync_stress")?.passed ?? false
      },
      payments: {
        paymentCount: payments.length,
        partiallyPaidInvoiceCount: paymentSummaries.filter(
          (summary) => summary.status === "partially_paid"
        ).length,
        unpaidInvoiceCount: paymentSummaries.filter((summary) => summary.status === "unpaid")
          .length,
        reconciliationMismatchCount,
        controlledProductionReady:
          payments.length > 0 &&
          reconciliationMismatchCount === 0 &&
          featureFlags.find((flag) => flag.key === "controlled_payments")?.enabled === true
      },
      support: {
        openTicketCount: supportTickets.filter((ticket) => ticket.status !== "resolved").length,
        criticalOpenTicketCount: supportTickets.filter(
          (ticket) => ticket.severity === "critical" && ticket.status !== "resolved"
        ).length,
        documentedSeverityCount: new Set(supportTickets.map((ticket) => ticket.severity)).size
      },
      telemetry: {
        sessionEventCount,
        crashEventCount,
        errorEventCount,
        crashFreeSessionRate,
        rawSensitivePayloadCount: 0
      },
      gates
    };
  }

  private buildLaunchReadinessReport(businessId: string, now: Date): LaunchReadinessReportSummary {
    const beta = this.buildBetaReadinessReport(businessId, now);
    const settings = this.compliance.getOrCreateLaunchSettings(businessId, "system", now);
    const checklistItems = launchChecklistKeys.map((key) =>
      this.compliance.getOrCreateLaunchChecklistItem(businessId, key, "system", now)
    );
    const incidents = this.compliance.launchIncidentsForBusiness(businessId);
    const telemetryEvents = this.compliance.betaTelemetryEventsForBusiness(businessId);
    const products = this.salesDomain.productsForBusiness(businessId);
    const customers = [...this.salesDomain.customersMap.values()].filter(
      (customer) => customer.businessId === businessId
    );
    const invoices = this.salesDomain.invoicesForBusiness(businessId);
    const payments = this.salesDomain.paymentsForBusiness(businessId);
    const syncSummary = summarizeSyncQueue(businessId, this.syncItemsForBusiness(businessId));
    const paymentSummaries = this.salesDomain.buildInvoicePaymentSummaries(businessId);
    const sessionEventCount = telemetryEvents.filter((event) => event.kind === "session").length;
    const crashEventCount = telemetryEvents.filter((event) => event.kind === "crash").length;
    const errorEventCount = telemetryEvents.filter((event) => event.kind === "error").length;
    const crashFreeSessionRate =
      sessionEventCount === 0
        ? 1
        : roundMoney(Math.max(0, (sessionEventCount - crashEventCount) / sessionEventCount));
    const reconciliationMismatchCount = paymentSummaries.filter(
      (summary) =>
        roundMoney(summary.invoiceTotal - summary.paidTotal) !== summary.balanceDue ||
        summary.paidTotal > summary.invoiceTotal + 0.01
    ).length;
    const activeQueueCount =
      syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict;
    const openIncidents = incidents.filter((incident) => incident.status !== "resolved");
    const firstRunComplete =
      products.length > 0 && customers.length > 0 && invoices.length > 0 && payments.length > 0;
    const gates = [
      {
        key: "beta_ready",
        passed: beta.status === "ready",
        detail: `CP15 beta readiness is ${beta.status}.`
      },
      {
        key: "public_onboarding",
        passed:
          settings.status === "open" &&
          settings.publicOnboardingEnabled &&
          !settings.freezeActive &&
          settings.allowedSignupCount > 0,
        detail: `Public onboarding is ${settings.status} with ${settings.allowedSignupCount} allowed signups.`
      },
      {
        key: "production_checklist",
        passed: checklistItems.every((item) => item.status === "passed"),
        detail: `${checklistItems.filter((item) => item.status === "passed").length}/${checklistItems.length} production checklist items passed.`
      },
      {
        key: "first_run_workflow",
        passed: firstRunComplete,
        detail: `${products.length} products, ${customers.length} customers, ${invoices.length} invoices, and ${payments.length} payments exist for first-run proof.`
      },
      {
        key: "support_readiness",
        passed:
          beta.support.openTicketCount === 0 &&
          openIncidents.every((incident) => incident.severity !== "critical") &&
          checklistItems.find((item) => item.key === "support_coverage")?.status === "passed",
        detail: `${openIncidents.length} launch incidents and ${beta.support.openTicketCount} beta support tickets are open.`
      },
      {
        key: "telemetry_health",
        passed: sessionEventCount > 0 && crashFreeSessionRate >= 0.95,
        detail: `${sessionEventCount} launch-safe session telemetry events with ${crashEventCount} crashes.`
      },
      {
        key: "sync_health",
        passed: activeQueueCount === 0,
        detail: `${activeQueueCount} sync queue items require attention.`
      },
      {
        key: "payment_reconciliation",
        passed: payments.length > 0 && reconciliationMismatchCount === 0,
        detail: `${payments.length} payments recorded with ${reconciliationMismatchCount} reconciliation mismatches.`
      },
      {
        key: "rollback_ready",
        passed:
          settings.rollbackArmed && settings.status !== "open" ? true : settings.rollbackArmed,
        detail: settings.rollbackArmed
          ? "Rollback is armed and can pause onboarding."
          : "Rollback is not armed."
      }
    ];
    const failedGateCount = gates.filter((gate) => !gate.passed).length;

    return {
      businessId,
      generatedAt: now.toISOString(),
      status:
        failedGateCount === 0
          ? "ready"
          : gates.some(
                (gate) =>
                  !gate.passed &&
                  (gate.key === "public_onboarding" ||
                    gate.key === "beta_ready" ||
                    gate.key === "rollback_ready" ||
                    gate.key === "payment_reconciliation")
              )
            ? "blocked"
            : "needs_review",
      settings,
      betaStatus: beta.status,
      checklist: {
        total: checklistItems.length,
        passed: checklistItems.filter((item) => item.status === "passed").length,
        failed: checklistItems.filter((item) => item.status === "failed").length,
        pending: checklistItems.filter((item) => item.status === "pending").length,
        items: checklistItems
      },
      onboarding: {
        publicOnboardingEnabled: settings.publicOnboardingEnabled,
        allowedSignupCount: settings.allowedSignupCount,
        firstRunComplete,
        productCount: products.length,
        customerCount: customers.length,
        invoiceCount: invoices.length,
        paymentCount: payments.length
      },
      support: {
        openIncidentCount: openIncidents.length,
        criticalOpenIncidentCount: openIncidents.filter(
          (incident) => incident.severity === "critical"
        ).length,
        resolvedIncidentCount: incidents.filter((incident) => incident.status === "resolved")
          .length,
        betaOpenTicketCount: beta.support.openTicketCount
      },
      telemetry: {
        sessionEventCount,
        crashEventCount,
        errorEventCount,
        crashFreeSessionRate,
        launchSafePayloadCount: telemetryEvents.length
      },
      sync: {
        activeQueueCount,
        conflictCount: syncSummary.conflict,
        failedCount: syncSummary.failed
      },
      payments: {
        paymentCount: payments.length,
        reconciliationMismatchCount
      },
      rollback: {
        rollbackArmed: settings.rollbackArmed,
        freezeActive: settings.freezeActive,
        canPauseOnboarding: settings.rollbackArmed && settings.status === "open"
      },
      gates
    };
  }

  private buildBusinessReport(businessId: string, now: Date): BusinessReportSummary {
    const products = this.salesDomain.productsForBusiness(businessId);
    const invoices = this.salesDomain.invoicesForBusiness(businessId);
    const payments = this.salesDomain.paymentsForBusiness(businessId);
    const imports = this.documentImportDomain.importsForBusiness(businessId);
    const logistics = this.logisticsDomain.logisticsForBusiness(businessId);
    const movements = [...this.salesDomain.inventoryMovementsMap.values()].filter(
      (movement) => movement.businessId === businessId
    );
    const paymentSummaries = this.salesDomain.buildInvoicePaymentSummaries(businessId);
    const debts = this.salesDomain.buildCustomerDebtSummaries(businessId);
    const syncSummary = summarizeSyncQueue(businessId, this.syncItemsForBusiness(businessId));
    const confirmedInvoices = invoices.filter((invoice) => invoice.status === "confirmed");

    return {
      businessId,
      generatedAt: now.toISOString(),
      sales: {
        invoiceCount: invoices.length,
        confirmedInvoiceCount: confirmedInvoices.length,
        grossSales: roundMoney(
          confirmedInvoices.reduce((total, invoice) => total + invoice.total, 0)
        ),
        collectedTotal: roundMoney(payments.reduce((total, payment) => total + payment.amount, 0)),
        outstandingTotal: roundMoney(
          paymentSummaries.reduce((total, summary) => total + summary.balanceDue, 0)
        )
      },
      inventory: {
        productCount: products.length,
        totalUnitsOnHand: roundMoney(
          products.reduce((total, product) => total + product.quantity, 0)
        ),
        lowStockCount: products.filter((product) => product.quantity > 0 && product.quantity <= 2)
          .length,
        outOfStockCount: products.filter((product) => product.quantity <= 0).length,
        movementCount: movements.length
      },
      payments: {
        paymentCount: payments.length,
        paidInvoiceCount: paymentSummaries.filter((summary) => summary.status === "paid").length,
        partiallyPaidInvoiceCount: paymentSummaries.filter(
          (summary) => summary.status === "partially_paid"
        ).length,
        unpaidInvoiceCount: paymentSummaries.filter((summary) => summary.status === "unpaid")
          .length,
        totalPaid: roundMoney(payments.reduce((total, payment) => total + payment.amount, 0))
      },
      debts: {
        customerCount: debts.length,
        totalOutstanding: roundMoney(debts.reduce((total, debt) => total + debt.balanceDue, 0)),
        largestBalanceDue: roundMoney(Math.max(0, ...debts.map((debt) => debt.balanceDue)))
      },
      imports: {
        totalJobs: imports.length,
        previewedJobs: imports.filter((job) => job.status === "previewed").length,
        confirmedJobs: imports.filter((job) => job.status === "confirmed").length,
        failedJobs: imports.filter((job) => job.status === "failed").length,
        confirmedRows: imports.reduce((total, job) => total + job.confirmedCount, 0)
      },
      logistics: summarizeLogistics(logistics),
      compliance: this.buildComplianceReport(businessId, "system", now),
      beta: this.buildBetaReadinessReport(businessId, now),
      launch: this.buildLaunchReadinessReport(businessId, now),
      sync: {
        ...syncSummary,
        active:
          syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict
      }
    };
  }

  private buildBusinessKnowledge(businessId: string, now: Date): BusinessKnowledgeSummary {
    const report = this.buildBusinessReport(businessId, now);
    this.notificationsDomain.ensureDeterministicNotifications(businessId, now);
    const notificationSummary = summarizeNotifications(
      businessId,
      this.notificationsDomain.sortedNotifications(businessId)
    );
    const facts = [
      {
        topic: "sales" as const,
        severity: "info" as const,
        detail: `${report.sales.confirmedInvoiceCount} confirmed invoices total ${report.sales.grossSales}.`,
        metric: report.sales.grossSales
      },
      {
        topic: "debt" as const,
        severity: report.debts.totalOutstanding > 0 ? ("warning" as const) : ("info" as const),
        detail: `${report.debts.customerCount} customers have outstanding balances.`,
        metric: report.debts.totalOutstanding
      },
      {
        topic: "inventory" as const,
        severity:
          report.inventory.outOfStockCount > 0
            ? ("critical" as const)
            : report.inventory.lowStockCount > 0
              ? ("warning" as const)
              : ("info" as const),
        detail: `${report.inventory.lowStockCount} low-stock products and ${report.inventory.outOfStockCount} out of stock.`,
        metric: report.inventory.lowStockCount + report.inventory.outOfStockCount
      },
      {
        topic: "logistics" as const,
        severity: report.logistics.activeCount > 0 ? ("warning" as const) : ("info" as const),
        detail: `${report.logistics.activeCount} fulfillment records are still active.`,
        metric: report.logistics.activeCount
      },
      {
        topic: "compliance" as const,
        severity:
          report.compliance.scheduledAnonymizationCount > 0
            ? ("warning" as const)
            : ("info" as const),
        detail: `${report.compliance.exportCount} exports and ${report.compliance.scheduledAnonymizationCount} scheduled anonymizations.`,
        metric: report.compliance.exportCount + report.compliance.scheduledAnonymizationCount
      },
      {
        topic: "beta" as const,
        severity:
          report.beta.status === "blocked"
            ? ("critical" as const)
            : report.beta.status === "needs_review"
              ? ("warning" as const)
              : ("info" as const),
        detail: `Closed beta readiness is ${report.beta.status} with ${report.beta.support.openTicketCount} open support tickets.`,
        metric: report.beta.gates.filter((gate) => !gate.passed).length
      },
      {
        topic: "launch" as const,
        severity:
          report.launch.status === "blocked"
            ? ("critical" as const)
            : report.launch.status === "needs_review"
              ? ("warning" as const)
              : ("info" as const),
        detail: `Public launch readiness is ${report.launch.status} with ${report.launch.support.openIncidentCount} open incidents.`,
        metric: report.launch.gates.filter((gate) => !gate.passed).length
      },
      {
        topic: "sync" as const,
        severity: report.sync.conflict > 0 ? ("critical" as const) : ("info" as const),
        detail: `${report.sync.active} sync items need attention.`,
        metric: report.sync.active
      },
      {
        topic: "notifications" as const,
        severity: notificationSummary.unread > 0 ? ("warning" as const) : ("info" as const),
        detail: `${notificationSummary.unread} unread in-app notifications.`,
        metric: notificationSummary.unread
      }
    ];

    return {
      businessId,
      generatedAt: now.toISOString(),
      report,
      notificationSummary,
      facts
    };
  }

  private membershipsForBusiness(businessId: string): MembershipSummary[] {
    return [...this.memberships.values()].filter(
      (membership) => membership.businessId === businessId
    );
  }

  private syncItemsForBusiness(businessId: string): SyncQueueItem[] {
    return [...this.syncQueue.values()].filter((item) => item.businessId === businessId);
  }

  private buildOfflineCacheSnapshot(businessId: string, now: Date): OfflineCacheSnapshot {
    return {
      businessId,
      capturedAt: now.toISOString(),
      source: "server_cache",
      products: this.salesDomain.productsForBusiness(businessId),
      customers: this.salesDomain.customersForBusiness(businessId),
      suppliers: this.supplierDomain.suppliersForBusiness(businessId),
      invoices: this.salesDomain.invoicesForBusiness(businessId),
      payments: this.salesDomain.paymentsForBusiness(businessId),
      logistics: this.logisticsDomain.logisticsForBusiness(businessId),
      invoicePaymentSummaries: this.salesDomain.buildInvoicePaymentSummaries(businessId),
      customerDebts: this.salesDomain.buildCustomerDebtSummaries(businessId),
      inventoryMovements: this.salesDomain.inventoryMovementsForBusiness(businessId)
    };
  }

  private auditEventsForBusiness(businessId: string): BusinessEvent[] {
    const aggregateIds = new Set<string>([
      businessId,
      ...this.membershipsForBusiness(businessId).map((item) => item.id),
      ...this.salesDomain.productsForBusiness(businessId).map((item) => item.id),
      ...this.salesDomain.customersForBusiness(businessId).map((item) => item.id),
      ...this.supplierDomain.suppliersForBusiness(businessId).map((item) => item.id),
      ...this.salesDomain.invoicesForBusiness(businessId).map((item) => item.id),
      ...this.salesDomain.paymentsForBusiness(businessId).map((item) => item.id),
      ...this.logisticsDomain.logisticsForBusiness(businessId).map((item) => item.id),
      ...this.documentImportDomain.importsForBusiness(businessId).map((item) => item.id),
      ...this.salesDomain.inventoryMovementsForBusiness(businessId).map((item) => item.id),
      ...this.notificationsDomain.sortedNotifications(businessId).map((item) => item.id),
      ...this.syncItemsForBusiness(businessId).map((item) => item.id),
      ...[...this.dataExports.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.id),
      ...[...this.accountDeletionRequests.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.id),
      ...[...this.compliance.betaAccessMap.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.businessId),
      ...[...this.compliance.betaFeatureFlagsMap.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => `${item.businessId}:${item.key}`),
      ...this.compliance.betaDeviceTestsForBusiness(businessId).map((item) => item.id),
      ...this.compliance.betaSupportTicketsForBusiness(businessId).map((item) => item.id),
      ...this.compliance.betaTelemetryEventsForBusiness(businessId).map((item) => item.id),
      ...[...this.compliance.launchSettingsMap.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.businessId),
      ...[...this.compliance.launchChecklistMap.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => `${item.businessId}:${item.key}`),
      ...this.compliance.launchIncidentsForBusiness(businessId).map((item) => item.id)
    ]);

    return this.auditEvents.filter(
      (event) =>
        aggregateIds.has(event.aggregateId) ||
        (typeof event.payload.businessId === "string" && event.payload.businessId === businessId)
    );
  }

  private revokeSessionsForAccount(accountId: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && session.revokedAt === null) {
        session.revokedAt = now.toISOString();
      }
    }
  }

  private revokeOtherSessionsForAccount(
    accountId: string,
    exceptSessionId: string,
    reason: string,
    now: Date
  ): void {
    for (const session of this.sessions.values()) {
      if (
        session.accountId === accountId &&
        session.id !== exceptSessionId &&
        session.revokedAt === null
      ) {
        session.revokedAt = now.toISOString();
        session.revocationReason = reason;
      }
    }
  }

  private hasAccountPinHash(accountId: string): boolean {
    return this.accountPinHashes.has(accountId);
  }

  private resetAccountPinHash(accountId: string, normalizedPin: string): void {
    this.accountPinHashes.set(accountId, hashPin(accountId, normalizedPin));
  }

  private hasPasswordCredential(accountId: string): boolean {
    return this.passwordCredentials.has(accountId);
  }

  private userForAccount(accountId: string): UserSummary {
    return this.requireUser(this.userByAccount.get(accountId));
  }

  private updateUserDisplayName(userId: string, displayName: string): void {
    const user = this.requireUser(userId);
    this.users.set(user.id, { ...user, displayName });
  }

  private linkEmailAccountDestination(email: string, accountId: string): void {
    this.accountByDestination.set(destinationAccountKey("email", email), accountId);
  }

  private buildShopDeletionPreview(
    businessId: string,
    accountId: string,
    now: Date
  ): ShopDeletionPreviewSummary {
    const business = this.requireBusiness(businessId);
    const invoices = this.salesDomain.invoicesForBusiness(businessId);
    const payments = this.salesDomain.paymentsForBusiness(businessId);
    const documentSources = this.documentImportDomain.documentImportSourcesForBusiness(businessId);

    return {
      businessId,
      shopId: business.sokoId,
      generatedAt: now.toISOString(),
      counts: {
        products: this.salesDomain.productsForBusiness(businessId).length,
        customers: this.salesDomain.customersForBusiness(businessId).length,
        suppliers: this.supplierDomain.suppliersForBusiness(businessId).length,
        salesAgents: this.supplierDomain.salesAgentsForBusiness(businessId).length,
        salesRecords: invoices.length + payments.length,
        messages: this.agentRuntimeDomain.runtimeTurnsForBusiness(businessId).length,
        notifications: this.notificationsDomain.sortedNotifications(businessId).length,
        connectedProviders: [...this.oauthDomain.userIdentitiesMap.values()].filter(
          (identity) => identity.accountId === accountId
        ).length,
        uploadedFiles:
          documentSources.length +
          [...this.supplierDomain.receiptOCRJobsMap.values()].filter(
            (job) => job.businessId === businessId
          ).length,
        installedIntegrations: 0
      },
      retentionNotice:
        "The shop is removed from active systems. Audit and legally required financial records may be retained with restricted access according to retention rules and backup expiry."
    };
  }

  private deleteShopOwnedData(businessId: string, accountId: string, now: Date): void {
    this.modelTemplatesDomain.deleteBusinessData(businessId);
    this.recordSyncChange({
      accountId,
      collection: "shops",
      entityId: businessId,
      operation: "delete",
      shopId: null,
      entity: null,
      now
    });
    const invoiceIds = new Set(
      this.salesDomain.invoicesForBusiness(businessId).map((invoice) => invoice.id)
    );
    const supplierIds = new Set(
      this.supplierDomain.suppliersForBusiness(businessId).map((supplier) => supplier.id)
    );
    const receiptIds = new Set(
      [...this.supplierDomain.purchaseReceiptsMap.values()]
        .filter((receipt) => receipt.businessId === businessId)
        .map((receipt) => receipt.id)
    );

    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && session.revokedAt === null) {
        session.revokedAt = now.toISOString();
      }
    }

    for (const [id, identity] of this.oauthDomain.userIdentitiesMap.entries()) {
      if (identity.accountId === accountId) {
        this.oauthDomain.userIdentitiesMap.set(id, {
          ...identity,
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          encryptedIdToken: null,
          tokenExpiresAt: null,
          updatedAt: now.toISOString()
        });
      }
    }

    for (const [id, item] of this.syncQueue.entries()) {
      if (item.businessId === businessId) {
        this.syncQueue.delete(id);
        this.syncQueueIdByIdempotency.delete(
          syncQueueIdempotencyKey(item.businessId, item.idempotencyKey)
        );
      }
    }

    for (const [id, product] of this.salesDomain.productsMap.entries()) {
      if (product.businessId === businessId) {
        this.salesDomain.productsMap.delete(id);
      }
    }

    for (const [id, customer] of this.salesDomain.customersMap.entries()) {
      if (customer.businessId === businessId) {
        this.salesDomain.customersMap.delete(id);
      }
    }

    for (const [id, supplier] of this.supplierDomain.suppliersMap.entries()) {
      if (supplier.businessId === businessId) {
        this.supplierDomain.suppliersMap.delete(id);
      }
    }

    for (const [id, agent] of this.supplierDomain.salesAgentsMap.entries()) {
      if (agent.businessId === businessId) {
        this.supplierDomain.salesAgentsMap.delete(id);
      }
    }

    for (const [id, link] of this.supplierDomain.supplierContactLinksMap.entries()) {
      if (
        link.businessId === businessId ||
        (link.supplierId !== null && supplierIds.has(link.supplierId))
      ) {
        this.supplierDomain.supplierContactLinksMap.delete(id);
      }
    }

    for (const [id, receipt] of this.supplierDomain.purchaseReceiptsMap.entries()) {
      if (receipt.businessId === businessId) {
        this.supplierDomain.purchaseReceiptsMap.delete(id);
      }
    }

    for (const [id, lineItem] of this.supplierDomain.receiptLineItemsMap.entries()) {
      if (receiptIds.has(lineItem.receiptId)) {
        this.supplierDomain.receiptLineItemsMap.delete(id);
      }
    }

    for (const [id, job] of this.supplierDomain.receiptOCRJobsMap.entries()) {
      if (job.businessId === businessId) {
        this.supplierDomain.receiptOCRJobsMap.delete(id);
      }
    }

    for (const [id, invoice] of this.salesDomain.invoicesMap.entries()) {
      if (invoice.businessId === businessId) {
        this.salesDomain.invoicesMap.delete(id);
      }
    }

    for (const [id, payment] of this.salesDomain.paymentsMap.entries()) {
      if (payment.businessId === businessId || invoiceIds.has(payment.invoiceId)) {
        this.salesDomain.paymentsMap.delete(id);
      }
    }

    for (const [id, logistics] of this.logisticsDomain.logisticsMap.entries()) {
      if (logistics.businessId === businessId || invoiceIds.has(logistics.invoiceId)) {
        this.logisticsDomain.logisticsMap.delete(id);
        this.logisticsDomain.logisticsByInvoiceMap.delete(logistics.invoiceId);
      }
    }

    for (const records of [
      this.commercialRecordsDomain.contactsMap,
      this.commercialRecordsDomain.supplierContactsMap,
      this.commercialRecordsDomain.purchasePricesMap,
      this.commercialRecordsDomain.purchasesMap,
      this.commercialRecordsDomain.salesMap,
      this.commercialRecordsDomain.locationsMap,
      this.commercialRecordsDomain.routesMap
    ]) {
      for (const [id, record] of records) {
        if (record.businessId === businessId) records.delete(id);
      }
    }
    for (const [id, stop] of this.commercialRecordsDomain.routeStopsMap) {
      if (!this.commercialRecordsDomain.routesMap.has(stop.routeId)) {
        this.commercialRecordsDomain.routeStopsMap.delete(id);
      }
    }

    for (const [id, movement] of this.salesDomain.inventoryMovementsMap.entries()) {
      if (movement.businessId === businessId) {
        this.salesDomain.inventoryMovementsMap.delete(id);
      }
    }

    for (const [id, item] of this.documentImportDomain.documentImportsMap.entries()) {
      if (item.businessId === businessId) {
        this.documentImportDomain.documentImportsMap.delete(id);
      }
    }

    for (const [id, source] of this.documentImportDomain.documentImportSourcesMap.entries()) {
      if (source.businessId === businessId) {
        this.documentImportDomain.documentImportSourcesMap.delete(id);
      }
    }

    for (const [id, notification] of this.notificationsDomain.notificationsMap.entries()) {
      if (notification.businessId === businessId) {
        this.notificationsDomain.notificationsMap.delete(id);
        this.notificationsDomain.notificationByRuleKeyMap.delete(notificationRuleKey(notification));
      }
    }

    for (const [id, session] of this.agentRuntimeDomain.runtimeSessionsMap.entries()) {
      if (session.businessId === businessId) {
        this.agentRuntimeDomain.runtimeSessionsMap.delete(id);
      }
    }

    for (const [id, turn] of this.agentRuntimeDomain.runtimeTurnsMap.entries()) {
      if (turn.businessId === businessId) {
        this.agentRuntimeDomain.runtimeTurnsMap.delete(id);
      }
    }

    this.messagingDomain.deleteConversationAttachmentsForBusiness(businessId);

    for (const [id, action] of this.agentRuntimeDomain.pendingRuntimeActionsMap.entries()) {
      if (action.businessId === businessId) {
        this.agentRuntimeDomain.pendingRuntimeActionsMap.delete(id);
      }
    }

    for (const [id, exportBundle] of this.dataExports.entries()) {
      if (exportBundle.businessId === businessId) {
        this.dataExports.delete(id);
      }
    }

    this.shopPresences.delete(businessId);
    for (const [id, invite] of this.networkInvites.entries()) {
      if (invite.businessId === businessId) this.networkInvites.delete(id);
    }
    for (const [id, request] of this.salesDomain.publicCustomerCareRequestsMap.entries()) {
      if (request.businessId === businessId)
        this.salesDomain.publicCustomerCareRequestsMap.delete(id);
    }
    for (const [id, message] of this.salesDomain.publicStorefrontMessagesMap.entries()) {
      if (message.businessId === businessId)
        this.salesDomain.publicStorefrontMessagesMap.delete(id);
    }
    for (const [id, order] of this.salesDomain.publicOrdersMap.entries()) {
      if (order.businessId === businessId) this.salesDomain.publicOrdersMap.delete(id);
    }

    for (const [id, membership] of this.memberships.entries()) {
      if (membership.businessId === businessId) {
        this.memberships.delete(id);
      }
    }

    this.compliance.verificationTiersMap.delete(businessId);
    this.compliance.taxConfigsMap.delete(businessId);
    this.salesDomain.productFieldSchemasMap.delete(businessId);
    this.compliance.betaAccessMap.delete(businessId);
    this.compliance.launchSettingsMap.delete(businessId);
    this.businesses.delete(businessId);
  }

  private deleteAccountOwnedData(
    request: AccountDeletionRequestSummary,
    subjects: AccountDeletionSubject[]
  ): number {
    const userIds = new Set(
      [...this.users.values()]
        .filter((user) => user.accountId === request.accountId)
        .map((user) => user.id)
    );
    const exclusivelyOwnedBusinessIds = new Set(
      [...this.businesses.values()]
        .filter((business) => {
          const memberships = this.membershipsForBusiness(business.id);
          return (
            memberships.some(
              (membership) => userIds.has(membership.userId) && membership.role === "owner"
            ) && memberships.every((membership) => userIds.has(membership.userId))
          );
        })
        .map((business) => business.id)
    );
    const scope = new Set<string>([
      request.accountId,
      ...userIds,
      ...exclusivelyOwnedBusinessIds,
      ...subjects.map((subject) => subject.subject)
    ]);
    let deletedRecordCount = 0;
    let previousScopeSize = -1;

    deletedRecordCount += this.messagingDomain.deleteConversationAttachmentsForAccount(
      request.accountId
    );

    while (previousScopeSize !== scope.size) {
      previousScopeSize = scope.size;
      deletedRecordCount += this.modelTemplatesDomain.deleteBusinessesInScope(scope);
      deletedRecordCount += deleteScopedMapRecords(this.accounts, scope);
      deletedRecordCount += deleteScopedMapRecords(this.users, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.deviceBootstrapDomain.deviceAccountBootstrapsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.deviceBootstrapDomain.deviceRecoveryCredentialsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.businesses, scope);
      deletedRecordCount += deleteScopedMapRecords(this.memberships, scope);
      deletedRecordCount += deleteScopedMapRecords(this.sessionContexts, scope);
      deletedRecordCount += deleteScopedMapRecords(this.messagingDomain.conversationsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.conversationParticipantsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.conversationMessagesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.platformIdentitiesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.conversationChannelsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.providerUpdateReceiptsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.channelIdentityLinkGrantsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.messagingDomain.nativeSmsDevicesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.nativeSmsDeviceCommandsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.connectedMailboxesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.connectedMailboxOAuthSessionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.customerRuntimeCapabilitiesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.messageDeliveryAttemptsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.messageNotificationDeliveriesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.messagingDomain.e2eeDevicesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.pushSubscriptionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.messagingDomain.conversationTypingMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.marketplaceIntroStates, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.activeAiModelsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.agentRuntimeDomain.agentProfilesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.agentRuntimeVersionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.agentContextSourcesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.agentEvaluationEventsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.agentOwnerCorrectionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.installedAgentModelsMap,
        scope
      );
      // nativeRuntimeBindings.modelsMap is deliberately excluded here - models are the global,
      // operator-editable catalog (like cp2_model_catalog), never account-owned, so nothing to
      // sweep. Agents/hosts/installations/bindings/binding-models are account-or-business-scoped
      // (businessId/accountId fields, or a foreign key that cascades to one) and must be removed or
      // an account deletion leaves orphaned runtime state behind (see docs/adr/
      // ADR-default-runtime-pi-smollm.md and the account-deletion completeness requirement).
      deletedRecordCount += deleteScopedMapRecords(this.nativeRuntimeBindings.agentsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.nativeRuntimeBindings.hostsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.nativeRuntimeBindings.installationsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.nativeRuntimeBindings.bindingsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.nativeRuntimeBindings.bindingModelsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.platformOperators, scope);
      deletedRecordCount += deleteScopedMapRecords(this.mcpTokensDomain.mcpAccessTokensMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.externalConnectionsDomain.connectionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.productFieldSchemasMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.productsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.productMediaMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.commerce.productCaptureJobsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.commerce.statusBroadcastsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.commerce.buyOrdersMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.commerce.statusOrdersMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.commerce.unifiedCheckoutsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.customersMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.supplierDomain.suppliersMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.supplierDomain.salesAgentsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.supplierDomain.supplierContactLinksMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.supplierDomain.purchaseReceiptsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.supplierDomain.receiptLineItemsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.supplierDomain.receiptOCRJobsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.invoicesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.paymentsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.logisticsDomain.logisticsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.commercialRecordsDomain.contactsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.commercialRecordsDomain.supplierContactsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.commercialRecordsDomain.purchasePricesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.commercialRecordsDomain.purchasesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.commercialRecordsDomain.salesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.commercialRecordsDomain.locationsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.commercialRecordsDomain.routesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.commercialRecordsDomain.routeStopsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.dataExports, scope);
      deletedRecordCount += deleteScopedMapRecords(this.accountDeletionRequests, scope);
      deletedRecordCount += deleteScopedMapRecords(this.shopPresences, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkInvites, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.salesDomain.publicCustomerCareRequestsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.salesDomain.publicStorefrontMessagesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.publicOrdersMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.verificationTiersMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.taxConfigsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.deviceTrustMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.betaAccessMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.betaFeatureFlagsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.betaDeviceTestsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.betaSupportTicketsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.betaTelemetryEventsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.launchSettingsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.launchChecklistMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.compliance.launchIncidentsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.documentImportDomain.documentImportsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.documentImportDomain.documentImportSourcesMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.notificationsDomain.notificationsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.runtimeSessionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.agentRuntimeDomain.runtimeTurnsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(
        this.agentRuntimeDomain.pendingRuntimeActionsMap,
        scope
      );
      deletedRecordCount += deleteScopedMapRecords(this.salesDomain.inventoryMovementsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.syncQueue, scope);
      deletedRecordCount += deleteScopedMapRecords(this.otpDomain.otpChallengesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.otpDomain.smsDeliveryAttemptsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.sessions, scope);
      deletedRecordCount += deleteScopedMapRecords(this.passkeyDomain.passkeysMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.passkeyDomain.passkeyCeremoniesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.accountIdentities, scope);
      deletedRecordCount += deleteScopedMapRecords(this.passwordCredentials, scope);
      deletedRecordCount += deleteScopedMapRecords(this.authTransactions, scope);
      deletedRecordCount += deleteScopedMapRecords(this.mfaFactors, scope);
      deletedRecordCount += deleteScopedMapRecords(this.recoveryCodes, scope);
      deletedRecordCount += deleteScopedMapRecords(this.oauthDomain.userIdentitiesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.oauthDomain.oauthSessionsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.accountPinHashes, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.networkNodesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.networkEdgesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.networkSourcesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.networkPermissionsMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.networkRoutesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.contactHashesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.externalIdentitiesMap, scope);
      deletedRecordCount += deleteScopedMapRecords(this.networkDomain.sokoIdentityLinksMap, scope);
    }

    deletedRecordCount += deleteScopedArrayRecords(this.syncChanges, scope);
    deletedRecordCount += deleteScopedArrayRecords(this.auditEvents, scope);
    for (const businessId of exclusivelyOwnedBusinessIds) {
      this.quarantinedBusinessIds.delete(businessId);
    }
    this.rebuildDerivedIndexesAfterAccountPurge();
    return deletedRecordCount;
  }

  private rebuildDerivedIndexesAfterAccountPurge(): void {
    this.deviceBootstrapDomain.pruneOrphanedEphemeralCredentials((sessionId) =>
      this.sessions.has(sessionId)
    );

    this.accountByDestination.clear();
    for (const account of this.accounts.values()) {
      this.accountByDestination.set(
        destinationAccountKey(account.primaryAuthChannel, account.primaryAuthDestination),
        account.id
      );
    }

    this.userByAccount.clear();
    for (const user of this.users.values()) this.userByAccount.set(user.accountId, user.id);

    this.identityAccountByValue.clear();
    for (const identity of this.accountIdentities.values()) {
      this.identityAccountByValue.set(
        destinationAccountKey(identity.type, identity.normalizedValue),
        identity.accountId
      );
    }

    this.messagingDomain.rebuildDerivedIndexes();

    this.logisticsDomain.rebuildLogisticsByInvoiceIndex();

    this.notificationsDomain.rebuildNotificationByRuleKeyIndex();

    this.syncQueueIdByIdempotency.clear();
    for (const item of this.syncQueue.values()) {
      this.syncQueueIdByIdempotency.set(
        syncQueueIdempotencyKey(item.businessId, item.idempotencyKey),
        item.id
      );
    }

    this.oauthDomain.rebuildIdentityIndex();

    this.mcpTokensDomain.rebuildTokenIndex();

    this.externalConnectionsDomain.rebuildIndex();

    this.networkDomain.rebuildDerivedIndexes();

    this.nextSyncSequenceByAccount.clear();
    for (const change of this.syncChanges) {
      this.nextSyncSequenceByAccount.set(
        change.accountId,
        Math.max(this.nextSyncSequenceByAccount.get(change.accountId) ?? 1, change.sequence + 1)
      );
    }
  }

  private buildComplianceRetention(businessId: string): ComplianceRetentionSummary {
    const directIdentifierFieldsRemoved =
      this.salesDomain.customersForBusiness(businessId).length * 3 +
      this.supplierDomain.suppliersForBusiness(businessId).length * 3 +
      this.logisticsDomain
        .logisticsForBusiness(businessId)
        .filter((item) => item.destination !== null).length;

    return {
      businessId,
      retainedInvoiceCount: this.salesDomain
        .invoicesForBusiness(businessId)
        .filter((invoice) => invoice.status === "confirmed").length,
      retainedPaymentCount: this.salesDomain.paymentsForBusiness(businessId).length,
      retainedLogisticsCount: this.logisticsDomain.logisticsForBusiness(businessId).length,
      retainedImportCount: this.documentImportDomain.importsForBusiness(businessId).length,
      retainedAuditEventCount: this.auditEventsForBusiness(businessId).length,
      directIdentifierFieldsRemoved
    };
  }

  private appendBusinessEvent(event: BusinessEvent): void {
    this.auditEvents.push(event);
  }

  private recordAuditEvent(input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }): void {
    this.auditEvents.push(
      createAuditEvent({
        id: randomUUID(),
        type: input.type,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        actorId: input.actorId,
        risk: "low",
        occurredAt: input.occurredAt,
        payload: input.payload
      })
    );
  }

  private createGlobalShopId(input: {
    businessName: string;
    ownerDisplayName: string;
    destination: string;
  }): string {
    const generatedDisplayNames = new Set([
      defaultDisplayName(input.destination).toLowerCase(),
      "owner",
      "soko user"
    ]);
    const ownerDisplayName = input.ownerDisplayName.trim().toLowerCase();
    const candidateHandles = [
      ...(generatedDisplayNames.has(ownerDisplayName)
        ? []
        : [createSokoHandle(input.ownerDisplayName)]),
      createSokoHandle(input.businessName)
    ].filter(
      (handle, index, handles) =>
        handle.length >= minimumSokoHandleLength &&
        !isReservedSokoHandle(handle) &&
        handles.indexOf(handle) === index
    );

    for (const handle of candidateHandles) {
      const candidate = `soko.${handle}`;
      if (!this.hasGlobalShopId(candidate)) return candidate;
    }

    const fallbackHandle = candidateHandles.at(-1) ?? "store";
    for (let suffix = 2; suffix <= 10_000; suffix += 1) {
      const suffixText = `-${suffix}`;
      const candidate = `soko.${fallbackHandle.slice(0, 48 - suffixText.length)}${suffixText}`;
      if (!this.hasGlobalShopId(candidate)) return candidate;
    }

    throw new Cp2Error(
      500,
      "soko_id_collision",
      "A unique Soko Storefront ID could not be generated."
    );
  }

  private hasGlobalShopId(sokoId: string): boolean {
    const normalized = normalizeStorefrontLookupId(sokoId);
    if (
      [...this.businesses.values()].some(
        (business) => normalizeStorefrontLookupId(business.sokoId) === normalized
      )
    ) {
      return true;
    }
    // A retired sokoId is unavailable for the duration of its cooldown (releasedAt === null) -
    // see renameSokoId/releaseExpiredSokoIds. Once released, it's free to be claimed again.
    return [...this.sokoIdHistory.values()].some(
      (entry) =>
        entry.releasedAt === null && normalizeStorefrontLookupId(entry.sokoId) === normalized
    );
  }

  /**
   * The one shared resolver every channel (web storefront route, `GET /s/:sokoId`, Telegram
   * `/start`) uses - docs/architecture/soko-id-slug-system.md. Returns `null` only when the id
   * never existed and never will (not currently active, not anywhere in history either).
   */
  resolveBusinessBySokoId(sokoId: string): SokoIdResolution | null {
    const normalized = normalizeStorefrontLookupId(sokoId);
    const active = [...this.businesses.values()].find(
      (business) =>
        normalizeStorefrontLookupId(business.sokoId) === normalized &&
        !this.quarantinedBusinessIds.has(business.id)
    );
    if (active !== undefined) return { status: "active", business: active };

    const historical = [...this.sokoIdHistory.values()].find(
      (entry) => normalizeStorefrontLookupId(entry.sokoId) === normalized
    );
    if (historical === undefined) return null;
    const business = this.businesses.get(historical.businessId);
    if (business === undefined || this.quarantinedBusinessIds.has(business.id)) return null;
    return { status: "stale", business, redirectTo: business.sokoId };
  }

  /**
   * Explicit merchant-initiated rename (docs/architecture/soko-id-slug-system.md). The old sokoId
   * moves into history with `releasedAt: null` (in cooldown, still resolvable as "stale") rather
   * than being deleted or made immediately available - `releaseExpiredSokoIds` is what eventually
   * frees it. Rejects reserved handles, in-use handles, and anything currently in another store's
   * cooldown window, the same way initial generation does.
   */
  renameSokoId(input: {
    sessionId: string | null;
    businessId: string;
    handle: string;
    now?: Date;
  }): BusinessSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "membership:manage", now);
    const business = this.requireBusiness(input.businessId);
    const handle = input.handle.trim().toLowerCase();
    if (
      handle.length < minimumSokoHandleLength ||
      handle.length > maximumSokoHandleLength ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(handle)
    ) {
      throw new Cp2Error(
        400,
        "soko_id_invalid",
        `A storefront id must be ${minimumSokoHandleLength}-${maximumSokoHandleLength} lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen.`
      );
    }
    if (isReservedSokoHandle(handle)) {
      throw new Cp2Error(409, "soko_id_reserved", "This storefront id is reserved.");
    }
    const nextSokoId = `soko.${handle}`;
    if (normalizeStorefrontLookupId(nextSokoId) === normalizeStorefrontLookupId(business.sokoId)) {
      return { ...business };
    }
    if (this.hasGlobalShopId(nextSokoId)) {
      throw new Cp2Error(409, "soko_id_taken", "This storefront id is already in use.");
    }
    const historyEntryId = randomUUID();
    this.sokoIdHistory.set(historyEntryId, {
      id: historyEntryId,
      businessId: business.id,
      sokoId: business.sokoId,
      releasedAt: null,
      createdAt: now.toISOString()
    });
    const updated: BusinessSummary = { ...business, sokoId: nextSokoId };
    this.businesses.set(business.id, updated);
    this.recordAuditEvent({
      type: "business.soko_id_renamed",
      aggregateType: "business",
      aggregateId: business.id,
      actorId: input.sessionId ?? "system",
      occurredAt: now.toISOString(),
      payload: { previousSokoId: business.sokoId, nextSokoId }
    });
    return updated;
  }

  /**
   * Frees any retired sokoId whose cooldown has elapsed - called by the cooldown runner
   * (services/api/src/cp2/sokoid-cooldown-runner.ts), never inline with a request. Idempotent:
   * safe to call repeatedly, only ever advances `releasedAt` from null to a timestamp once.
   */
  releaseExpiredSokoIds(input: { cooldownMs: number; now?: Date }): number {
    const now = input.now ?? new Date();
    let released = 0;
    for (const [id, entry] of this.sokoIdHistory) {
      if (entry.releasedAt !== null) continue;
      if (now.getTime() - Date.parse(entry.createdAt) < input.cooldownMs) continue;
      this.sokoIdHistory.set(id, { ...entry, releasedAt: now.toISOString() });
      released += 1;
    }
    return released;
  }
}

export function createCp2Store(options: Cp2StoreOptions = {}): Cp2Store {
  return new Cp2Store(options);
}

function cloneSnapshotValue<T>(value: T): T {
  return structuredClone(value);
}

function assertSafeAccountAgentManifest(agent: OssAgentSummary): void {
  const expectedHost = agent.source === "github" ? "github.com" : "huggingface.co";
  const expectedPath =
    agent.source === "github" ? `/${agent.sourceId}` : `/spaces/${agent.sourceId}`;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(agent.sourceUrl);
  } catch {
    throw new Cp2Error(400, "agent_manifest_invalid", "The agent manifest source is invalid.");
  }
  if (
    !agent.licenseVerified ||
    !isAgentDefinitionId(agent.id) ||
    agent.id === "builtin:shopkeeper" ||
    agent.id !== `${agent.source}:${agent.sourceId}` ||
    sourceUrl.protocol !== "https:" ||
    sourceUrl.hostname !== expectedHost ||
    sourceUrl.pathname.replace(/\/$/, "") !== expectedPath
  ) {
    throw new Cp2Error(
      400,
      "agent_manifest_invalid",
      "Only a license-verified GitHub or Hugging Face agent manifest can be saved."
    );
  }
}

function accountAiAssetError(error: unknown): Cp2Error {
  const message = error instanceof Error ? error.message : "Account AI asset operation failed.";
  const notFound = message.includes("not found");
  return new Cp2Error(
    notFound ? 404 : 409,
    notFound ? "account_ai_asset_not_found" : "account_ai_asset_incomplete",
    message
  );
}

function deduplicateDeletionSubjects(subjects: AccountDeletionSubject[]): AccountDeletionSubject[] {
  return [...new Map(subjects.map((item) => [`${item.provider}:${item.subject}`, item])).values()];
}

function deletionSubjectDigest(accountId: string, requestId: string): string {
  return createHash("sha256")
    .update(`soko-account-deletion-proof:v1:${accountId}:${requestId}`)
    .digest("hex");
}

function deleteScopedMapRecords<T>(map: Map<string, T>, scope: Set<string>): number {
  let deleted = 0;
  for (const [key, value] of [...map.entries()]) {
    if (!scope.has(key) && !valueReferencesDeletionScope(value, scope)) continue;
    const recordId = readRecordId(value);
    if (recordId !== null) scope.add(recordId);
    map.delete(key);
    deleted += 1;
  }
  return deleted;
}

function deleteScopedArrayRecords<T>(records: T[], scope: Set<string>): number {
  let writeIndex = 0;
  let deleted = 0;
  for (const record of records) {
    if (valueReferencesDeletionScope(record, scope)) {
      const recordId = readRecordId(record);
      if (recordId !== null) scope.add(recordId);
      deleted += 1;
      continue;
    }
    records[writeIndex] = record;
    writeIndex += 1;
  }
  records.splice(writeIndex);
  return deleted;
}

function readRecordId(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function valueReferencesDeletionScope(
  value: unknown,
  scope: Set<string>,
  seen = new Set<object>()
): boolean {
  if (typeof value === "string") return scope.has(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => valueReferencesDeletionScope(item, scope, seen));
  }
  return Object.values(value).some((item) => valueReferencesDeletionScope(item, scope, seen));
}

function sessionAccessTtlMs(): number {
  return readSessionDuration("SESSION_ACCESS_TTL_SECONDS", 900, 60, 86_400) * 1_000;
}

function sessionInactivityTtlMs(): number {
  return readSessionDuration("SESSION_INACTIVITY_TTL_DAYS", 30, 1, 90) * 24 * 60 * 60 * 1_000;
}

function sessionAbsoluteTtlMs(): number {
  return readSessionDuration("SESSION_ABSOLUTE_TTL_DAYS", 180, 7, 365) * 24 * 60 * 60 * 1_000;
}

function sessionInactivityExpiry(now: Date, absoluteExpiresAt?: string): string {
  const inactivity = now.getTime() + sessionInactivityTtlMs();
  const absolute =
    absoluteExpiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(absoluteExpiresAt);
  return new Date(Math.min(inactivity, absolute)).toISOString();
}

function readSessionDuration(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function serializeSessionCookie(
  sessionId: string,
  maxAgeSeconds = sessionAccessTtlMs() / 1000
): string {
  return `${sessionCookieName}=${sessionId}; ${cookieAttributes(maxAgeSeconds)}`;
}

export function serializeRefreshCookie(
  refreshToken: string,
  maxAgeSeconds = sessionInactivityTtlMs() / 1000
): string {
  return `${refreshCookieName}=${refreshToken}; ${cookieAttributes(maxAgeSeconds)}`;
}

export function clearSessionCookie(): string {
  return `${sessionCookieName}=; ${cookieAttributes(0)}`;
}

export function clearRefreshCookie(): string {
  return `${refreshCookieName}=; ${cookieAttributes(0)}`;
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  return readNamedCookie(cookieHeader, sessionCookieName);
}

export function readRefreshCookie(cookieHeader: string | undefined): string | null {
  return readNamedCookie(cookieHeader, refreshCookieName);
}

function readNamedCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (cookieHeader === undefined) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");

    if (name === cookieName) {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return value === "en" || value === "sw";
}

function normalizePin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) {
    throw new Cp2Error(400, "pin_invalid", "PIN must be exactly 4 digits.");
  }

  return pin;
}

function createAuditEvent<TPayload extends Record<string, unknown>>(
  event: BusinessEvent<TPayload>
): BusinessEvent<TPayload> {
  return deepFreeze({
    ...event,
    payload: deepFreeze({ ...event.payload })
  }) as BusinessEvent<TPayload>;
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  for (const propertyName of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[propertyName]);
  }

  return Object.freeze(value);
}

function replaceExactStringReferences(
  value: unknown,
  replacements: ReadonlyMap<string, string>
): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceExactStringReferences(item, replacements));
  }
  if (value === null || typeof value !== "object") return value;
  const replaced: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    replaced[key] = replaceExactStringReferences(item, replacements);
  }
  return replaced;
}

function syncQueueIdempotencyKey(businessId: string, idempotencyKey: string): string {
  return `${businessId}:${idempotencyKey}`;
}

function dataExportSummary(exportBundle: DataExportBundle): DataExportBundleSummary {
  return {
    id: exportBundle.id,
    businessId: exportBundle.businessId,
    accountId: exportBundle.accountId,
    actorId: exportBundle.actorId,
    status: exportBundle.status,
    recordCounts: exportBundle.recordCounts,
    checksum: exportBundle.checksum,
    createdAt: exportBundle.createdAt
  };
}

function countExportRecords(data: DataExportBundle["data"]): Record<string, number> {
  return {
    account: 1,
    user: 1,
    business: 1,
    memberships: data.memberships.length,
    products: data.products.length,
    customers: data.customers.length,
    suppliers: data.suppliers.length,
    invoices: data.invoices.length,
    payments: data.payments.length,
    logistics: data.logistics.length,
    documentImports: data.documentImports.length,
    notifications: data.notifications.length,
    inventoryMovements: data.inventoryMovements.length,
    auditEvents: data.auditEvents.length
  };
}

function marketplaceIntroStateKey(accountId: string, businessId: string | null): string {
  return `${accountId}:${businessId ?? "marketplace"}`;
}

function cookieAttributes(maxAgeSeconds: number): string {
  const sameSite = cookieSameSite();
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.floor(maxAgeSeconds)}${
    domain ? `; Domain=${domain}` : ""
  }${secureCookieSuffix()}`;
}

function secureCookieSuffix(): string {
  const explicitCookie = process.env.COOKIE_SECURE?.trim().toLowerCase();
  const explicit = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();

  if (
    explicitCookie === "true" ||
    explicitCookie === "1" ||
    explicit === "true" ||
    explicit === "1" ||
    process.env.NODE_ENV === "production"
  ) {
    return "; Secure";
  }

  return "";
}

function cookieSameSite(): "Lax" | "Strict" | "None" {
  const configured = process.env.COOKIE_SAME_SITE?.trim().toLowerCase() ?? "lax";
  if (configured === "strict") return "Strict";
  if (configured === "none") return "None";
  return "Lax";
}

function hashPin(accountId: string, pin: string): string {
  return createScryptPinHash(accountId, pin, pinHashSecret());
}

function validatePassword(password: string): void {
  if (password.length < 10 || password.length > 256) {
    throw new Cp2Error(400, "password_invalid", "Use a password between 10 and 256 characters.");
  }
}

function createPasswordCredential(
  accountId: string,
  password: string,
  now: Date
): PasswordCredentialRecord {
  const timestamp = now.toISOString();
  return {
    accountId,
    passwordHash: createScryptPasswordHash(accountId, password, passwordHashSecret()),
    passwordChangedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createScryptPasswordHash(accountId: string, password: string, secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(`${accountId}:${password}:${secret}`, salt, 32, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 96 * 1024 * 1024
  });
  return [
    "scrypt",
    "password-v1",
    "32768",
    "8",
    "1",
    salt.toString("base64url"),
    hash.toString("base64url")
  ].join("$");
}

function verifyPasswordHash(
  accountId: string,
  password: string,
  storedHash: string
): "current" | "invalid" {
  const parts = storedHash.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "password-v1") return "invalid";
  try {
    const salt = Buffer.from(parts[5]!, "base64url");
    const expected = Buffer.from(parts[6]!, "base64url");
    const candidate = scryptSync(`${accountId}:${password}:${passwordHashSecret()}`, salt, 32, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 96 * 1024 * 1024
    });
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
      ? "current"
      : "invalid";
  } catch {
    return "invalid";
  }
}

function passwordHashSecret(): string {
  const configured = process.env.PASSWORD_HASH_SECRET?.trim();
  if (configured !== undefined && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production")
    throw new Cp2Error(
      503,
      "password_hash_unconfigured",
      "Password authentication is temporarily unavailable."
    );
  return "soko-market-local-password-hash-secret";
}

function hashRecoveryCode(accountId: string, code: string): string {
  return createHmac("sha256", passwordHashSecret())
    .update(`${accountId}:${code.trim().toUpperCase()}`)
    .digest("hex");
}

function securityCorrelationHash(value: string): string {
  const secret = process.env.AUTH_AUDIT_HMAC_SECRET?.trim() || passwordHashSecret();
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 24);
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function base32Encode(value: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  let result = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/u, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  lastUsedStep: number | null
): number | null {
  if (!/^\d{6}$/u.test(code.trim())) return null;
  const currentStep = Math.floor(now.getTime() / 30_000);
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    const expected = binary.toString().padStart(6, "0");
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code.trim()))) return step;
  }
  return null;
}

function createScryptPinHash(accountId: string, pin: string, secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(`${accountId}:${pin}:${secret}`, salt, pinScryptKeyLength, {
    N: pinScryptCost,
    r: pinScryptBlockSize,
    p: pinScryptParallelization,
    maxmem: pinScryptMaximumMemory
  });
  return [
    "scrypt",
    "v2",
    pinScryptCost,
    pinScryptBlockSize,
    pinScryptParallelization,
    salt.toString("base64url"),
    hash.toString("base64url")
  ].join("$");
}

function verifyPinHash(
  accountId: string,
  pin: string,
  storedHash: string
): "current" | "legacy" | "invalid" {
  const parts = storedHash.split("$");
  if (
    parts.length === 7 &&
    parts[0] === "scrypt" &&
    parts[1] === "v2" &&
    parts[2] === String(pinScryptCost) &&
    parts[3] === String(pinScryptBlockSize) &&
    parts[4] === String(pinScryptParallelization)
  ) {
    const pinMaterial = `${accountId}:${pin}:${pinHashSecret()}`;
    try {
      const salt = Buffer.from(parts[5] ?? "", "base64url");
      const expected = Buffer.from(parts[6] ?? "", "base64url");
      if (salt.length !== 16 || expected.length !== pinScryptKeyLength) return "invalid";
      const candidate = scryptSync(pinMaterial, salt, pinScryptKeyLength, {
        N: pinScryptCost,
        r: pinScryptBlockSize,
        p: pinScryptParallelization,
        maxmem: pinScryptMaximumMemory
      });
      return timingSafeEqual(candidate, expected) ? "current" : "invalid";
    } catch {
      return "invalid";
    }
  }

  if (/^[a-f0-9]{64}$/u.test(storedHash)) {
    const legacyHash = createHash("sha256").update(`${accountId}:${pin}`).digest("hex");
    return hashMatches(legacyHash, storedHash) ? "legacy" : "invalid";
  }

  return "invalid";
}

function pinHashSecret(): string {
  const configured = process.env.PIN_HASH_SECRET?.trim();
  if (configured !== undefined && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Cp2Error(
      503,
      "pin_hash_secret_unconfigured",
      "PIN authentication is temporarily unavailable."
    );
  }
  return "soko-market-local-pin-hash-secret";
}

function invalidLoginCredentialsError(): Cp2Error {
  return new Cp2Error(401, "auth_credentials_invalid", "The account credentials are invalid.");
}

function parseDeletionOtpChallengeId(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.startsWith("otp:")) {
    return null;
  }

  return value.slice("otp:".length);
}

function sessionView(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    expiresAt: session.expiresAt,
    inactivityExpiresAt: session.inactivityExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt
  };
}

function deviceSessionView(
  session: SessionRecord,
  currentSessionId: string,
  now: Date
): DeviceSessionSummary {
  const expired =
    Date.parse(session.inactivityExpiresAt) <= now.getTime() ||
    Date.parse(session.absoluteExpiresAt) <= now.getTime();
  return {
    id: session.id,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    platform: session.platform,
    browserOrApp: session.browserOrApp,
    sessionFamilyId: session.sessionFamilyId,
    status: session.revokedAt !== null ? "revoked" : expired ? "expired" : "active",
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    rotatedAt: session.rotatedAt,
    expiresAt: session.inactivityExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    revokedAt: session.revokedAt,
    revocationReason: session.revocationReason,
    current: session.id === currentSessionId
  };
}

function normalizeRestoredSession(session: SessionRecord): SessionRecord {
  const legacy = session as SessionRecord & Partial<SessionRecord>;
  const inactivityExpiresAt =
    legacy.inactivityExpiresAt ?? legacy.refreshExpiresAt ?? session.expiresAt;
  const legacyAbsoluteExpiry = new Date(
    Date.parse(session.createdAt) + sessionAbsoluteTtlMs()
  ).toISOString();
  const absoluteExpiresAt =
    legacy.absoluteExpiresAt ??
    new Date(
      Math.max(Date.parse(inactivityExpiresAt), Date.parse(legacyAbsoluteExpiry))
    ).toISOString();
  return {
    ...session,
    deviceId: nonEmptySessionText(legacy.deviceId, "unknown-device"),
    deviceName: nonEmptySessionText(legacy.deviceName, "This device"),
    platform: nonEmptySessionText(legacy.platform, "unknown"),
    browserOrApp: nonEmptySessionText(legacy.browserOrApp, "web"),
    userAgentHash: nonEmptySessionText(legacy.userAgentHash, hashUserAgent("")),
    refreshTokenHash: nonEmptySessionText(
      legacy.refreshTokenHash,
      hashRefreshToken(createRefreshToken())
    ),
    sessionFamilyId: legacy.sessionFamilyId ?? session.id,
    refreshExpiresAt: inactivityExpiresAt,
    inactivityExpiresAt,
    absoluteExpiresAt,
    rotatedFromSessionId: legacy.rotatedFromSessionId ?? null,
    authenticatedAt: legacy.authenticatedAt ?? legacy.pinVerifiedAt ?? session.createdAt,
    lastUsedAt: legacy.lastUsedAt ?? session.createdAt,
    rotatedAt: legacy.rotatedAt ?? null,
    revocationReason: legacy.revocationReason ?? null
  };
}

function nonEmptySessionText(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashUserAgent(userAgent: string): string {
  return createHash("sha256").update(userAgent).digest("hex");
}

function constantTimeHashMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function normalizeDeviceSessionValue(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 200);
  return normalized.length > 0 ? normalized : fallback;
}

function cloneModelCatalogEntry(model: AiModelSummary): AiModelSummary {
  return { ...model, capabilities: [...model.capabilities] };
}

function cloneAgentCatalogEntry(agent: AgentDefinition): AgentDefinition {
  return { ...agent, tools: [...agent.tools], skillIds: [...agent.skillIds] };
}

function invalidBoundedText(value: unknown, maximumLength: number): boolean {
  return typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength;
}

function invalidNullableNonNegativeInteger(value: number | null): boolean {
  return value !== null && (!Number.isSafeInteger(value) || value < 0);
}

function invalidNullablePositiveInteger(value: number | null): boolean {
  return value !== null && (!Number.isSafeInteger(value) || value <= 0);
}

function invalidNullablePositiveNumber(value: number | null): boolean {
  return value !== null && (!Number.isFinite(value) || value <= 0);
}

function defaultDisplayName(destination: string): string {
  if (destination.includes("@")) return destination.split("@")[0] ?? "Owner";
  const digits = destination.replace(/\D/gu, "");
  return digits.length >= 4 ? `Trader ${digits.slice(-4)}` : "Owner";
}

function syncOriginCursor(accountId: string): string {
  return createHash("sha256").update(`soko-sync-origin:${accountId}`).digest("base64url");
}

function syncRecordDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}
