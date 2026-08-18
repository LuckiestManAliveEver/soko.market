import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { isPaymentMethod, type BusinessPermission } from "@soko/business-core";
import type {
  AgentContextSource,
  AgentEvaluationPolicy,
  AgentInstructions,
  AgentMemoryPolicy,
  AgentOwnerCorrection,
  AgentPersonality,
  AgentSkillBinding,
  AuthChannel,
  BuyCheckoutItemInput,
  BuyResultSourceKind,
  BetaAccessStatus,
  BetaDeviceClass,
  BetaDeviceTestStatus,
  BetaFeatureFlagKey,
  BetaSupportSeverity,
  BetaSupportTicketStatus,
  BetaTelemetryKind,
  BrowserCheckpointCompatibilityContract,
  BrowserDeviceTier,
  BrowserRuntimeContract,
  ClientInferenceCompletion,
  DeviceTrustLevel,
  AgentModelFallbackPolicy,
  AgentModelBindingPermissions,
  AgentModelReadinessStatus,
  AgentModelRuntimeBackend,
  InstalledAgentModelSummary,
  ModelCompatibilityStatus,
  ModelInstallationStatus,
  ModelExecutionTarget,
  PreferredExecutionMode,
  LaunchAccessStatus,
  LaunchChecklistKey,
  LaunchChecklistStatus,
  LaunchIncidentCategory,
  LaunchIncidentSeverity,
  LaunchIncidentStatus,
  MessageHandoffChannel,
  MessageHandoffStatus,
  NativeSmsResultCode,
  ProductFieldDefinition,
  ProductFieldInputType,
  PublicCustomerCareRequestType,
  ShopPresenceStatus,
  TaxCountryCode,
  SyncMutationPayload,
  SyncMutationType,
  ConversationKind,
  ChannelProvider,
  ConnectedMailboxProvider,
  TrustedMessageAttachmentReference,
  ConversationMessageContent,
  E2eePublicKey,
  MessageChannel,
  SokoChatSurface,
  SokoMode,
  SyncRealtimeReadyEvent,
  InferenceRequest,
  OwnerInferenceNodeMessage,
  RuntimeRecallEscalation,
  VerificationTier
} from "@soko/shared-types";
import { isSyncMutationType } from "@soko/sync-core";
import {
  clearRefreshCookie,
  clearSessionCookie,
  Cp2Error,
  createCp2Store,
  isSupportedLanguage,
  readRefreshCookie,
  readSessionCookie,
  serializeRefreshCookie,
  serializeSessionCookie,
  type BusinessAgentProfileInput,
  type Cp2Store
} from "./store.js";
import {
  parseBoolean,
  parseContactRecordBody,
  parseIntegerString,
  parseIsoTimestamp,
  parseNonNegativeInteger,
  parseNullableNumber,
  parseNullableString,
  parseNumber,
  parseOptionalNonNegativeInteger,
  parseOptionalString,
  parsePositiveInteger,
  parseRequestBody,
  parseString,
  parseStringArray,
  readDeviceSessionMetadata,
  readHeader,
  sendCp2Error,
  setAuthSessionCookies,
  type BusinessParams,
  type ContactRecordBody
} from "./route-helpers.js";
import {
  parseLogisticsBody,
  parseLogisticsStatusBody,
  registerLogisticsRoutes
} from "./domains/logistics/routes.js";
import { registerNotificationsRoutes } from "./domains/notifications/routes.js";
import { registerPasskeysRoutes } from "./domains/passkeys/routes.js";
import { registerNetworkRoutes } from "./domains/network/routes.js";
import { decodeReceiptBase64, registerSuppliersRoutes } from "./domains/suppliers/routes.js";
import {
  assertDocumentOcrSignature,
  parseDocumentImportBody,
  registerDocumentImportsRoutes,
  type ProductCatalogueImportBody
} from "./domains/document-imports/routes.js";
import { createEmailProviderFromEnvironment, type EmailProvider } from "./email-provider.js";
import {
  normalizeInternationalOwnerPhoneNumber,
  normalizeOwnerPhoneNumber
} from "./phone-identity.js";
import {
  createGitHubModelCatalogFromEnvironment,
  type GitHubModelCatalog
} from "./github-model-catalog.js";
import {
  createHuggingFaceModelCatalogFromEnvironment,
  type HuggingFaceModelCatalog
} from "./huggingface-model-catalog.js";
import {
  createOAuthStartPayload,
  exchangeOAuthCode,
  fetchOAuthProfile,
  getOAuthProviderConfig,
  isOAuthProviderConfigured,
  listOAuthProviders,
  parseOAuthProvider
} from "./oauth.js";
import type { ReceiptOCRProcessor } from "./receipt-ocr-provider.js";
import type { BinaryUploadPipeline } from "./binary-upload-pipeline.js";
import type { OwnerNodeBroker } from "../inference/owner-node-broker.js";
import { readAuthRuntimeConfig } from "./auth-runtime-config.js";

export interface Cp2RouteOptions {
  binaryUploadPipeline?: BinaryUploadPipeline;
  emailProvider?: EmailProvider;
  githubModelCatalog?: GitHubModelCatalog;
  huggingFaceModelCatalog?: HuggingFaceModelCatalog;
  oauthAllowedRedirectOrigins?: string[];
  ownerNodeBroker?: OwnerNodeBroker;
  realtimeAllowedOrigins?: string[];
  receiptOCRProcessor?: ReceiptOCRProcessor;
  store?: Cp2Store;
  vapidPublicKey?: string;
}

interface OtpRequestBody {
  channel?: string;
  contact?: string;
  deliveryChannel?: string;
  destination?: string;
  method?: string;
  purpose?: string;
}

interface OtpVerifyBody {
  challengeId?: string;
  code?: string;
  contact?: string;
  method?: string;
  otp?: string;
}

interface OAuthStartBody {
  provider?: string;
  redirectUri?: string;
}

interface OAuthStartParams {
  provider: string;
}

interface AuthIdentityParams {
  identityId: string;
}

interface OAuthCallbackBody {
  code?: string;
  csrfToken?: string;
  provider?: string;
  state?: string;
}

interface OAuthCallbackParams {
  provider: string;
}

interface OAuthCallbackQuery {
  code?: string;
  csrfToken?: string;
  error?: string;
  state?: string;
}

interface SyncPullQuery {
  cursor?: string;
  limit?: string;
}

interface AiModelSearchQuery {
  search?: string;
}

interface OwnerNodePresenceQuery {
  tenantId?: string;
  agentId?: string;
  modelId?: string;
}

interface InstalledModelQuery {
  deviceId?: string;
}

interface InstalledModelParams {
  installationId: string;
}

interface InstalledModelBody {
  id?: unknown;
  deviceId?: unknown;
  modelId?: unknown;
  displayName?: unknown;
  provider?: unknown;
  repositoryId?: unknown;
  filename?: unknown;
  format?: unknown;
  quantization?: unknown;
  architecture?: unknown;
  parameterCount?: unknown;
  contextLength?: unknown;
  fileSizeBytes?: unknown;
  checksum?: unknown;
  packageManifestVersion?: unknown;
  packageSignature?: unknown;
  packageSigningKeyId?: unknown;
  license?: unknown;
  commercialUseAllowed?: unknown;
  storageKey?: unknown;
  runtimeBackend?: unknown;
  installationStatus?: unknown;
  compatibilityStatus?: unknown;
  installedAt?: unknown;
  lastVerifiedAt?: unknown;
  validationError?: unknown;
}

interface InstalledModelValidationBody {
  deviceId?: unknown;
  installationStatus?: unknown;
  compatibilityStatus?: unknown;
  validationError?: unknown;
}

interface AgentModelQuery {
  deviceId?: string;
}

interface AgentModelAssignmentBody {
  deviceId?: unknown;
  installationId?: unknown;
  preferredExecutionMode?: unknown;
  fallbackPolicy?: unknown;
  readinessStatus?: unknown;
  lastSuccessfulInferenceAt?: unknown;
  lastErrorCode?: unknown;
}

interface BrowserInferenceAssignmentBody {
  deviceId?: unknown;
  enabled?: unknown;
  selectedModelId?: unknown;
  modelFamilyId?: unknown;
  modelRevision?: unknown;
  runtimeContract?: unknown;
  checkpointCompatibilityContract?: unknown;
  deviceTier?: unknown;
  readinessStatus?: unknown;
  lastSuccessfulInferenceAt?: unknown;
  lastErrorCode?: unknown;
}

interface BrowserInferenceExecutionBody {
  deviceId?: unknown;
  modelId?: unknown;
  successful?: unknown;
  errorCode?: unknown;
  occurredAt?: unknown;
}

interface AgentModelOperationParams {
  agentId: string;
  modelId: string;
}

interface AgentModelBindingParams {
  agentId: string;
}

interface AgentModelBindingQuery {
  shopId?: string;
}

interface AgentModelTestBody {
  shopId?: unknown;
  executionTarget?: unknown;
}

interface AgentModelActivationBody extends AgentModelTestBody {
  executionMode?: unknown;
  fallbackPolicy?: unknown;
  permissions?: unknown;
  fallbackModelId?: unknown;
}

interface PinBody {
  pin?: string;
}

interface PinLoginBody extends PinBody {
  channel?: string;
  contact?: string;
  country?: string;
  destination?: string;
  method?: string;
}

interface StoreLoginBody extends PinBody {
  sokoId?: string;
}

interface IdentifierBody {
  type?: string;
  identifier?: string;
  country?: string;
}

interface CreateBusinessBody {
  name?: string;
  language?: string;
  phoneCountry?: string;
  phoneNumber?: string;
}

interface OwnerPhoneBody {
  country?: string;
  phoneNumber?: string;
}

interface DisplayNameBody {
  displayName?: string;
}

interface RoleCheckBody {
  businessId?: string;
  role?: string;
  permission?: string;
}

interface SessionContextBody {
  mode?: string;
  activeShopId?: string | null;
  activeSurface?: string;
  conversationId?: string;
  expectedSessionVersion?: number;
}

interface CreateConversationBody {
  kind?: string;
  activeShopId?: string | null;
  recipient?: string | null;
  title?: string | null;
}

interface MarketplaceIntroBody {
  businessId?: string | null;
}

interface AiModelActivationBody {
  modelId?: string;
}

interface AgentProfileBody {
  name?: string;
  description?: string;
  modelId?: string;
  role?: string;
  language?: string;
  personality?: string;
  instructions?: string;
  knowledge?: string;
  tools?: unknown;
  integrations?: unknown;
  contextScripts?: unknown;
  status?: string;
  personalityConfig?: unknown;
  instructionPolicy?: unknown;
  skillBindings?: unknown;
  memoryPolicy?: unknown;
  evaluationPolicy?: unknown;
  supportedLanguages?: unknown;
  businessCategory?: string;
  publicIntroduction?: string;
}

interface AgentContextSourceBody {
  id?: string;
  type?: string;
  title?: string;
  content?: string;
  sensitivity?: string;
  customerVisible?: boolean;
  status?: string;
}

interface AgentCorrectionBody {
  correction?: string;
  category?: string;
  sourceMessageId?: string | null;
  promoteToInstruction?: boolean;
}

interface AgentFeedbackBody {
  messageId?: string | null;
  correct?: boolean;
  reason?: string | null;
}

interface RuntimeVersionParams extends BusinessParams {
  version: string;
}

interface AgentCorrectionParams extends BusinessParams {
  correctionId: string;
}

interface ConversationParams {
  conversationId: string;
}

interface CreateMessageBody {
  conversationId?: string;
  clientMessageId?: string;
  idempotencyKey?: string;
  content?: unknown;
  clientTimestamp?: string | null;
  queuedAt?: string | null;
  selectedChannel?: string;
  author?: string;
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  agent?: RuntimeTurnBody & {
    businessId?: string;
  };
}

interface MessageHandoffBody {
  businessId?: string | null;
  conversationId?: string | null;
  channel?: string;
  status?: string;
  normalizedErrorCode?: string | null;
}

interface ChannelMessageBody {
  customerId?: string;
  customerName?: string;
  conversationId?: string;
  provider?: string;
  mailboxId?: string;
  subject?: string;
  replyToMessageId?: string;
  attachments?: unknown;
  text?: string;
  idempotencyKey?: string;
}

interface ConnectedMailboxParams extends BusinessParams {
  mailboxId: string;
}

interface ConnectedMailboxOAuthParams {
  provider: string;
}

interface ConnectedMailboxOAuthQuery {
  code?: string;
  error?: string;
  state?: string;
}

interface ConnectedMailboxSyncBody {
  historyDays?: number;
}

interface ConnectedMailboxUpdateBody {
  isDefault?: boolean;
  ingestUnknownSenders?: boolean;
  automaticReplyEnabled?: boolean;
  automaticReplyText?: string | null;
}

interface ChannelLinkGrantBody {
  provider?: string;
  conversationId?: string | null;
  automaticRepliesEnabled?: boolean;
}

interface CustomerAccountLinkBody {
  accountId?: string;
}

interface CustomerParams extends BusinessParams {
  customerId: string;
}

interface ChannelWebhookParams {
  provider: string;
}

interface NativeSmsDeviceBody {
  roleAvailable?: boolean;
  roleGranted?: boolean;
  sendPermissionGranted?: boolean;
  receivePermissionGranted?: boolean;
  simReady?: boolean;
  subscriptionId?: number | null;
  preferred?: boolean;
  lastErrorCode?: string | null;
}

interface NativeSmsInboundBody {
  businessId?: string;
  externalMessageId?: string;
  sender?: string;
  text?: string;
  occurredAt?: string;
}

interface NativeSmsCommandResultBody {
  status?: string;
  resultCode?: string;
  carrierReference?: string | null;
}

interface NativeSmsCommandParams {
  commandId: string;
}

interface NativeSmsDeviceParams {
  deviceId: string;
}

interface UpdateConversationBody {
  archived?: boolean;
  mutedUntil?: string | null;
  pinned?: boolean;
  read?: boolean;
  title?: string | null;
}

interface UpdateMessageBody {
  text?: string;
  content?: unknown;
  deleted?: boolean;
  reaction?: string | null;
}

interface E2eeDeviceBody {
  deviceId?: string;
  label?: string;
  publicKey?: unknown;
}

interface PushSubscriptionBody {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: unknown;
}

interface MessageParams extends ConversationParams {
  messageId: string;
}

interface StorefrontParams {
  agentId: string;
}

interface PublicStorefrontSearchQuery {
  search?: string;
  limit?: string;
}

interface ShopPresenceBody {
  status?: string;
}

interface NetworkInviteContactBody {
  name?: string;
  phone?: string | null;
  email?: string | null;
}

interface NetworkInvitesBody {
  contacts?: NetworkInviteContactBody[];
}

interface PublicCustomerCareBody {
  type?: string;
  customerName?: string | null;
  phone?: string | null;
  message?: string | null;
}

interface PublicStorefrontMessageBody {
  capabilityToken?: string;
  body?: string;
  attachmentNames?: string[];
}

interface PublicOrderBody {
  capabilityToken?: string;
  customerName?: string;
  phone?: string;
  note?: string | null;
  items?: Array<{ productId?: string; quantity?: number }>;
}

interface PublicStorefrontSessionBody {
  visitorId?: string;
  displayName?: string | null;
}

interface ProductCaptureParams extends BusinessParams {
  captureJobId: string;
}

interface ProductCaptureBody extends ProductCatalogueImportBody {
  extractedText?: string;
}

interface ProductCaptureReviewBody {
  title?: string;
  category?: string | null;
  description?: string | null;
  visiblePrice?: number | null;
  keepImageAsProductMedia?: boolean;
}

interface ProductCaptureConfirmBody {
  existingProductId?: string | null;
  unit?: string | null;
  quantity?: number;
  aliases?: string[];
}

interface ProductCaptureItemParams extends ProductCaptureParams {
  itemId: string;
}

interface ProductCaptureItemConfirmBody {
  title?: string;
  category?: string | null;
  description?: string | null;
  visiblePrice?: number | null;
  existingProductId?: string | null;
  unit?: string | null;
  quantity?: number;
  aliases?: string[];
}

interface StatusBroadcastParams extends BusinessParams {
  statusBroadcastId: string;
}

interface StatusBroadcastCreateBody {
  sourceCaptureJobId?: string;
  recipientNodeIds?: string[];
  sellerConversationId?: string | null;
}

interface StatusBroadcastEngagementParams {
  statusBroadcastId: string;
}

interface BuySearchQuery {
  query?: string;
}

interface BuyCheckoutBody {
  items?: Array<{
    sourceKind?: string;
    sourceId?: string;
    sourceLabel?: string;
    title?: string;
    quantity?: number;
    agentId?: string | null;
    productId?: string | null;
    statusBroadcastId?: string | null;
    productCaptureItemId?: string | null;
  }>;
  sellerConversationId?: string | null;
}

interface UnifiedCheckoutParams {
  unifiedCheckoutId: string;
}

interface ProductParams extends BusinessParams {
  productId: string;
}

interface CustomerParams extends BusinessParams {
  customerId: string;
}

interface InvoiceParams extends BusinessParams {
  invoiceId: string;
}

interface SyncQueueParams extends BusinessParams {
  syncItemId: string;
}

interface RuntimeSessionParams extends BusinessParams {
  runtimeSessionId: string;
}

interface PaymentParams extends BusinessParams {
  invoiceId: string;
}

interface ProductBody {
  name?: string;
  sku?: string | null;
  aliases?: unknown[];
  unit?: string | null;
  quantity?: number;
  buyingPrice?: number | null;
  sellingPrice?: number | null;
}

interface ProductFieldStructureBody {
  fields?: unknown[];
}

interface StockAdjustmentBody {
  quantityAfter?: number;
  reason?: string | null;
}

interface InvoiceItemBody {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
}

interface InvoiceBody {
  customerId?: string | null;
  customerName?: string | null;
  taxRate?: number | null;
  items?: InvoiceItemBody[];
}

interface PaymentBody {
  invoiceId?: string;
  amount?: number;
  method?: string;
  reference?: string | null;
  note?: string | null;
}

interface SyncMutationBody {
  idempotencyKey?: string;
  mutationType?: string;
  clientCreatedAt?: string;
  payload?: unknown;
}

interface RuntimeTurnBody {
  agentProfile?: {
    behavior?: string;
    contextScripts?: string[];
    integrations?: string[];
    knowledge?: string;
    model?: string;
    role?: string;
    instructions?: string;
    tools?: string[];
  };
  runtimeSessionId?: string;
  message?: string;
  confirmationToken?: string;
  recallEscalation?: RuntimeRecallEscalation;
  clientInferenceCompletion?: ClientInferenceCompletion;
}

interface RecallEffectivenessBody {
  sourceIds?: unknown;
  outcome?: unknown;
  localRuntime?: unknown;
  modelId?: unknown;
}

interface AccountDeletionBody {
  confirmation?: string;
  reason?: string | null;
}

interface ShopDeletionRequestBody {
  shopId?: string;
}

interface ShopDeletionFinalizeBody {
  acknowledgement?: boolean;
  idempotencyKey?: string | null;
  pin?: string;
}

interface ShopDeletionParams extends BusinessParams {
  requestId: string;
}

interface AccountRestorationParams {
  requestId: string;
}

interface SocialIdentityParams extends BusinessParams {
  identityId: string;
}

interface VerificationTierBody {
  tier?: string;
  evidenceType?: string | null;
  note?: string | null;
}

interface TaxConfigBody {
  countryCode?: string;
  defaultTaxRate?: number;
  taxId?: string | null;
  pricesIncludeTax?: boolean;
}

interface DeviceTrustBody {
  deviceId?: string;
  level?: string;
  reason?: string | null;
}

interface BetaFeatureFlagParams extends BusinessParams {
  featureFlagKey: string;
}

interface BetaSupportTicketParams extends BusinessParams {
  supportTicketId: string;
}

interface LaunchChecklistParams extends BusinessParams {
  checklistKey: string;
}

interface LaunchIncidentParams extends BusinessParams {
  incidentId: string;
}

interface BetaAccessBody {
  status?: string;
  invitedMerchantCount?: number;
  pauseReason?: string | null;
}

interface BetaFeatureFlagBody {
  enabled?: boolean;
  reason?: string | null;
}

interface BetaDeviceTestBody {
  deviceClass?: string;
  workflow?: string;
  status?: string;
  durationMs?: number;
  notes?: string | null;
}

interface BetaSupportTicketBody {
  severity?: string;
  title?: string;
  body?: string | null;
  source?: string;
}

interface BetaSupportTicketStatusBody {
  status?: string;
}

interface BetaTelemetryBody {
  kind?: string;
  message?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

interface LaunchSettingsBody {
  status?: string;
  publicOnboardingEnabled?: boolean;
  rollbackArmed?: boolean;
  freezeActive?: boolean;
  allowedSignupCount?: number;
  pauseReason?: string | null;
}

interface LaunchChecklistBody {
  status?: string;
  evidence?: string | null;
}

interface LaunchIncidentBody {
  severity?: string;
  category?: string;
  title?: string;
  body?: string | null;
}

interface LaunchIncidentStatusBody {
  status?: string;
}

export function registerCp2Routes(app: FastifyInstance, options: Cp2RouteOptions = {}): Cp2Store {
  const store = options.store ?? createCp2Store();
  const receiptOCRProcessor = options.receiptOCRProcessor;
  const binaryUploadPipeline = options.binaryUploadPipeline;
  const githubModelCatalog =
    options.githubModelCatalog ?? createGitHubModelCatalogFromEnvironment();
  const huggingFaceModelCatalog =
    options.huggingFaceModelCatalog ?? createHuggingFaceModelCatalogFromEnvironment();
  const emailProvider = options.emailProvider ?? createEmailProviderFromEnvironment();
  const oauthAllowedRedirectOrigins = new Set(options.oauthAllowedRedirectOrigins ?? []);
  const realtimeAllowedOrigins = new Set(options.realtimeAllowedOrigins ?? []);
  const authRuntime = readAuthRuntimeConfig(realtimeAllowedOrigins);
  const authAttemptsByIp = new Map<string, number[]>();

  function requireAuthFeature(enabled: boolean, code: string, message: string): void {
    if (!enabled) throw new Cp2Error(503, code, message);
  }

  function enforceAuthIpRate(request: FastifyRequest, purpose: string, maximum: number): void {
    const now = Date.now();
    const key = `${purpose}:${request.ip}`;
    const attempts = (authAttemptsByIp.get(key) ?? []).filter(
      (attemptedAt) => attemptedAt > now - 10 * 60_000
    );
    if (attempts.length >= maximum) {
      throw new Cp2Error(429, "auth_rate_limited", "Too many attempts. Please try again later.");
    }
    attempts.push(now);
    authAttemptsByIp.set(key, attempts);
    if (authAttemptsByIp.size > 10_000) {
      const oldest = authAttemptsByIp.keys().next().value;
      if (oldest !== undefined) authAttemptsByIp.delete(oldest);
    }
  }

  function oauthRedirectUriForRequest(
    request: FastifyRequest,
    providerConfig: ReturnType<typeof getOAuthProviderConfig>,
    requestedRedirectUri?: string
  ): string {
    const redirectUri = requestedRedirectUri ?? defaultOAuthRedirectUri(request);

    let url: URL;

    try {
      url = new URL(redirectUri);
    } catch {
      throw new Cp2Error(400, "redirect_uri_invalid", "OAuth redirect URI is invalid.");
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.pathname !== providerConfig.callbackPath ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      !oauthAllowedRedirectOrigins.has(url.origin)
    ) {
      throw new Cp2Error(400, "redirect_uri_invalid", "OAuth redirect URI is not allowed.");
    }

    return url.toString();
  }

  async function requestOtpForBody(body: OtpRequestBody) {
    const channel = parseAuthChannel(body.method ?? body.channel);
    const destination = parseString(body.contact ?? body.destination, "contact");

    if (channel === "phone") {
      throw new Cp2Error(403, "phone_pin_only", "Phone accounts use PIN-only signup and login.");
    }
    parseOtpDeliveryChannel(body.deliveryChannel, channel);
    const purpose = parseOtpPurpose(body.purpose);

    const otp = store.requestOtp({ channel, destination, purpose });

    if (channel === "email") {
      await emailProvider.sendOtp({
        challengeId: otp.challengeId,
        code: otp.devOtp,
        expiresAt: otp.expiresAt,
        to: otp.destination
      });

      if (emailProvider.exposesDevOtp) {
        return otp;
      }

      return {
        challengeId: otp.challengeId,
        destination: otp.destination,
        expiresAt: otp.expiresAt
      };
    }

    return otp;
  }

  async function verifyOtpForBody(body: OtpVerifyBody) {
    if (body.method !== undefined && parseAuthChannel(body.method) === "phone") {
      throw new Cp2Error(403, "phone_pin_only", "Phone accounts use PIN-only signup and login.");
    }
    const challenge =
      body.challengeId === undefined
        ? store.getOtpChallengeDeliveryByContact({
            channel: parseAuthChannel(body.method),
            destination: parseString(body.contact, "contact")
          })
        : store.getOtpChallengeDelivery(parseString(body.challengeId, "challengeId"));

    if (challenge.channel === "phone") {
      throw new Cp2Error(403, "phone_pin_only", "Phone accounts use PIN-only signup and login.");
    }

    const code = parseString(body.otp ?? body.code, "otp");
    return store.verifyOtp({ challengeId: challenge.challengeId, code });
  }

  function enabledAuthProviders() {
    return {
      providers: listOAuthProviders().filter(
        (provider) =>
          provider.enabled !== false && provider.implemented !== false && provider.configured
      )
    };
  }

  function startOAuthSession(
    request: FastifyRequest,
    input: { provider?: unknown; redirectUri?: string | undefined }
  ) {
    const provider = parseOAuthProvider(input.provider);
    const providerConfig = getOAuthProviderConfig(provider);

    if (!providerConfig.enabled) {
      throw new Cp2Error(403, "oauth_provider_disabled", "Social login is disabled.");
    }

    if (!providerConfig.implemented) {
      throw new Cp2Error(
        503,
        "oauth_provider_unavailable",
        `${providerConfig.displayName} sign-in is unavailable.`
      );
    }

    if (!isOAuthProviderConfigured(providerConfig)) {
      throw new Cp2Error(
        503,
        "oauth_provider_unconfigured",
        `${providerConfig.displayName} sign-in is not configured.`
      );
    }

    const redirectUri = oauthRedirectUriForRequest(
      request,
      providerConfig,
      parseOptionalString(input.redirectUri)
    );
    const startPayload = createOAuthStartPayload({
      provider: providerConfig,
      redirectUri
    });
    return store.beginOAuthSession({
      accountSessionId: readSessionCookie(request.headers.cookie),
      authorizationUrl: startPayload.authorizationUrl,
      codeChallenge: startPayload.codeChallenge,
      codeVerifier: startPayload.codeVerifier,
      csrfToken: startPayload.csrfToken,
      provider,
      redirectUri: startPayload.redirectUri,
      state: startPayload.state
    });
  }

  async function completeOAuthSession(input: {
    provider: unknown;
    state: unknown;
    csrfToken: unknown;
    code?: unknown;
  }) {
    const provider = parseOAuthProvider(input.provider);
    const state = parseString(input.state, "state");
    const csrfToken = parseString(input.csrfToken, "csrfToken");
    const providerConfig = getOAuthProviderConfig(provider);

    if (!providerConfig.enabled) {
      throw new Cp2Error(403, "oauth_provider_disabled", "Social login is disabled.");
    }

    if (!providerConfig.implemented) {
      throw new Cp2Error(
        503,
        "oauth_provider_unavailable",
        `${providerConfig.displayName} sign-in is unavailable.`
      );
    }

    const exchangeData = store.getOAuthExchangeData({
      provider,
      state,
      csrfToken
    });
    const tokens = await exchangeOAuthCode({
      provider: providerConfig,
      code: parseString(input.code, "code"),
      codeVerifier: exchangeData.codeVerifier,
      redirectUri: exchangeData.redirectUri
    });
    const profile = await fetchOAuthProfile({ provider: providerConfig, tokens });
    return store.completeOAuthCallback({
      provider,
      state,
      csrfToken,
      profile,
      tokens
    });
  }

  function readIdentifier(body: IdentifierBody): { channel: AuthChannel; value: string } {
    const channel = parseAuthChannel(body.type);
    const identifier = parseString(body.identifier, "identifier");
    if (channel === "email") return { channel, value: identifier };
    try {
      const phone =
        body.country === undefined
          ? normalizeInternationalOwnerPhoneNumber(identifier)
          : normalizeOwnerPhoneNumber(identifier, parseString(body.country, "country"));
      return { channel, value: phone.e164 };
    } catch {
      throw new Cp2Error(400, "INVALID_PHONE_NUMBER", "Enter a valid phone number.");
    }
  }

  function normalizeAuthPhone(rawPhone: string, country?: string): string {
    try {
      return country === undefined
        ? normalizeInternationalOwnerPhoneNumber(rawPhone).e164
        : normalizeOwnerPhoneNumber(rawPhone, country).e164;
    } catch {
      throw new Cp2Error(400, "INVALID_PHONE_NUMBER", "Enter a valid phone number.");
    }
  }

  app.post("/auth/identify", async (request: FastifyRequest<{ Body: IdentifierBody }>, reply) => {
    try {
      readIdentifier(request.body);
      return reply.code(410).send({
        code: "auth_method_discovery_replaced",
        message: "Use the enumeration-safe login method endpoint."
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/login/methods",
    async (request: FastifyRequest<{ Body: IdentifierBody }>, reply) => {
      try {
        // Validate and normalize the identifier, but deliberately return the same capabilities
        // for known and unknown accounts to avoid an account-enumeration oracle.
        readIdentifier(request.body);
        return {
          preferred: "passkey",
          passkeyAvailable: authRuntime.passkeysEnabled,
          passwordFallback: authRuntime.passwordFallbackEnabled,
          recoveryAvailable: true,
          smsLogin: false
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/signup/start",
    async (request: FastifyRequest<{ Body: IdentifierBody }>, reply) => {
      try {
        enforceAuthIpRate(request, "signup_start", 10);
        const identifier = readIdentifier({ ...request.body, type: "phone" });
        if (
          store.identifyAccount({ channel: "phone", identifier: identifier.value }).next === "login"
        ) {
          throw new Cp2Error(409, "account_exists", "Continue to sign in.");
        }
        const transaction = store.beginPhoneSignup({
          phoneE164: identifier.value
        });
        return {
          ...transaction,
          verificationRequired: false
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/signup/complete",
    async (
      request: FastifyRequest<{
        Body: {
          transactionId?: string;
          displayName?: string;
          password?: string;
          passwordConfirmation?: string;
          email?: string;
          termsAccepted?: boolean;
          privacyAccepted?: boolean;
        };
      }>,
      reply
    ) => {
      try {
        const password = parseOptionalString(request.body.password);
        const passwordConfirmation = parseOptionalString(request.body.passwordConfirmation);
        if (password !== passwordConfirmation)
          throw new Cp2Error(400, "password_confirmation_invalid", "Passwords do not match.");
        if (password !== undefined) {
          requireAuthFeature(
            authRuntime.passwordFallbackEnabled,
            "password_fallback_disabled",
            "Password fallback is disabled."
          );
        }
        const result = store.completePhoneSignup({
          transactionId: parseString(request.body.transactionId, "transactionId"),
          displayName: parseString(request.body.displayName, "displayName"),
          ...(password === undefined ? {} : { password }),
          ...(request.body.email === undefined ? {} : { email: request.body.email }),
          termsAccepted: request.body.termsAccepted === true,
          privacyAccepted: request.body.privacyAccepted === true
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/email/verification/start", async (request, reply) => {
    try {
      const identity = store.getPendingEmailIdentity({
        sessionId: readSessionCookie(request.headers.cookie)
      });
      const otp = store.requestOtp({
        channel: "email",
        destination: identity.normalizedValue,
        purpose: "signup"
      });
      await emailProvider.sendOtp({
        challengeId: otp.challengeId,
        code: otp.devOtp,
        expiresAt: otp.expiresAt,
        to: otp.destination
      });
      return {
        challengeId: otp.challengeId,
        expiresAt: otp.expiresAt,
        ...(emailProvider.exposesDevOtp ? { developmentCode: otp.devOtp } : {})
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/identity/email/start",
    async (request: FastifyRequest<{ Body: { email?: string } }>, reply) => {
      try {
        enforceAuthIpRate(request, "identity_email_start", 10);
        const upgrade = store.beginEmailIdentityUpgrade({
          sessionId: readSessionCookie(request.headers.cookie),
          email: parseString(request.body.email, "email")
        });
        const otp = store.requestOtp({
          channel: "email",
          destination: upgrade.kind === "link" ? upgrade.identity.normalizedValue : upgrade.email,
          purpose: upgrade.kind === "merge" ? "recovery" : "signup"
        });
        if (upgrade.kind === "merge") {
          store.beginEmailIdentityMerge({
            sessionId: readSessionCookie(request.headers.cookie),
            email: upgrade.email,
            targetAccountId: upgrade.targetAccountId,
            challengeId: otp.challengeId
          });
        }
        await emailProvider.sendOtp({
          challengeId: otp.challengeId,
          code: otp.devOtp,
          expiresAt: otp.expiresAt,
          to: otp.destination
        });
        return {
          challengeId: otp.challengeId,
          expiresAt: otp.expiresAt,
          mergeRequired: upgrade.kind === "merge",
          ...(emailProvider.exposesDevOtp ? { developmentCode: otp.devOtp } : {})
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/email/verification/verify",
    async (request: FastifyRequest<{ Body: { challengeId?: string; code?: string } }>, reply) => {
      try {
        return store.verifyPendingEmail({
          sessionId: readSessionCookie(request.headers.cookie),
          challengeId: parseString(request.body.challengeId, "challengeId"),
          code: parseString(request.body.code, "code")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/identity/email/verify",
    async (request: FastifyRequest<{ Body: { challengeId?: string; code?: string } }>, reply) => {
      try {
        return store.verifyPendingEmail({
          sessionId: readSessionCookie(request.headers.cookie),
          challengeId: parseString(request.body.challengeId, "challengeId"),
          code: parseString(request.body.code, "code")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/identity/merge/pin",
    async (
      request: FastifyRequest<{
        Body: { method?: string; contact?: string; pin?: string };
      }>,
      reply
    ) => {
      try {
        enforceAuthIpRate(request, "identity_merge_pin", 10);
        const result = store.mergeCurrentDeviceAccountWithPin({
          sessionId: readSessionCookie(request.headers.cookie),
          channel: parseAuthChannel(request.body.method ?? "phone"),
          destination: parseString(request.body.contact, "contact"),
          pin: parseString(request.body.pin, "pin")
        });
        const { refreshToken, ...session } = result;
        store.prepareDeviceSession(session.session.id, readDeviceSessionMetadata(request));
        reply.header("set-cookie", [
          serializeSessionCookie(session.session.id),
          serializeRefreshCookie(refreshToken)
        ]);
        return session;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/identity/email/merge/verify",
    async (request: FastifyRequest<{ Body: { challengeId?: string; code?: string } }>, reply) => {
      try {
        const result = store.verifyEmailIdentityMerge({
          sessionId: readSessionCookie(request.headers.cookie),
          challengeId: parseString(request.body.challengeId, "challengeId"),
          code: parseString(request.body.code, "code")
        });
        const { refreshToken, ...session } = result;
        store.prepareDeviceSession(session.session.id, readDeviceSessionMetadata(request));
        reply.header("set-cookie", [
          serializeSessionCookie(session.session.id),
          serializeRefreshCookie(refreshToken)
        ]);
        return session;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/login/password",
    async (request: FastifyRequest<{ Body: IdentifierBody & { password?: string } }>, reply) => {
      try {
        requireAuthFeature(
          authRuntime.passwordFallbackEnabled,
          "password_fallback_disabled",
          "Password fallback is disabled."
        );
        enforceAuthIpRate(request, "password_login", 30);
        const identifier = readIdentifier(request.body);
        const result = store.loginWithPassword({
          channel: identifier.channel,
          identifier: identifier.value,
          password: parseString(request.body.password, "password")
        });
        if (result.mfaRequired) return reply.code(202).send(result);
        setAuthSessionCookies(reply, request, store, result.session.session.id);
        return result.session;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/mfa/totp/setup", async (request, reply) => {
    try {
      return store.setupTotp({ sessionId: readSessionCookie(request.headers.cookie) });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/auth/mfa/factors", async (request, reply) => {
    try {
      return {
        factors: store.listMfaFactors({ sessionId: readSessionCookie(request.headers.cookie) })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/mfa/totp/confirm",
    async (request: FastifyRequest<{ Body: { factorId?: string; code?: string } }>, reply) => {
      try {
        return store.confirmTotp({
          sessionId: readSessionCookie(request.headers.cookie),
          factorId: parseString(request.body.factorId, "factorId"),
          code: parseString(request.body.code, "code")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/mfa/challenge",
    async (request: FastifyRequest<{ Body: { transactionId?: string } }>, reply) => {
      try {
        const transaction = store.getAuthTransaction(
          parseString(request.body.transactionId, "transactionId"),
          "login_mfa"
        );
        return {
          transactionId: transaction.id,
          factors: ["totp", "recovery_code"],
          expiresAt: transaction.expiresAt
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/mfa/verify",
    async (
      request: FastifyRequest<{ Body: { transactionId?: string; factor?: string; code?: string } }>,
      reply
    ) => {
      try {
        const factor = parseString(request.body.factor, "factor");
        if (factor !== "totp" && factor !== "recovery_code")
          throw new Cp2Error(400, "mfa_factor_invalid", "MFA factor is invalid.");
        const result = store.verifyMfa({
          transactionId: parseString(request.body.transactionId, "transactionId"),
          factor,
          code: parseString(request.body.code, "code")
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/mfa/recovery-codes/regenerate", async (request, reply) => {
    try {
      return store.regenerateMfaRecoveryCodes({
        sessionId: readSessionCookie(request.headers.cookie)
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.delete(
    "/auth/mfa/factors/:factorId",
    async (
      request: FastifyRequest<{ Params: { factorId: string }; Body: { code?: string } }>,
      reply
    ) => {
      try {
        return store.disableMfaFactor({
          sessionId: readSessionCookie(request.headers.cookie),
          factorId: parseString(request.params.factorId, "factorId"),
          code: parseString(request.body?.code, "code")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/recovery/start",
    async (request: FastifyRequest<{ Body: IdentifierBody }>, reply) => {
      try {
        enforceAuthIpRate(request, "recovery_challenge", 10);
        const identifier = readIdentifier(request.body);
        if (identifier.channel === "phone") {
          throw new Cp2Error(
            400,
            "phone_recovery_unavailable",
            "Phone and SMS recovery are unavailable. Use a passkey, password, or linked verified email."
          );
        }
        const otp = store.requestOtp({
          channel: "email",
          destination: identifier.value,
          purpose: "recovery"
        });
        const transaction = store.beginRecovery({
          channel: "email",
          identifier: identifier.value,
          providerChallengeId: otp.challengeId,
          expiresAt: otp.expiresAt
        });
        if (transaction.accountFound)
          await emailProvider.sendOtp({
            challengeId: otp.challengeId,
            code: otp.devOtp,
            expiresAt: otp.expiresAt,
            to: otp.destination
          });
        return {
          message: "If an account matches those details, recovery instructions have been sent.",
          transactionId: transaction.transactionId,
          ...(emailProvider.exposesDevOtp ? { developmentCode: otp.devOtp } : {})
        };
      } catch (error) {
        if (error instanceof Cp2Error) return sendCp2Error(reply, error);
        return sendCp2Error(
          reply,
          new Cp2Error(503, "recovery_unavailable", "Account recovery is temporarily unavailable.")
        );
      }
    }
  );

  app.post(
    "/auth/recovery/verify",
    async (request: FastifyRequest<{ Body: { transactionId?: string; code?: string } }>, reply) => {
      try {
        const transactionId = parseString(request.body.transactionId, "transactionId");
        const transaction = store.getAuthTransaction(transactionId, "recovery");
        const code = parseString(request.body.code, "code");
        if (transaction.identifierType !== "email" || transaction.providerChallengeId === null)
          throw new Cp2Error(401, "recovery_verification_invalid", "Recovery verification failed.");
        return store.verifyEmailRecovery({
          transactionId,
          challengeId: transaction.providerChallengeId,
          code
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/recovery/reset-password",
    async (
      request: FastifyRequest<{
        Body: {
          transactionId?: string;
          password?: string;
          passwordConfirmation?: string;
          mfaCode?: string;
        };
      }>,
      reply
    ) => {
      try {
        requireAuthFeature(
          authRuntime.passwordFallbackEnabled,
          "password_fallback_disabled",
          "Password fallback is disabled."
        );
        const password = parseString(request.body.password, "password");
        if (password !== request.body.passwordConfirmation)
          throw new Cp2Error(400, "password_confirmation_invalid", "Passwords do not match.");
        const result = store.resetRecoveredPassword({
          transactionId: parseString(request.body.transactionId, "transactionId"),
          password,
          ...(request.body.mfaCode === undefined ? {} : { mfaCode: request.body.mfaCode })
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/password/change",
    async (
      request: FastifyRequest<{
        Body: {
          currentPassword?: string;
          password?: string;
          passwordConfirmation?: string;
          mfaCode?: string;
          revokeOtherSessions?: boolean;
        };
      }>,
      reply
    ) => {
      try {
        requireAuthFeature(
          authRuntime.passwordFallbackEnabled,
          "password_fallback_disabled",
          "Password fallback is disabled."
        );
        enforceAuthIpRate(request, "password_change", 10);
        const password = parseString(request.body.password, "password");
        if (password !== request.body.passwordConfirmation)
          throw new Cp2Error(400, "password_confirmation_invalid", "Passwords do not match.");
        return store.changePassword({
          sessionId: readSessionCookie(request.headers.cookie),
          currentPassword: parseString(request.body.currentPassword, "currentPassword"),
          password,
          ...(request.body.mfaCode === undefined ? {} : { mfaCode: request.body.mfaCode }),
          ...(request.body.revokeOtherSessions === undefined
            ? {}
            : { revokeOtherSessions: request.body.revokeOtherSessions })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/otp/request",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody(request.body);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/otp/request",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody(request.body);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/email/request-otp",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody({ ...request.body, method: "email" });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/email/request-otp",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody({ ...request.body, method: "email" });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/otp/verify", async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
    try {
      const result = await verifyOtpForBody(request.body);
      setAuthSessionCookies(reply, request, store, result.session.id);
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/api/auth/otp/verify",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody(request.body);
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/email/verify-otp",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody({ ...request.body, method: "email" });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/email/verify-otp",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody({ ...request.body, method: "email" });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  registerPasskeysRoutes(app, store, authRuntime);

  app.get("/auth/oauth/providers", async () => ({
    providers: listOAuthProviders()
  }));

  app.get("/api/auth/oauth/providers", async () => ({
    providers: listOAuthProviders()
  }));

  app.get("/auth/providers", async () => enabledAuthProviders());
  app.get("/api/auth/providers", async () => enabledAuthProviders());

  app.post(
    "/auth/oauth/start",
    async (request: FastifyRequest<{ Body: OAuthStartBody }>, reply) => {
      try {
        return startOAuthSession(request, request.body);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/oauth/start",
    async (request: FastifyRequest<{ Body: OAuthStartBody }>, reply) => {
      try {
        return startOAuthSession(request, request.body);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/auth/oauth/:provider/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Querystring: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.query.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/api/auth/oauth/:provider/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Querystring: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.query.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/oauth/callback",
    async (request: FastifyRequest<{ Body: OAuthCallbackBody }>, reply) => {
      try {
        const result = await completeOAuthSession({
          provider: request.body.provider,
          state: request.body.state,
          csrfToken: request.body.csrfToken,
          code: request.body.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/oauth/callback",
    async (request: FastifyRequest<{ Body: OAuthCallbackBody }>, reply) => {
      try {
        const result = await completeOAuthSession({
          provider: request.body.provider,
          state: request.body.state,
          csrfToken: request.body.csrfToken,
          code: request.body.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/auth/oauth/:provider/callback",
    async (
      request: FastifyRequest<{ Params: OAuthCallbackParams; Querystring: OAuthCallbackQuery }>,
      reply
    ) => {
      try {
        if (request.query.error !== undefined) {
          throw new Cp2Error(401, "oauth_provider_error", request.query.error);
        }

        if (request.query.csrfToken === undefined) {
          const relayUrl = new URL(
            oauthRedirectUriForRequest(
              request,
              getOAuthProviderConfig(parseOAuthProvider(request.params.provider))
            )
          );
          relayUrl.searchParams.set("provider", request.params.provider);
          relayUrl.searchParams.set("state", parseString(request.query.state, "state"));
          relayUrl.searchParams.set("code", parseString(request.query.code, "code"));
          return reply.redirect(relayUrl.toString());
        }

        const result = await completeOAuthSession({
          provider: request.params.provider,
          state: request.query.state,
          csrfToken: request.query.csrfToken,
          code: request.query.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/api/auth/oauth/:provider/callback",
    async (
      request: FastifyRequest<{ Params: OAuthCallbackParams; Querystring: OAuthCallbackQuery }>,
      reply
    ) => {
      try {
        if (request.query.error !== undefined) {
          throw new Cp2Error(401, "oauth_provider_error", request.query.error);
        }

        if (request.query.csrfToken === undefined) {
          const relayUrl = new URL(
            oauthRedirectUriForRequest(
              request,
              getOAuthProviderConfig(parseOAuthProvider(request.params.provider))
            )
          );
          relayUrl.searchParams.set("provider", request.params.provider);
          relayUrl.searchParams.set("state", parseString(request.query.state, "state"));
          relayUrl.searchParams.set("code", parseString(request.query.code, "code"));
          return reply.redirect(relayUrl.toString());
        }

        const result = await completeOAuthSession({
          provider: request.params.provider,
          state: request.query.state,
          csrfToken: request.query.csrfToken,
          code: request.query.code
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/auth/accounts", async (request, reply) => {
    try {
      return {
        accounts: store.listLoginAccounts({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/api/auth/accounts", async (request, reply) => {
    try {
      return {
        accounts: store.listLoginAccounts({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/accounts/:provider/link/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Body: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.body?.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/accounts/:provider/link/start",
    async (
      request: FastifyRequest<{ Params: OAuthStartParams; Body: { redirectUri?: string } }>,
      reply
    ) => {
      try {
        return startOAuthSession(request, {
          provider: request.params.provider,
          redirectUri: request.body?.redirectUri
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/auth/accounts/:identityId/disconnect",
    async (request: FastifyRequest<{ Params: AuthIdentityParams }>, reply) => {
      try {
        return store.disconnectLoginAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          identityId: request.params.identityId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/api/auth/accounts/:identityId/disconnect",
    async (request: FastifyRequest<{ Params: AuthIdentityParams }>, reply) => {
      try {
        return store.disconnectLoginAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          identityId: request.params.identityId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/social/login", async (_request, reply) =>
    sendCp2Error(reply, new Cp2Error(403, "social_login_disabled", "Social login is disabled."))
  );

  app.post("/auth/pin/setup", async (request: FastifyRequest<{ Body: PinBody }>, reply) => {
    try {
      const pin = parseString(request.body.pin, "pin");
      return store.setAccountPin({
        sessionId: readSessionCookie(request.headers.cookie),
        pin
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/continue",
    async (
      request: FastifyRequest<{ Body: { devicePublicKeyJwk?: unknown } | undefined }>,
      reply
    ) => {
      try {
        enforceAuthIpRate(request, "device_continue", 10);
        const result = store.continueWithDevice({
          sessionId: readSessionCookie(request.headers.cookie),
          idempotencyKey: readHeader(request, "idempotency-key"),
          devicePublicKeyJwk: request.body?.devicePublicKeyJwk
        });
        const { refreshToken, ...session } = result;
        if (refreshToken !== null) {
          store.prepareDeviceSession(session.session.id, readDeviceSessionMetadata(request));
          reply.header("set-cookie", [
            serializeSessionCookie(session.session.id),
            serializeRefreshCookie(refreshToken)
          ]);
        }
        request.log.info(
          {
            event: session.isNewAccount
              ? "auth.device_account_created"
              : "auth.device_account_restored",
            accountId: session.account.id,
            sessionId: session.session.id,
            requestCorrelationId: request.id
          },
          "One-tap Soko access completed."
        );
        return session;
      } catch (error) {
        request.log.warn(
          {
            event: "auth.device_continue_failed",
            code: error instanceof Cp2Error ? error.code : "device_continue_failed",
            requestCorrelationId: request.id
          },
          "One-tap Soko access failed."
        );
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/device/recover",
    async (
      request: FastifyRequest<{
        Body: { credentialId?: string; nonce?: string; issuedAt?: number; signature?: string };
      }>,
      reply
    ) => {
      try {
        enforceAuthIpRate(request, "device_recover", 10);
        const result = store.recoverWithDeviceCredential({
          credentialId: parseString(request.body.credentialId, "credentialId"),
          nonce: parseString(request.body.nonce, "nonce"),
          issuedAt: request.body.issuedAt ?? Number.NaN,
          signature: parseString(request.body.signature, "signature")
        });
        const { refreshToken, ...session } = result;
        store.prepareDeviceSession(session.session.id, readDeviceSessionMetadata(request));
        reply.header("set-cookie", [
          serializeSessionCookie(session.session.id),
          serializeRefreshCookie(refreshToken)
        ]);
        request.log.info(
          {
            event: "auth.device_recovered",
            accountId: session.account.id,
            sessionId: session.session.id,
            requestCorrelationId: request.id
          },
          "Device-bound Soko account recovered."
        );
        return session;
      } catch (error) {
        request.log.warn(
          {
            event: "auth.device_recovery_failed",
            code: error instanceof Cp2Error ? error.code : "device_recovery_failed",
            requestCorrelationId: request.id
          },
          "Device-bound Soko account recovery failed."
        );
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/pin/signup", async (request: FastifyRequest<{ Body: PinLoginBody }>, reply) => {
    try {
      enforceAuthIpRate(request, "pin_signup", 10);
      const channel = parseAuthChannel(request.body.method ?? request.body.channel ?? "phone");

      if (channel !== "phone") {
        throw new Cp2Error(400, "phone_pin_signup_only", "PIN signup requires a phone number.");
      }

      const rawDestination = parseString(
        request.body.contact ?? request.body.destination,
        "contact"
      );
      const destination = normalizeAuthPhone(
        rawDestination,
        request.body.country === undefined
          ? undefined
          : parseString(request.body.country, "country")
      );
      const result = store.signupWithPhonePin({
        destination,
        pin: parseString(request.body.pin, "pin")
      });
      setAuthSessionCookies(reply, request, store, result.session.id);
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  // Single phone + PIN entry point: creates the account on first use, signs in on return
  // visits, and tells an existing passkey/password account to use that method instead of
  // silently repurposing whatever 4 digits were typed as a new credential.
  app.post("/auth/pin/continue", async (request: FastifyRequest<{ Body: PinLoginBody }>, reply) => {
    try {
      enforceAuthIpRate(request, "pin_continue", 10);
      const channel = parseAuthChannel(request.body.method ?? request.body.channel ?? "phone");
      const rawDestination = parseString(
        request.body.contact ?? request.body.destination,
        "contact"
      );
      const destination =
        channel === "phone"
          ? normalizeAuthPhone(
              rawDestination,
              request.body.country === undefined
                ? undefined
                : parseString(request.body.country, "country")
            )
          : rawDestination;
      const result = store.continueWithChannelPin({
        channel,
        destination,
        pin: parseString(request.body.pin, "pin")
      });
      setAuthSessionCookies(reply, request, store, result.session.id);
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  // Lets a store owner sign in with their store's Soko Global Shop ID instead of their own
  // phone/email - resolves the ID to the owning account and runs the same PIN check as any
  // other PIN login. Login only: a Soko ID cannot be used to create a new account.
  app.post(
    "/auth/pin/store-login",
    async (request: FastifyRequest<{ Body: StoreLoginBody }>, reply) => {
      try {
        enforceAuthIpRate(request, "store_login", 10);
        const result = store.loginWithSokoIdPin({
          sokoId: parseString(request.body.sokoId, "sokoId"),
          pin: parseString(request.body.pin, "pin")
        });
        setAuthSessionCookies(reply, request, store, result.session.id);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/auth/pin/status", async (request, reply) => {
    try {
      return store.getAccountPinStatus({
        sessionId: readSessionCookie(request.headers.cookie)
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post("/auth/pin/verify", async (request: FastifyRequest<{ Body: PinBody }>, reply) => {
    try {
      const pin = parseString(request.body.pin, "pin");
      return store.verifyAccountPin({
        sessionId: readSessionCookie(request.headers.cookie),
        pin
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post("/auth/pin/login", async (request: FastifyRequest<{ Body: PinLoginBody }>, reply) => {
    try {
      enforceAuthIpRate(request, "pin_login", 30);
      const channel = parseAuthChannel(request.body.method ?? request.body.channel);
      const rawDestination = parseString(
        request.body.contact ?? request.body.destination,
        "contact"
      );
      const destination =
        channel !== "phone"
          ? rawDestination
          : normalizeAuthPhone(
              rawDestination,
              request.body.country === undefined
                ? undefined
                : parseString(request.body.country, "country")
            );
      const result = store.loginWithAccountPin({
        channel,
        destination,
        pin: parseString(request.body.pin, "pin")
      });
      request.log.info(
        {
          event: "auth.pin_verified",
          accountId: result.account.id,
          requestCorrelationId: request.id
        },
        "Owner PIN verified."
      );
      request.log.info(
        {
          event: "auth.session_created",
          accountId: result.account.id,
          sessionId: result.session.id,
          requestCorrelationId: request.id
        },
        "Owner session created."
      );
      setAuthSessionCookies(reply, request, store, result.session.id);
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post("/auth/pin/recover", async (request: FastifyRequest<{ Body: PinBody }>, reply) => {
    try {
      const pin = parseString(request.body.pin, "pin");
      return store.recoverAccountPin({
        sessionId: readSessionCookie(request.headers.cookie),
        pin
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/session", async (request, reply) => {
    const session = store.getSession(readSessionCookie(request.headers.cookie));

    if (session === null) {
      return reply.code(401).send({
        code: "auth_required",
        message: "Authentication is required."
      });
    }

    request.log.info(
      {
        event: "auth.authenticated_user_loaded",
        accountId: session.account.id,
        sessionId: session.session.id,
        requestCorrelationId: request.id
      },
      "Authenticated owner session loaded."
    );
    return session;
  });

  app.get("/auth/bootstrap", async (request, reply) => {
    const session = store.getSession(readSessionCookie(request.headers.cookie));
    if (session === null) {
      return reply.code(401).send({
        code: "auth_session_expired",
        message: "The access session must be refreshed."
      });
    }
    const deviceSession = store
      .listDeviceSessions(session.session.id)
      .find((candidate) => candidate.current);
    if (deviceSession === undefined) {
      return reply.code(401).send({
        code: "auth_session_expired",
        message: "The device session is no longer active."
      });
    }
    return { authenticated: true, ...session, deviceSession };
  });

  // "/session/refresh" is a legacy alias kept for existing clients. Fastify's shorthand route
  // typings do not accept an array of paths, so the two registrations below share this one
  // handler function instead - there is exactly one implementation, so they cannot silently
  // drift out of sync again.
  async function handleSessionRefresh(request: FastifyRequest, reply: FastifyReply) {
    try {
      const refreshed = store.refreshSessionCredential({
        refreshToken: readRefreshCookie(request.headers.cookie),
        metadata: readDeviceSessionMetadata(request)
      });
      reply.header("set-cookie", [
        serializeSessionCookie(refreshed.session.id),
        serializeRefreshCookie(refreshed.refreshToken)
      ]);
      return {
        authenticated: true,
        account: refreshed.account,
        user: refreshed.user,
        session: refreshed.session,
        deviceSession: refreshed.deviceSession
      };
    } catch (error) {
      if (error instanceof Cp2Error && error.statusCode === 401) {
        reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
        // Classified for operators without exposing anything beyond the same code already
        // returned to the client (never the token/cookie itself) - see auth-runtime-config.md
        // and the refresh-reuse grace period in Cp2Store.refreshSessionCredential.
        request.log.warn(
          { event: "auth.session_refresh_failed", code: error.code, requestId: request.id },
          "Session refresh rejected."
        );
      }
      return sendCp2Error(reply, error);
    }
  }
  app.post("/auth/session/refresh", handleSessionRefresh);
  app.post("/session/refresh", handleSessionRefresh);

  app.get("/auth/sessions", async (request, reply) => {
    try {
      return { sessions: store.listDeviceSessions(readSessionCookie(request.headers.cookie)) };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/sessions", async (request, reply) => {
    try {
      return { sessions: store.listDeviceSessions(readSessionCookie(request.headers.cookie)) };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.delete(
    "/auth/sessions/:sessionId",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
      try {
        const revoked = store.revokeDeviceSession({
          sessionId: readSessionCookie(request.headers.cookie),
          targetSessionId: parseString(request.params.sessionId, "sessionId")
        });
        if (revoked.current) {
          reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
        }
        return revoked;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/sessions/:sessionId",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
      try {
        const revoked = store.revokeDeviceSession({
          sessionId: readSessionCookie(request.headers.cookie),
          targetSessionId: parseString(request.params.sessionId, "sessionId")
        });
        if (revoked.current)
          reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
        return revoked;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/auth/session", async (request, reply) => {
    const session = store.getSession(readSessionCookie(request.headers.cookie));

    if (session === null) {
      return reply.code(401).send({
        code: "auth_required",
        message: "Authentication is required."
      });
    }

    return session;
  });

  app.get("/api/auth/session", async (request, reply) => {
    const session = store.getSession(readSessionCookie(request.headers.cookie));

    if (session === null) {
      return reply.code(401).send({
        code: "auth_required",
        message: "Authentication is required."
      });
    }

    return session;
  });

  app.get("/v1/session/context", async (request, reply) => {
    try {
      return store.getSokoSessionContext({
        sessionId: readSessionCookie(request.headers.cookie)
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.patch(
    "/v1/session/context",
    async (request: FastifyRequest<{ Body: SessionContextBody }>, reply) => {
      try {
        const expectedSessionVersion = parseOptionalNonNegativeInteger(
          request.body.expectedSessionVersion,
          "expectedSessionVersion"
        );
        const conversationId = parseOptionalString(request.body.conversationId);
        const mode = parseOptionalSokoMode(request.body.mode);
        const activeShopId = parseOptionalNullableString(request.body.activeShopId);
        const activeSurface = parseOptionalSokoChatSurface(request.body.activeSurface);
        return store.updateSokoSessionContext({
          sessionId: readSessionCookie(request.headers.cookie),
          ...(mode === undefined ? {} : { mode }),
          ...(activeShopId === undefined ? {} : { activeShopId }),
          ...(activeSurface === undefined ? {} : { activeSurface }),
          ...(conversationId === undefined ? {} : { conversationId }),
          ...(expectedSessionVersion === undefined ? {} : { expectedSessionVersion })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/v1/shops", async (request, reply) => {
    try {
      return {
        shops: store.listAccountShops({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get(
    "/v1/sync/changes",
    async (request: FastifyRequest<{ Querystring: SyncPullQuery }>, reply) => {
      try {
        const cursor = parseOptionalString(request.query.cursor) ?? null;
        const limit =
          request.query.limit === undefined
            ? undefined
            : parseIntegerString(request.query.limit, "limit");
        return store.pullSyncChanges({
          sessionId: readSessionCookie(request.headers.cookie),
          cursor,
          ...(limit === undefined ? {} : { limit })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/realtime",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (origin !== undefined && !realtimeAllowedOrigins.has(origin)) {
          return reply.code(403).send({ code: "realtime_origin_forbidden" });
        }
        if (store.getSession(readSessionCookie(request.headers.cookie)) === null) {
          return reply.code(401).send({ code: "session_required" });
        }
      }
    },
    (socket, request) => {
      const sessionId = readSessionCookie(request.headers.cookie);
      const session = store.getSession(sessionId);
      if (session === null) {
        socket.close(1008, "Session required");
        return;
      }

      let unsubscribe: () => void = () => undefined;
      const closeExpiredSession = () => {
        if (store.getSession(sessionId) !== null) {
          return false;
        }
        unsubscribe();
        socket.close(1008, "Session expired");
        return true;
      };
      unsubscribe = store.subscribeSyncChanges({
        sessionId,
        listener: (event) => {
          if (!closeExpiredSession() && socket.readyState === 1) {
            socket.send(JSON.stringify(event));
          }
        }
      });
      const ready: SyncRealtimeReadyEvent = {
        type: "realtime.ready",
        protocolVersion: 1,
        accountId: session.account.id,
        serverTime: new Date().toISOString()
      };
      socket.send(JSON.stringify(ready));
      const sessionTimer = setInterval(closeExpiredSession, 30_000);
      const cleanup = () => {
        clearInterval(sessionTimer);
        unsubscribe();
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
    }
  );

  if (options.ownerNodeBroker !== undefined) {
    const ownerNodeBroker = options.ownerNodeBroker;
    app.get(
      "/v1/inference/owner-node/presence",
      async (request: FastifyRequest<{ Querystring: OwnerNodePresenceQuery }>, reply) => {
        const session = store.getSession(readSessionCookie(request.headers.cookie));
        if (session === null) {
          return reply.code(401).send({ code: "session_required" });
        }
        try {
          const tenantId = parseString(request.query.tenantId, "tenantId");
          const agentId = parseString(request.query.agentId, "agentId");
          const modelId = parseString(request.query.modelId, "modelId");
          if (
            !store
              .listAccountShops({ sessionId: session.session.id })
              .some((shop) => shop.business.id === tenantId)
          ) {
            return reply.code(403).send({ code: "inference_tenant_forbidden" });
          }
          return {
            reachable: ownerNodeBroker.isReachable({ tenantId, agentId, modelId })
          };
        } catch (error) {
          return sendCp2Error(reply, error);
        }
      }
    );

    app.get(
      "/v1/inference/owner-node",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          const origin = request.headers.origin;
          if (origin !== undefined && !realtimeAllowedOrigins.has(origin)) {
            return reply.code(403).send({ code: "inference_origin_forbidden" });
          }
          if (store.getSession(readSessionCookie(request.headers.cookie)) === null) {
            return reply.code(401).send({ code: "session_required" });
          }
        }
      },
      (socket, request) => {
        const session = store.getSession(readSessionCookie(request.headers.cookie));
        if (session === null) {
          socket.close(1008, "Session required");
          return;
        }
        let registeredNodeId: string | null = null;
        socket.on("message", (raw) => {
          try {
            const message = JSON.parse(String(raw)) as OwnerInferenceNodeMessage;
            if (message.type === "inference.node.register") {
              if (
                !store
                  .listAccountShops({ sessionId: session.session.id })
                  .some((shop) => shop.business.id === message.presence.tenantId)
              ) {
                throw new Error("Tenant access is forbidden.");
              }
              const presence = ownerNodeBroker.register({
                ...message.presence,
                userId: session.user.id,
                send: (job) => socket.send(JSON.stringify({ type: "inference.job", job }))
              });
              registeredNodeId = presence.nodeId;
              socket.send(JSON.stringify({ type: "inference.node.ready", presence }));
              return;
            }
            if (message.type === "inference.node.heartbeat") {
              ownerNodeBroker.heartbeat(message.nodeId, session.user.id);
              return;
            }
            if (message.type === "inference.job.chunk") {
              ownerNodeBroker.acceptChunk({
                nodeId: message.nodeId,
                userId: session.user.id,
                jobToken: message.jobToken,
                sequence: message.sequence,
                chunk: message.chunk
              });
            }
          } catch {
            socket.close(1008, "Invalid owner-node message");
          }
        });
        const cleanup = () => {
          if (registeredNodeId !== null) {
            try {
              ownerNodeBroker.unregister(registeredNodeId, session.user.id);
            } catch {
              // The ephemeral node may already have expired.
            }
          }
        };
        socket.once("close", cleanup);
        socket.once("error", cleanup);
      }
    );

    app.post(
      "/v1/inference/owner-node/jobs",
      async (request: FastifyRequest<{ Body: InferenceRequest }>, reply) => {
        const session = store.getSession(readSessionCookie(request.headers.cookie));
        if (session === null) {
          return reply.code(401).send({ code: "session_required" });
        }
        try {
          const inferenceRequest = parseOwnerInferenceRequest(request.body);
          if (
            !store
              .listAccountShops({ sessionId: session.session.id })
              .some((shop) => shop.business.id === inferenceRequest.tenantId)
          ) {
            return reply.code(403).send({ code: "inference_tenant_forbidden" });
          }
          const dispatched = ownerNodeBroker.dispatch(inferenceRequest);
          reply.hijack();
          reply.raw.writeHead(200, {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "x-inference-runtime": "owner-node"
          });
          for await (const chunk of dispatched.chunks) {
            reply.raw.write(`${JSON.stringify(chunk)}\n`);
          }
          reply.raw.end();
          return reply;
        } catch {
          if (!reply.sent) {
            return reply.code(503).send({
              code: "owner_node_unavailable",
              message: "The shop device is unavailable."
            });
          }
          reply.raw.end();
          return reply;
        }
      }
    );
  }

  app.get(
    "/v1/conversations",
    async (request: FastifyRequest<{ Querystring: { includeArchived?: string } }>, reply) => {
      try {
        return {
          conversations: store.listConversations({
            sessionId: readSessionCookie(request.headers.cookie),
            includeArchived: request.query.includeArchived === "true"
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/marketplace-intro",
    async (request: FastifyRequest<{ Querystring: MarketplaceIntroBody }>, reply) => {
      try {
        return store.getMarketplaceIntroState({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseNullableString(request.query.businessId)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/marketplace-intro/complete",
    async (request: FastifyRequest<{ Body: MarketplaceIntroBody }>, reply) => {
      try {
        return store.completeMarketplaceIntro({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseNullableString(request.body.businessId)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/ai-models",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return { models: store.listAiModels(request.query.search) };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/ai-models/github",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return await githubModelCatalog.searchModels(request.query.search);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/ai-models/huggingface",
    async (request: FastifyRequest<{ Querystring: AiModelSearchQuery }>, reply) => {
      try {
        return await huggingFaceModelCatalog.searchModels(request.query.search);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/models/installed",
    async (request: FastifyRequest<{ Querystring: InstalledModelQuery }>, reply) => {
      try {
        return {
          models: store.listInstalledAgentModels({
            sessionId: readSessionCookie(request.headers.cookie),
            ...(request.query.deviceId === undefined
              ? {}
              : { deviceId: parseString(request.query.deviceId, "deviceId") })
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/models/installed",
    async (request: FastifyRequest<{ Body: InstalledModelBody }>, reply) => {
      try {
        return store.registerInstalledAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          model: parseInstalledModelBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/models/:installationId/validate",
    async (
      request: FastifyRequest<{
        Params: InstalledModelParams;
        Body: InstalledModelValidationBody;
      }>,
      reply
    ) => {
      try {
        return store.validateInstalledAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          installationId: request.params.installationId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          installationStatus: parseModelInstallationStatus(request.body.installationStatus),
          compatibilityStatus: parseModelCompatibilityStatus(request.body.compatibilityStatus),
          validationError: parseNullableString(request.body.validationError)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/ai-model",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getActiveAiModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/ai-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AiModelActivationBody }>,
      reply
    ) => {
      try {
        return store.activateAiModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          modelId: parseString(request.body.modelId, "modelId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return store.getAgentModelAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.query.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/agent-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AgentModelAssignmentBody }>,
      reply
    ) => {
      try {
        return store.assignAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          installationId: parseString(request.body.installationId, "installationId"),
          preferredExecutionMode: parsePreferredExecutionMode(request.body.preferredExecutionMode),
          fallbackPolicy: parseAgentModelFallbackPolicy(request.body.fallbackPolicy),
          readinessStatus: parseAgentModelReadinessStatus(request.body.readinessStatus),
          lastSuccessfulInferenceAt: parseNullableString(request.body.lastSuccessfulInferenceAt),
          lastErrorCode: parseNullableString(request.body.lastErrorCode)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/agent-model",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return store.removeAgentModelAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.query.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/browser-inference",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return {
          assignment: store.getBrowserInferenceAssignment({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: request.params.businessId,
            deviceId: parseString(request.query.deviceId, "deviceId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/browser-inference",
    async (
      request: FastifyRequest<{
        Params: BusinessParams;
        Body: BrowserInferenceAssignmentBody;
      }>,
      reply
    ) => {
      try {
        return store.upsertBrowserInferenceAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          enabled: parseBoolean(request.body.enabled, "enabled"),
          selectedModelId: parseNullableString(request.body.selectedModelId),
          modelFamilyId: parseNullableString(request.body.modelFamilyId),
          modelRevision: parseNullableString(request.body.modelRevision),
          runtimeContract: parseBrowserRuntimeContract(request.body.runtimeContract),
          checkpointCompatibilityContract: parseBrowserCheckpointContract(
            request.body.checkpointCompatibilityContract
          ),
          deviceTier: parseBrowserDeviceTier(request.body.deviceTier),
          readinessStatus: parseAgentModelReadinessStatus(request.body.readinessStatus),
          lastSuccessfulInferenceAt: parseNullableString(request.body.lastSuccessfulInferenceAt),
          lastErrorCode: parseNullableString(request.body.lastErrorCode)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/browser-inference/executions",
    async (
      request: FastifyRequest<{
        Params: BusinessParams;
        Body: BrowserInferenceExecutionBody;
      }>,
      reply
    ) => {
      try {
        return store.recordBrowserInferenceExecution({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.body.deviceId, "deviceId"),
          modelId: parseString(request.body.modelId, "modelId"),
          successful: parseBoolean(request.body.successful, "successful"),
          errorCode: parseNullableString(request.body.errorCode),
          occurredAt: parseString(request.body.occurredAt, "occurredAt")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/browser-inference",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: AgentModelQuery }>,
      reply
    ) => {
      try {
        return store.removeBrowserInferenceAssignment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceId: parseString(request.query.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/api/agents/:agentId/model-binding",
    async (
      request: FastifyRequest<{
        Params: AgentModelBindingParams;
        Querystring: AgentModelBindingQuery;
      }>,
      reply
    ) => {
      try {
        return {
          binding: store.getActiveAgentModelBinding({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: parseString(request.query.shopId, "shopId"),
            agentId: parseString(request.params.agentId, "agentId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/api/agents/:agentId/model-binding",
    async (
      request: FastifyRequest<{
        Params: AgentModelBindingParams;
        Querystring: AgentModelBindingQuery;
      }>,
      reply
    ) => {
      const requestId = request.id;
      const shopId = parseString(request.query.shopId, "shopId");
      const agentId = parseString(request.params.agentId, "agentId");
      request.log.info(
        { event: "model.binding_removal_started", requestId, shopId, agentId },
        "Agent model binding removal started."
      );
      try {
        const result = store.removeAgentModelBinding({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: shopId,
          agentId
        });
        request.log.info(
          {
            event: "model.binding_removed",
            requestId,
            shopId,
            agentId,
            bindingId: result.removedBindingId
          },
          "Agent model binding removed."
        );
        return result;
      } catch (error) {
        request.log.warn(
          {
            event: "model.binding_removal_failed",
            requestId,
            shopId,
            agentId,
            errorCode: error instanceof Cp2Error ? error.code : "MODEL_BINDING_REMOVAL_FAILED"
          },
          "Agent model binding removal failed."
        );
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/agents/:agentId/models/:modelId/test",
    async (
      request: FastifyRequest<{
        Params: AgentModelOperationParams;
        Body: AgentModelTestBody;
      }>,
      reply
    ) => {
      const requestId = request.id;
      const shopId = parseString(request.body.shopId, "shopId");
      const agentId = parseString(request.params.agentId, "agentId");
      const modelId = parseString(request.params.modelId, "modelId");
      const executionTarget = parseModelExecutionTarget(request.body.executionTarget);
      const requestAbort = observeRequestAbort(request, reply);
      request.log.info(
        { event: "model.test_started", requestId, shopId, agentId, modelId, executionTarget },
        "Model test started."
      );
      try {
        const healthCheck = await store.testAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: shopId,
          agentId,
          modelId,
          executionTarget,
          signal: requestAbort.signal
        });
        request.log.info(
          {
            event: "model.test_succeeded",
            requestId,
            shopId,
            agentId,
            modelId: healthCheck.modelId,
            executionTarget: healthCheck.executionTarget,
            latencyMs: healthCheck.latencyMs
          },
          "Model test succeeded."
        );
        return { healthCheck };
      } catch (error) {
        request.log.warn(
          {
            event: "model.test_failed",
            requestId,
            shopId,
            agentId,
            modelId,
            executionTarget,
            errorCode: error instanceof Cp2Error ? error.code : "MODEL_TEST_FAILED"
          },
          "Model test failed."
        );
        return sendCp2Error(reply, error);
      } finally {
        requestAbort.cleanup();
      }
    }
  );

  app.post(
    "/api/agents/:agentId/models/:modelId/activate",
    async (
      request: FastifyRequest<{
        Params: AgentModelOperationParams;
        Body: AgentModelActivationBody;
      }>,
      reply
    ) => {
      const requestId = request.id;
      const shopId = parseString(request.body.shopId, "shopId");
      const agentId = parseString(request.params.agentId, "agentId");
      const modelId = parseString(request.params.modelId, "modelId");
      const executionTarget = parseModelExecutionTarget(request.body.executionTarget);
      const requestAbort = observeRequestAbort(request, reply);
      request.log.info(
        {
          event: "model.activation_started",
          requestId,
          shopId,
          agentId,
          modelId,
          executionTarget
        },
        "Model activation started."
      );
      try {
        const result = await store.activateAgentModel({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: shopId,
          agentId,
          modelId,
          executionTarget,
          executionMode: parsePreferredExecutionMode(request.body.executionMode),
          fallbackPolicy: parseAgentModelFallbackPolicy(request.body.fallbackPolicy),
          permissions: parseAgentModelBindingPermissions(request.body.permissions),
          fallbackModelId: parseNullableString(request.body.fallbackModelId),
          signal: requestAbort.signal,
          onStage: (stage, elapsedMs) => {
            request.log.info(
              {
                event: "model.activation_stage",
                requestId,
                shopId,
                agentId,
                modelId,
                executionTarget,
                stage,
                elapsedMs
              },
              "Model activation stage completed."
            );
          }
        });
        request.log.info(
          {
            event: "model.activation_succeeded",
            requestId,
            shopId,
            agentId,
            modelId: result.binding.modelId,
            bindingId: result.binding.id,
            executionTarget: result.binding.executionTarget,
            latencyMs: result.healthCheck.latencyMs
          },
          "Model activation succeeded."
        );
        return result;
      } catch (error) {
        request.log.warn(
          {
            event: "model.activation_failed",
            requestId,
            shopId,
            agentId,
            modelId,
            executionTarget,
            errorCode: error instanceof Cp2Error ? error.code : "MODEL_ACTIVATION_FAILED"
          },
          "Model activation failed."
        );
        return sendCp2Error(reply, error);
      } finally {
        requestAbort.cleanup();
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-profile",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentProfile({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/agent-profile",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: AgentProfileBody }>, reply) => {
      try {
        return store.updateAgentProfile({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          profile: parseAgentProfileBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentRuntime({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/readiness",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentRuntimeReadiness({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/versions",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listAgentRuntimeVersions({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/versions/:version/rollback",
    async (request: FastifyRequest<{ Params: RuntimeVersionParams }>, reply) => {
      try {
        return store.rollbackAgentRuntimeVersion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          version: parseIntegerString(request.params.version, "version")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/context-sources",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listAgentContextSources({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/context-sources",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AgentContextSourceBody }>,
      reply
    ) => {
      try {
        const body = parseAgentContextSourceBody(request.body);
        return store.upsertAgentContextSource({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/corrections",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listAgentOwnerCorrections({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/corrections",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AgentCorrectionBody }>,
      reply
    ) => {
      try {
        const body = parseAgentCorrectionBody(request.body);
        return store.submitAgentOwnerCorrection({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/corrections/:correctionId/disable",
    async (request: FastifyRequest<{ Params: AgentCorrectionParams }>, reply) => {
      try {
        return store.disableAgentOwnerCorrection({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          correctionId: parseString(request.params.correctionId, "correctionId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/agent-runtime/evaluations",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getAgentEvaluationSummary({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/feedback",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: AgentFeedbackBody }>, reply) => {
      try {
        const body = parseAgentFeedbackBody(request.body);
        return store.submitAgentFeedback({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/agent-runtime/recall/effectiveness",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: RecallEffectivenessBody }>,
      reply
    ) => {
      try {
        const body = parseRecallEffectivenessBody(request.body);
        return store.recordRecallEffectiveness({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/conversations",
    async (request: FastifyRequest<{ Body: CreateConversationBody }>, reply) => {
      try {
        return store.createConversation({
          sessionId: readSessionCookie(request.headers.cookie),
          kind: parseConversationKind(request.body.kind),
          activeShopId: parseNullableString(request.body.activeShopId),
          recipient: parseNullableString(request.body.recipient),
          title: parseNullableString(request.body.title)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/conversations/:conversationId",
    async (request: FastifyRequest<{ Params: ConversationParams }>, reply) => {
      try {
        return store.getConversation({
          sessionId: readSessionCookie(request.headers.cookie),
          conversationId: parseString(request.params.conversationId, "conversationId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/v1/e2ee/devices", async (request: FastifyRequest<{ Body: E2eeDeviceBody }>, reply) => {
    try {
      return store.registerE2eeDevice({
        sessionId: readSessionCookie(request.headers.cookie),
        deviceId: parseString(request.body.deviceId, "deviceId"),
        label: parseString(request.body.label, "label"),
        publicKey: parseE2eePublicKey(request.body.publicKey, "publicKey")
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/v1/e2ee/devices", async (request, reply) => {
    try {
      return {
        devices: store.listE2eeDevices({ sessionId: readSessionCookie(request.headers.cookie) })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.delete(
    "/v1/e2ee/devices/:deviceId",
    async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply) => {
      try {
        return store.revokeE2eeDevice({
          sessionId: readSessionCookie(request.headers.cookie),
          deviceId: parseString(request.params.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/conversations/:conversationId/encryption-devices",
    async (request: FastifyRequest<{ Params: ConversationParams }>, reply) => {
      try {
        return {
          devices: store.listConversationE2eeDevices({
            sessionId: readSessionCookie(request.headers.cookie),
            conversationId: parseString(request.params.conversationId, "conversationId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/v1/push/config", async () => ({
    enabled: Boolean(options.vapidPublicKey),
    publicKey: options.vapidPublicKey ?? null
  }));

  app.post(
    "/v1/push/subscriptions",
    async (request: FastifyRequest<{ Body: PushSubscriptionBody }>, reply) => {
      try {
        const keys = parseRequestBody(request.body.keys);
        return store.registerPushSubscription({
          sessionId: readSessionCookie(request.headers.cookie),
          endpoint: parseString(request.body.endpoint, "endpoint"),
          expirationTime:
            request.body.expirationTime === undefined || request.body.expirationTime === null
              ? null
              : parseNonNegativeInteger(request.body.expirationTime, "expirationTime"),
          keys: {
            auth: parseString(keys.auth, "keys.auth"),
            p256dh: parseString(keys.p256dh, "keys.p256dh")
          }
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/v1/push/subscriptions",
    async (request: FastifyRequest<{ Body: { endpoint?: string } }>, reply) => {
      try {
        return store.removePushSubscription({
          sessionId: readSessionCookie(request.headers.cookie),
          endpoint: parseString(request.body.endpoint, "endpoint")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/v1/messages", async (request: FastifyRequest<{ Body: CreateMessageBody }>, reply) => {
    try {
      const sessionId = readSessionCookie(request.headers.cookie);
      const clientTimestamp =
        request.body.clientTimestamp === undefined || request.body.clientTimestamp === null
          ? null
          : parseIsoTimestamp(request.body.clientTimestamp, "clientTimestamp");
      const queuedAt =
        request.body.queuedAt === undefined || request.body.queuedAt === null
          ? null
          : parseIsoTimestamp(request.body.queuedAt, "queuedAt");
      const selectedChannel = parseOptionalString(request.body.selectedChannel);
      if (selectedChannel !== undefined && !isMessageChannel(selectedChannel)) {
        throw new Cp2Error(400, "message_channel_invalid", "selectedChannel is invalid.");
      }
      const idempotencyKey = parseOptionalString(request.body.idempotencyKey);
      const content = parseConversationMessageContent(request.body.content);
      const messageInput = {
        sessionId,
        conversationId: parseString(request.body.conversationId, "conversationId"),
        clientMessageId: parseString(request.body.clientMessageId, "clientMessageId"),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        content,
        replyToMessageId: parseNullableString(request.body.replyToMessageId),
        forwardedFromMessageId: parseNullableString(request.body.forwardedFromMessageId),
        clientTimestamp,
        queuedAt,
        ...(selectedChannel !== undefined ? { selectedChannel } : {})
      };

      if (request.body.agent !== undefined) {
        if (request.body.author === "agent") {
          throw new Cp2Error(
            400,
            "agent_processing_invalid",
            "An agent-authored message cannot request another agent turn."
          );
        }
        const agent = parseRequestBody(request.body.agent);
        const runtime = parseRuntimeTurnBody(agent);
        const businessId = parseString(agent.businessId, "agent.businessId");
        let processed;
        try {
          processed = await store.createAgentConversationMessage({
            ...messageInput,
            businessId,
            message: runtime.message,
            ...(runtime.runtimeSessionId === undefined
              ? {}
              : { runtimeSessionId: runtime.runtimeSessionId })
          });
        } catch (error) {
          request.log.warn(
            {
              event: "model.inference_failed",
              requestId: request.id,
              shopId: businessId,
              errorCode: error instanceof Cp2Error ? error.code : "INFERENCE_FAILED"
            },
            "Agent inference failed."
          );
          throw error;
        }
        const modelPromptEvent = processed.runtime?.turn.telemetry.find(
          (event) => event.state === "model.prompt_built"
        );
        const modelTrace = processed.runtime?.turn.model;
        if (modelTrace?.bindingId !== undefined) {
          request.log.info(
            {
              event: "model.active_binding_resolved",
              requestId: request.id,
              shopId: businessId,
              bindingId: modelTrace.bindingId,
              modelId: modelTrace.modelId ?? null,
              executionTarget: modelTrace.executionTarget ?? null
            },
            "Active agent model binding resolved."
          );
          request.log.info(
            {
              event: "model.route_selected",
              requestId: request.id,
              shopId: businessId,
              bindingId: modelTrace.bindingId,
              modelId: modelTrace.modelId ?? null,
              executionTarget: modelTrace.executionTarget ?? null,
              fallbackReason: modelTrace.fallbackReason ?? null
            },
            "Agent model route selected."
          );
          request.log.info(
            {
              event:
                modelTrace.status === "available"
                  ? "model.inference_completed"
                  : "model.inference_failed",
              requestId: request.id,
              shopId: businessId,
              bindingId: modelTrace.bindingId,
              modelId: modelTrace.modelId ?? null,
              executionTarget: modelTrace.executionTarget ?? null,
              latencyMs: modelTrace.durationMs,
              errorCode: modelTrace.errorCode
            },
            modelTrace.status === "available"
              ? "Agent inference completed."
              : "Agent inference failed."
          );
        }
        request.log.info(
          {
            correlationId: processed.processing.correlationId,
            tenantId: businessId,
            conversationId: processed.message.conversationId,
            messageId: processed.message.id,
            agentId: processed.agentMessage?.authorId ?? null,
            bindingId: processed.runtime?.turn.model?.bindingId ?? null,
            modelId:
              processed.runtime?.turn.model?.modelId ??
              modelPromptEvent?.metadata.modelProfile ??
              null,
            provider: processed.runtime?.turn.model?.provider ?? null,
            executionTarget: processed.runtime?.turn.model?.executionTarget ?? null,
            fallbackUsed: processed.runtime?.turn.model?.fallbackUsed ?? false,
            fallbackReason: processed.runtime?.turn.model?.fallbackReason ?? null,
            processingStage:
              processed.processing.status === "completed"
                ? "assistant_persisted"
                : "model_processing_failed",
            normalizedErrorCode: processed.processing.errorCode,
            durationMs: processed.runtime?.turn.model?.durationMs ?? null
          },
          "Agent chat processing completed."
        );
        await store.deliverPendingMessageNotifications({ messageId: processed.message.id });
        return {
          ...processed.message,
          ...(processed.agentMessage === null ? {} : { agentMessage: processed.agentMessage }),
          runtime: processed.runtime,
          processing: processed.processing
        };
      }

      const message = store.createConversationMessage({
        ...messageInput,
        author: request.body.author === "agent" ? "agent" : "user"
      });
      await store.deliverPendingMessageNotifications({ messageId: message.id });
      return message;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get(
    "/businesses/:businessId/mailboxes/providers",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          providers: store.listConnectedMailboxProviders({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: parseString(request.params.businessId, "businessId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/mailboxes",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          mailboxes: store.listConnectedMailboxes({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: parseString(request.params.businessId, "businessId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/mailboxes/oauth/:provider/start",
    async (
      request: FastifyRequest<{
        Params: BusinessParams & ConnectedMailboxOAuthParams;
      }>,
      reply
    ) => {
      try {
        const provider = parseConnectedMailboxProvider(request.params.provider);
        const apiOrigin = new URL(defaultOAuthRedirectUri(request)).origin;
        const redirectUri = new URL(
          `/v1/mailboxes/oauth/${provider}/callback`,
          apiOrigin
        ).toString();
        const requestedOrigin = request.headers.origin;
        const returnOrigin =
          requestedOrigin !== undefined &&
          (requestedOrigin === apiOrigin || oauthAllowedRedirectOrigins.has(requestedOrigin))
            ? requestedOrigin
            : apiOrigin;
        return store.beginConnectedMailboxOAuth({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          provider,
          redirectUri,
          returnUrl: new URL("/?mailbox=connected", returnOrigin).toString()
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/mailboxes/oauth/:provider/callback",
    async (
      request: FastifyRequest<{
        Params: ConnectedMailboxOAuthParams;
        Querystring: ConnectedMailboxOAuthQuery;
      }>,
      reply
    ) => {
      try {
        if (request.query.error !== undefined) {
          throw new Cp2Error(401, "mailbox_oauth_denied", "Mailbox authorization was denied.");
        }
        const result = await store.completeConnectedMailboxOAuth({
          provider: parseConnectedMailboxProvider(request.params.provider),
          code: parseString(request.query.code, "code"),
          state: parseString(request.query.state, "state")
        });
        request.log.info(
          {
            event: "mailbox_connected",
            businessId: result.mailbox.businessId,
            mailboxId: result.mailbox.id,
            provider: result.mailbox.provider
          },
          "Connected mailbox authorization completed."
        );
        return reply.redirect(result.returnUrl);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/mailboxes/:mailboxId",
    async (
      request: FastifyRequest<{
        Params: ConnectedMailboxParams;
        Body: ConnectedMailboxUpdateBody;
      }>,
      reply
    ) => {
      try {
        return store.updateConnectedMailbox({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          mailboxId: parseString(request.params.mailboxId, "mailboxId"),
          ...(request.body.isDefault === undefined
            ? {}
            : { isDefault: parseBoolean(request.body.isDefault, "isDefault") }),
          ...(request.body.ingestUnknownSenders === undefined
            ? {}
            : {
                ingestUnknownSenders: parseBoolean(
                  request.body.ingestUnknownSenders,
                  "ingestUnknownSenders"
                )
              }),
          ...(request.body.automaticReplyEnabled === undefined
            ? {}
            : {
                automaticReplyEnabled: parseBoolean(
                  request.body.automaticReplyEnabled,
                  "automaticReplyEnabled"
                )
              }),
          ...(request.body.automaticReplyText === undefined
            ? {}
            : { automaticReplyText: parseNullableString(request.body.automaticReplyText) })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/mailboxes/:mailboxId",
    async (request: FastifyRequest<{ Params: ConnectedMailboxParams }>, reply) => {
      try {
        const mailbox = await store.disconnectConnectedMailbox({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          mailboxId: parseString(request.params.mailboxId, "mailboxId")
        });
        request.log.info(
          {
            event: "mailbox_disconnected",
            businessId: mailbox.businessId,
            mailboxId: mailbox.id,
            provider: mailbox.provider
          },
          "Connected mailbox disconnected."
        );
        return mailbox;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/mailboxes/:mailboxId/sync",
    async (
      request: FastifyRequest<{
        Params: ConnectedMailboxParams;
        Body: ConnectedMailboxSyncBody;
      }>,
      reply
    ) => {
      try {
        const synchronized = await store.syncConnectedMailbox({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          mailboxId: parseString(request.params.mailboxId, "mailboxId"),
          ...(request.body.historyDays === undefined
            ? {}
            : {
                historyDays: parseNonNegativeInteger(request.body.historyDays, "historyDays")
              })
        });
        request.log.info(
          {
            event: "mailbox_sync_completed",
            businessId: synchronized.mailbox.businessId,
            mailboxId: synchronized.mailbox.id,
            provider: synchronized.mailbox.provider,
            fetched: synchronized.fetched,
            ingested: synchronized.ingested,
            deduplicated: synchronized.deduplicated,
            filtered: synchronized.filtered
          },
          "Connected mailbox synchronization completed."
        );
        return synchronized;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/mailboxes/:mailboxId/conversations",
    async (
      request: FastifyRequest<{
        Params: ConnectedMailboxParams;
        Body: { recipientAddress?: string; displayName?: string };
      }>,
      reply
    ) => {
      try {
        return store.createConnectedEmailConversation({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          mailboxId: parseString(request.params.mailboxId, "mailboxId"),
          recipientAddress: parseString(request.body.recipientAddress, "recipientAddress"),
          ...(request.body.displayName === undefined
            ? {}
            : { displayName: parseString(request.body.displayName, "displayName") })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/v1/devices/native-sms",
    async (request: FastifyRequest<{ Body: NativeSmsDeviceBody }>, reply) => {
      try {
        return store.registerNativeSmsDevice({
          sessionId: readSessionCookie(request.headers.cookie),
          roleAvailable: parseBoolean(request.body.roleAvailable, "roleAvailable"),
          roleGranted: parseBoolean(request.body.roleGranted, "roleGranted"),
          sendPermissionGranted: parseBoolean(
            request.body.sendPermissionGranted,
            "sendPermissionGranted"
          ),
          receivePermissionGranted: parseBoolean(
            request.body.receivePermissionGranted,
            "receivePermissionGranted"
          ),
          simReady: parseBoolean(request.body.simReady, "simReady"),
          ...(request.body.subscriptionId === undefined
            ? {}
            : {
                subscriptionId:
                  request.body.subscriptionId === null
                    ? null
                    : parseNonNegativeInteger(request.body.subscriptionId, "subscriptionId")
              }),
          ...(request.body.preferred === undefined
            ? {}
            : { preferred: parseBoolean(request.body.preferred, "preferred") }),
          ...(request.body.lastErrorCode === undefined
            ? {}
            : { lastErrorCode: parseNullableString(request.body.lastErrorCode) })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/v1/devices/native-sms", async (request, reply) => {
    try {
      return {
        devices: store.listNativeSmsDevices({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/v1/devices/native-sms/businesses", async (request, reply) => {
    try {
      return {
        businesses: store.listNativeSmsBusinesses({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.delete(
    "/v1/devices/native-sms/:deviceId",
    async (request: FastifyRequest<{ Params: NativeSmsDeviceParams }>, reply) => {
      try {
        return store.revokeNativeSmsDevice({
          sessionId: readSessionCookie(request.headers.cookie),
          deviceId: parseString(request.params.deviceId, "deviceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/devices/native-sms/commands",
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply) => {
      try {
        return store.fetchNativeSmsCommands({
          sessionId: readSessionCookie(request.headers.cookie),
          ...(request.query.limit === undefined
            ? {}
            : { limit: parseIntegerString(request.query.limit, "limit") })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/devices/native-sms/commands/:commandId/acknowledge",
    async (request: FastifyRequest<{ Params: NativeSmsCommandParams }>, reply) => {
      try {
        return store.acknowledgeNativeSmsCommand({
          sessionId: readSessionCookie(request.headers.cookie),
          commandId: parseString(request.params.commandId, "commandId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/devices/native-sms/commands/:commandId/result",
    async (
      request: FastifyRequest<{
        Params: NativeSmsCommandParams;
        Body: NativeSmsCommandResultBody;
      }>,
      reply
    ) => {
      try {
        return store.reportNativeSmsCommandResult({
          sessionId: readSessionCookie(request.headers.cookie),
          commandId: parseString(request.params.commandId, "commandId"),
          status: parseNativeSmsCommandResultStatus(request.body.status),
          resultCode: parseNativeSmsResultCode(request.body.resultCode),
          ...(request.body.carrierReference === undefined
            ? {}
            : { carrierReference: parseNullableString(request.body.carrierReference) })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/devices/native-sms/messages",
    async (request: FastifyRequest<{ Body: NativeSmsInboundBody }>, reply) => {
      try {
        const result = store.ingestNativeSmsMessage({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.body.businessId, "businessId"),
          externalMessageId: parseString(request.body.externalMessageId, "externalMessageId"),
          sender: parseString(request.body.sender, "sender"),
          text: parseString(request.body.text, "text"),
          occurredAt: parseString(request.body.occurredAt, "occurredAt")
        });
        request.log.info(
          {
            event: "native_sms.inbound_received",
            businessId: result.customer.businessId,
            customerId: result.customer.id,
            messageId: result.message?.id ?? null,
            receiptId: result.receipt.id,
            deviceId: result.device.id
          },
          "Native SMS message synchronized."
        );
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/channels/readiness",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          providers: store.listChannelProviderReadiness({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: parseString(request.params.businessId, "businessId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/channel-endpoints",
    async (
      request: FastifyRequest<{
        Params: BusinessParams;
        Querystring: { customerId?: string; conversationId?: string };
      }>,
      reply
    ) => {
      try {
        return {
          endpoints: store.listCustomerChannelEndpoints({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: parseString(request.params.businessId, "businessId"),
            ...(request.query.customerId === undefined
              ? {}
              : { customerId: parseString(request.query.customerId, "customerId") }),
            ...(request.query.conversationId === undefined
              ? {}
              : { conversationId: parseString(request.query.conversationId, "conversationId") })
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/customers/:customerId/channel-link-grants",
    async (
      request: FastifyRequest<{ Params: CustomerParams; Body: ChannelLinkGrantBody }>,
      reply
    ) => {
      try {
        return store.createChannelIdentityLinkGrant({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          customerId: parseString(request.params.customerId, "customerId"),
          provider: parseChannelProvider(request.body.provider),
          ...(request.body.conversationId === undefined
            ? {}
            : { conversationId: parseNullableString(request.body.conversationId) }),
          ...(request.body.automaticRepliesEnabled === undefined
            ? {}
            : {
                automaticRepliesEnabled: parseBoolean(
                  request.body.automaticRepliesEnabled,
                  "automaticRepliesEnabled"
                )
              })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/customers/:customerId/account-link",
    async (
      request: FastifyRequest<{ Params: CustomerParams; Body: CustomerAccountLinkBody }>,
      reply
    ) => {
      try {
        return store.linkCustomerAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          customerId: parseString(request.params.customerId, "customerId"),
          accountId: parseString(request.body.accountId, "accountId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/channel-messages",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ChannelMessageBody }>,
      reply
    ) => {
      try {
        const sent = await store.sendChannelMessage({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseString(request.params.businessId, "businessId"),
          ...(request.body.customerId === undefined
            ? {}
            : { customerId: parseString(request.body.customerId, "customerId") }),
          ...(request.body.customerName === undefined
            ? {}
            : { customerName: parseString(request.body.customerName, "customerName") }),
          ...(request.body.conversationId === undefined
            ? {}
            : { conversationId: parseString(request.body.conversationId, "conversationId") }),
          ...(request.body.provider === undefined
            ? {}
            : { provider: parseChannelProvider(request.body.provider) }),
          ...(request.body.mailboxId === undefined
            ? {}
            : { mailboxId: parseString(request.body.mailboxId, "mailboxId") }),
          ...(request.body.subject === undefined
            ? {}
            : { subject: parseString(request.body.subject, "subject") }),
          ...(request.body.replyToMessageId === undefined
            ? {}
            : {
                replyToMessageId: parseString(request.body.replyToMessageId, "replyToMessageId")
              }),
          ...(request.body.attachments === undefined
            ? {}
            : {
                attachments: parseTrustedMessageAttachmentReferences(request.body.attachments)
              }),
          text: parseString(request.body.text, "text"),
          idempotencyKey: parseString(request.body.idempotencyKey, "idempotencyKey")
        });
        request.log.info(
          {
            tenantId: request.params.businessId,
            conversationId: sent.message.conversationId,
            messageId: sent.message.id,
            provider: sent.selection.endpoint.provider,
            status: sent.message.status
          },
          "Channel message delivery completed."
        );
        return sent;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/webhooks/channels/:provider",
    async (request: FastifyRequest<{ Params: ChannelWebhookParams; Body: unknown }>, reply) => {
      try {
        const result = store.ingestChannelWebhook({
          provider: parseChannelProvider(request.params.provider),
          headers: request.headers,
          payload: request.body
        });
        request.log.info(
          {
            provider: request.params.provider,
            receiptId: result.receipt.id,
            duplicate: result.message === null
          },
          "Channel webhook processed."
        );
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/message-handoffs",
    async (request: FastifyRequest<{ Body: MessageHandoffBody }>, reply) => {
      try {
        const channel = parseString(request.body.channel, "channel");
        if (!isMessageHandoffChannel(channel)) {
          throw new Cp2Error(
            400,
            "message_handoff_channel_invalid",
            "The handoff channel is invalid."
          );
        }
        const status = parseString(request.body.status, "status");
        if (!isMessageHandoffStatus(status)) {
          throw new Cp2Error(
            400,
            "message_handoff_status_invalid",
            "The handoff status is invalid."
          );
        }
        return store.recordMessageHandoff({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: parseNullableString(request.body.businessId),
          conversationId: parseNullableString(request.body.conversationId),
          channel,
          status,
          normalizedErrorCode: parseNullableString(request.body.normalizedErrorCode)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/v1/conversations/:conversationId",
    async (
      request: FastifyRequest<{ Params: ConversationParams; Body: UpdateConversationBody }>,
      reply
    ) => {
      try {
        const mutedUntil =
          request.body.mutedUntil === undefined
            ? undefined
            : request.body.mutedUntil === null
              ? null
              : parseIsoTimestamp(request.body.mutedUntil, "mutedUntil");
        return store.updateConversationSettings({
          sessionId: readSessionCookie(request.headers.cookie),
          conversationId: parseString(request.params.conversationId, "conversationId"),
          ...(request.body.archived !== undefined ? { archived: request.body.archived } : {}),
          ...(mutedUntil !== undefined ? { mutedUntil } : {}),
          ...(request.body.pinned !== undefined ? { pinned: request.body.pinned } : {}),
          ...(request.body.read !== undefined ? { read: request.body.read } : {}),
          ...(request.body.title !== undefined ? { title: request.body.title } : {})
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/v1/conversations/:conversationId/messages/:messageId/delivery-attempts",
    async (request: FastifyRequest<{ Params: MessageParams }>, reply) => {
      try {
        return {
          attempts: store.listMessageDeliveryAttempts({
            sessionId: readSessionCookie(request.headers.cookie),
            conversationId: parseString(request.params.conversationId, "conversationId"),
            messageId: parseString(request.params.messageId, "messageId")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/v1/conversations/:conversationId/messages/:messageId",
    async (request: FastifyRequest<{ Params: MessageParams; Body: UpdateMessageBody }>, reply) => {
      try {
        return store.updateConversationMessage({
          sessionId: readSessionCookie(request.headers.cookie),
          conversationId: parseString(request.params.conversationId, "conversationId"),
          messageId: parseString(request.params.messageId, "messageId"),
          ...(request.body.text !== undefined ? { text: request.body.text } : {}),
          ...(request.body.content !== undefined
            ? { content: parseConversationMessageContent(request.body.content) }
            : {}),
          ...(request.body.deleted !== undefined ? { deleted: request.body.deleted } : {}),
          ...(request.body.reaction !== undefined ? { reaction: request.body.reaction } : {})
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/v1/conversations/:conversationId/typing",
    async (
      request: FastifyRequest<{ Params: ConversationParams; Body: { typing?: boolean } }>,
      reply
    ) => {
      try {
        return {
          typing: store.setConversationTyping({
            sessionId: readSessionCookie(request.headers.cookie),
            conversationId: parseString(request.params.conversationId, "conversationId"),
            typing: parseBoolean(request.body.typing, "typing")
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    const revoked = store.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
    return {
      revoked
    };
  });

  app.post("/logout", async (request, reply) => {
    const revoked = store.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
    return { revoked };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const revoked = store.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
    return {
      revoked
    };
  });

  app.post("/auth/logout-all", async (request, reply) => {
    const result = store.logoutAll(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
    return result;
  });

  app.post("/logout-all", async (request, reply) => {
    const result = store.logoutAll(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
    return result;
  });

  app.post("/api/auth/logout-all", async (request, reply) => {
    const result = store.logoutAll(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
    return result;
  });

  registerNetworkRoutes(app, store);

  app.post("/businesses", async (request: FastifyRequest<{ Body: CreateBusinessBody }>, reply) => {
    try {
      const name = parseString(request.body.name, "name");
      const language = parseLanguage(request.body.language);
      return store.createBusiness({
        sessionId: readSessionCookie(request.headers.cookie),
        name,
        language,
        ...(request.body.phoneNumber === undefined
          ? {}
          : { phoneNumber: request.body.phoneNumber }),
        ...(request.body.phoneCountry === undefined
          ? {}
          : { phoneCountry: request.body.phoneCountry })
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.put("/account/phone", async (request: FastifyRequest<{ Body: OwnerPhoneBody }>, reply) => {
    try {
      return store.updateOwnerPhone({
        sessionId: readSessionCookie(request.headers.cookie),
        phoneNumber: typeof request.body.phoneNumber === "string" ? request.body.phoneNumber : "",
        country: typeof request.body.country === "string" ? request.body.country : ""
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.put(
    "/account/display-name",
    async (request: FastifyRequest<{ Body: DisplayNameBody }>, reply) => {
      try {
        return store.updateOwnDisplayName({
          sessionId: readSessionCookie(request.headers.cookie),
          displayName: parseString(request.body.displayName, "displayName")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/roles/check", async (request: FastifyRequest<{ Body: RoleCheckBody }>, reply) => {
    try {
      const businessId = parseString(request.body.businessId, "businessId");
      const role = parseString(request.body.role, "role");
      const permission = parseOptionalPermission(request.body.permission);
      const input = {
        sessionId: readSessionCookie(request.headers.cookie),
        businessId,
        role
      };
      return permission === undefined
        ? store.checkRole(input)
        : store.checkRole({ ...input, permission });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get(
    "/public/storefronts",
    async (request: FastifyRequest<{ Querystring: PublicStorefrontSearchQuery }>, reply) => {
      try {
        const search = parseOptionalString(request.query.search);
        const limit =
          request.query.limit === undefined
            ? undefined
            : parseIntegerString(request.query.limit, "limit");
        return {
          storefronts: store.listPublicStorefronts({
            ...(search === undefined ? {} : { search }),
            ...(limit === undefined ? {} : { limit })
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/public/storefronts/:agentId",
    async (request: FastifyRequest<{ Params: StorefrontParams }>, reply) => {
      try {
        return store.getPublicStorefront({
          agentId: parseString(request.params.agentId, "agentId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/public/storefronts/:agentId/customer-care",
    async (
      request: FastifyRequest<{ Params: StorefrontParams; Body: PublicCustomerCareBody }>,
      reply
    ) => {
      try {
        return store.createPublicCustomerCareRequest({
          agentId: parseString(request.params.agentId, "agentId"),
          type: parsePublicCustomerCareType(request.body.type),
          customerName: parseNullableString(request.body.customerName),
          phone: parseNullableString(request.body.phone),
          message: parseNullableString(request.body.message)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/public/storefronts/:agentId/sessions",
    async (
      request: FastifyRequest<{ Params: StorefrontParams; Body: PublicStorefrontSessionBody }>,
      reply
    ) => {
      try {
        return store.createPublicStorefrontSession({
          agentId: parseString(request.params.agentId, "agentId"),
          visitorId: parseString(request.body.visitorId, "visitorId"),
          displayName: parseNullableString(request.body.displayName)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/public/storefronts/:agentId/messages",
    async (
      request: FastifyRequest<{ Params: StorefrontParams; Body: PublicStorefrontMessageBody }>,
      reply
    ) => {
      try {
        return await store.createPublicStorefrontMessage({
          agentId: parseString(request.params.agentId, "agentId"),
          capabilityToken: parseString(request.body.capabilityToken, "capabilityToken"),
          body: parseString(request.body.body, "body"),
          attachmentNames: parseStringArray(request.body.attachmentNames, "attachmentNames", 10)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/public/storefronts/:agentId/orders",
    async (request: FastifyRequest<{ Params: StorefrontParams; Body: PublicOrderBody }>, reply) => {
      try {
        return store.createPublicOrder({
          agentId: parseString(request.params.agentId, "agentId"),
          capabilityToken: parseString(request.body.capabilityToken, "capabilityToken"),
          customerName: parseString(request.body.customerName, "customerName"),
          phone: parseString(request.body.phone, "phone"),
          note: parseNullableString(request.body.note),
          items: parsePublicOrderItems(request.body.items)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/public/product-media/:mediaId",
    async (request: FastifyRequest<{ Params: { mediaId: string } }>, reply) => {
      try {
        const media = store.getPublicProductMedia({
          mediaId: parseString(request.params.mediaId, "mediaId")
        });
        reply.header("content-type", media.contentType);
        reply.header("cache-control", "public, max-age=86400, immutable");
        return reply.send(Buffer.from(media.contentBase64, "base64"));
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/presence",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getShopPresence({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/presence",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: ShopPresenceBody }>, reply) => {
      try {
        return store.setShopPresence({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          status: parseShopPresenceStatus(request.body.status)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/network/invites",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listNetworkInvites({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/network/invites",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: NetworkInvitesBody }>,
      reply
    ) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        const invites = store.createNetworkInvites({
          sessionId,
          businessId: request.params.businessId,
          contacts: parseNetworkInviteContacts(request.body.contacts)
        });
        return {
          invites: await store.deliverNetworkInvites({
            sessionId,
            businessId: request.params.businessId,
            inviteIds: invites.map((invite) => invite.id)
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/storefront/customer-care",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listPublicCustomerCareRequests({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/storefront/messages",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listPublicStorefrontMessages({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/storefront/orders",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listPublicOrders({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/products",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listProducts({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/products",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: ProductBody }>, reply) => {
      try {
        return store.createProduct({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          product: parseProductBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/products/fields",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getProductFieldSchema({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/products/fields",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ProductFieldStructureBody }>,
      reply
    ) => {
      try {
        return store.saveProductFieldSchema({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          fields: parseProductFieldDefinitions(request.body?.fields)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/products/:productId",
    async (request: FastifyRequest<{ Params: ProductParams; Body: ProductBody }>, reply) => {
      try {
        return store.updateProduct({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          productId: request.params.productId,
          product: parseProductBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/products/:productId",
    async (request: FastifyRequest<{ Params: ProductParams }>, reply) => {
      try {
        return store.deleteProduct({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          productId: request.params.productId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/products/:productId/stock-adjustments",
    async (
      request: FastifyRequest<{ Params: ProductParams; Body: StockAdjustmentBody }>,
      reply
    ) => {
      try {
        return store.adjustProductStock({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          productId: request.params.productId,
          adjustment: parseStockAdjustmentBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/customers",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listCustomers({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/customers",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: ContactRecordBody }>, reply) => {
      try {
        return store.createCustomer({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          customer: parseContactRecordBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/customers/:customerId",
    async (request: FastifyRequest<{ Params: CustomerParams; Body: ContactRecordBody }>, reply) => {
      try {
        return store.updateCustomer({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          customerId: request.params.customerId,
          customer: parseContactRecordBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  registerSuppliersRoutes(app, store, binaryUploadPipeline, receiptOCRProcessor);

  app.post(
    "/businesses/:businessId/invoices/preview",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: InvoiceBody }>, reply) => {
      try {
        return store.previewInvoice({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          invoice: parseInvoiceBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/invoices",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listInvoices({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/invoices",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: InvoiceBody }>, reply) => {
      try {
        return store.createInvoice({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          invoice: parseInvoiceBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/invoices/:invoiceId",
    async (request: FastifyRequest<{ Params: InvoiceParams; Body: InvoiceBody }>, reply) => {
      try {
        return store.updateInvoice({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          invoiceId: request.params.invoiceId,
          invoice: parseInvoiceBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/invoices/:invoiceId/confirm",
    async (request: FastifyRequest<{ Params: InvoiceParams }>, reply) => {
      try {
        return store.confirmInvoice({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/payments",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listPayments({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/payments",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: PaymentBody }>, reply) => {
      try {
        return store.recordPayment({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          payment: parsePaymentBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/invoices/:invoiceId/payments",
    async (request: FastifyRequest<{ Params: PaymentParams }>, reply) => {
      try {
        return store.listPayments({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/payment-summaries",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listInvoicePaymentSummaries({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/customer-debts",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listCustomerDebts({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  registerLogisticsRoutes(app, store);

  app.get(
    "/businesses/:businessId/reports/summary",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getBusinessReport({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/knowledge",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getBusinessKnowledge({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  registerNotificationsRoutes(app, store);

  app.get(
    "/businesses/:businessId/compliance/security-review",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getSecurityReview({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/compliance/export",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.createDataExport({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/compliance/account-deletion",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: AccountDeletionBody }>,
      reply
    ) => {
      try {
        const result = store.requestAccountDeletion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deletion: parseAccountDeletionBody(request.body)
        });
        reply.header("set-cookie", [clearSessionCookie(), clearRefreshCookie()]);
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/account-restoration/requests", async (request, reply) => {
    try {
      return {
        requests: store.listRestorableAccountDeletions({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/account-restoration/:requestId",
    async (request: FastifyRequest<{ Params: AccountRestorationParams; Body: PinBody }>, reply) => {
      try {
        return store.restoreAccountDeletion({
          sessionId: readSessionCookie(request.headers.cookie),
          requestId: parseString(request.params.requestId, "requestId"),
          pin: parseString(request.body.pin, "pin")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/social-accounts",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          accounts: store.listConnectedSocialAccounts({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: request.params.businessId
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/social-accounts/:identityId",
    async (request: FastifyRequest<{ Params: SocialIdentityParams }>, reply) => {
      try {
        return store.disconnectSocialAccount({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          identityId: request.params.identityId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/shop-deletion/preview",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getShopDeletionPreview({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/shop-deletion/request",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ShopDeletionRequestBody }>,
      reply
    ) => {
      try {
        return store.requestShopDeletion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          shopId: parseString(request.body.shopId, "shopId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/shop-deletion/:requestId/finalize",
    async (
      request: FastifyRequest<{ Params: ShopDeletionParams; Body: ShopDeletionFinalizeBody }>,
      reply
    ) => {
      try {
        const idempotencyKey = parseOptionalString(request.body.idempotencyKey);
        return store.finalizeShopDeletion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          requestId: request.params.requestId,
          pin: parseString(request.body.pin, "pin"),
          acknowledgement: parseBoolean(request.body.acknowledgement, "acknowledgement"),
          ...(idempotencyKey === undefined ? {} : { idempotencyKey })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/shop-deletion/:requestId/restore",
    async (request: FastifyRequest<{ Params: ShopDeletionParams }>, reply) => {
      try {
        return store.restoreShopDeletion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          requestId: request.params.requestId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/compliance/verification",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getVerificationTier({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/compliance/verification",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: VerificationTierBody }>,
      reply
    ) => {
      try {
        return store.updateVerificationTier({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          verification: parseVerificationTierBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/compliance/tax-config",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getTaxConfig({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/compliance/tax-config",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: TaxConfigBody }>, reply) => {
      try {
        return store.updateTaxConfig({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          taxConfig: parseTaxConfigBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/compliance/device-trust",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getDeviceTrust({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/compliance/device-trust",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: DeviceTrustBody }>, reply) => {
      try {
        return store.updateDeviceTrust({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceTrust: parseDeviceTrustBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/beta/readiness",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getBetaReadiness({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/beta/access",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: BetaAccessBody }>, reply) => {
      try {
        return store.updateBetaAccess({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          access: parseBetaAccessBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/beta/feature-flags",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listBetaFeatureFlags({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/beta/feature-flags/:featureFlagKey",
    async (
      request: FastifyRequest<{ Params: BetaFeatureFlagParams; Body: BetaFeatureFlagBody }>,
      reply
    ) => {
      try {
        return store.updateBetaFeatureFlag({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          key: parseBetaFeatureFlagKey(request.params.featureFlagKey),
          featureFlag: parseBetaFeatureFlagBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/beta/device-tests",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: BetaDeviceTestBody }>,
      reply
    ) => {
      try {
        return store.recordBetaDeviceTest({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          deviceTest: parseBetaDeviceTestBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/beta/support-tickets",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listBetaSupportTickets({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/beta/support-tickets",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: BetaSupportTicketBody }>,
      reply
    ) => {
      try {
        return store.createBetaSupportTicket({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ticket: parseBetaSupportTicketBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/beta/support-tickets/:supportTicketId",
    async (
      request: FastifyRequest<{
        Params: BetaSupportTicketParams;
        Body: BetaSupportTicketStatusBody;
      }>,
      reply
    ) => {
      try {
        return store.updateBetaSupportTicketStatus({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supportTicketId: request.params.supportTicketId,
          ticketStatus: parseBetaSupportTicketStatusBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/beta/telemetry",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: BetaTelemetryBody }>, reply) => {
      try {
        return store.recordBetaTelemetry({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          telemetry: parseBetaTelemetryBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/launch/readiness",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getLaunchReadiness({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/launch/settings",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: LaunchSettingsBody }>,
      reply
    ) => {
      try {
        return store.updateLaunchSettings({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          settings: parseLaunchSettingsBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/launch/checklist",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listLaunchChecklist({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/launch/checklist/:checklistKey",
    async (
      request: FastifyRequest<{ Params: LaunchChecklistParams; Body: LaunchChecklistBody }>,
      reply
    ) => {
      try {
        return store.updateLaunchChecklist({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          checklist: parseLaunchChecklistBody(request.params.checklistKey, request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/launch/incidents",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listLaunchIncidents({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/launch/incidents",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: LaunchIncidentBody }>,
      reply
    ) => {
      try {
        return store.createLaunchIncident({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          incident: parseLaunchIncidentBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/launch/incidents/:incidentId",
    async (
      request: FastifyRequest<{
        Params: LaunchIncidentParams;
        Body: LaunchIncidentStatusBody;
      }>,
      reply
    ) => {
      try {
        return store.updateLaunchIncidentStatus({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          incidentId: request.params.incidentId,
          incidentStatus: parseLaunchIncidentStatusBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  registerDocumentImportsRoutes(app, store, binaryUploadPipeline, receiptOCRProcessor);

  app.post(
    "/businesses/:businessId/product-captures",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ProductCaptureBody }>,
      reply
    ) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        store.assertDocumentImportWriteAccess({
          sessionId,
          businessId: request.params.businessId
        });
        const upload = parseDocumentImportBody(request.body);
        if (upload.contentBase64 === undefined) {
          throw new Cp2Error(
            400,
            "product_capture_content_required",
            "A product image is required."
          );
        }
        const contentType = upload.contentType?.trim() || "application/octet-stream";
        if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
          throw new Cp2Error(415, "product_capture_type_unsupported", "Use JPEG, PNG, or WebP.");
        }
        const binary = decodeReceiptBase64(upload.contentBase64);
        if (binary.byteLength > 10 * 1024 * 1024) {
          throw new Cp2Error(
            413,
            "product_capture_too_large",
            "Product images must be 10 MB or smaller."
          );
        }
        assertDocumentOcrSignature(contentType, binary);
        await binaryUploadPipeline?.process(
          {
            businessId: request.params.businessId,
            fileName: upload.fileName,
            contentType,
            bytes: binary
          },
          { retain: false }
        );
        let extractedText =
          typeof request.body.extractedText === "string" ? request.body.extractedText : "";
        let averageConfidence: number | null = null;
        if (extractedText.trim().length === 0 && receiptOCRProcessor !== undefined) {
          const extraction = await receiptOCRProcessor.process({
            fileName: upload.fileName,
            contentType,
            contentBase64: binary.toString("base64")
          });
          extractedText = extraction.fullText;
          averageConfidence = extraction.averageConfidence;
        }
        return store.createProductCaptureJob({
          sessionId,
          businessId: request.params.businessId,
          sourceFileName: upload.fileName,
          contentType: contentType as "image/jpeg" | "image/png" | "image/webp",
          contentBase64: binary.toString("base64"),
          sourceChecksum: createHash("sha256").update(binary).digest("hex"),
          extractedText,
          averageConfidence
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/product-captures/:captureJobId",
    async (request: FastifyRequest<{ Params: ProductCaptureParams }>, reply) => {
      try {
        return store.getProductCaptureJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/product-captures/:captureJobId/review",
    async (
      request: FastifyRequest<{ Params: ProductCaptureParams; Body: ProductCaptureReviewBody }>,
      reply
    ) => {
      try {
        return store.reviewProductCaptureJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId,
          title: parseString(request.body.title, "title"),
          category: parseNullableString(request.body.category),
          description: parseNullableString(request.body.description),
          visiblePrice:
            request.body.visiblePrice === undefined
              ? null
              : parseNullableNumber(request.body.visiblePrice, "visiblePrice"),
          keepImageAsProductMedia:
            request.body.keepImageAsProductMedia === undefined
              ? false
              : parseBoolean(request.body.keepImageAsProductMedia, "keepImageAsProductMedia")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/product-captures/:captureJobId/retry",
    async (
      request: FastifyRequest<{ Params: ProductCaptureParams; Body: { extractedText?: string } }>,
      reply
    ) => {
      try {
        return store.retryProductCaptureJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId,
          extractedText:
            typeof request.body.extractedText === "string" ? request.body.extractedText : ""
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/product-captures/:captureJobId/cancel",
    async (request: FastifyRequest<{ Params: ProductCaptureParams }>, reply) => {
      try {
        return store.cancelProductCaptureJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/product-captures/:captureJobId/confirm",
    async (
      request: FastifyRequest<{ Params: ProductCaptureParams; Body: ProductCaptureConfirmBody }>,
      reply
    ) => {
      try {
        const quantity =
          request.body.quantity === undefined
            ? undefined
            : parseNumber(request.body.quantity, "quantity");
        const aliases =
          request.body.aliases === undefined
            ? undefined
            : parseStringArray(request.body.aliases, "aliases", 20);
        return store.confirmProductCaptureJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId,
          existingProductId: parseNullableString(request.body.existingProductId),
          unit: parseNullableString(request.body.unit),
          ...(quantity === undefined ? {} : { quantity }),
          ...(aliases === undefined ? {} : { aliases })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/product-captures/:captureJobId/items/:itemId/confirm",
    async (
      request: FastifyRequest<{
        Params: ProductCaptureItemParams;
        Body: ProductCaptureItemConfirmBody;
      }>,
      reply
    ) => {
      try {
        const quantity =
          request.body.quantity === undefined
            ? undefined
            : parseNumber(request.body.quantity, "quantity");
        const aliases =
          request.body.aliases === undefined
            ? undefined
            : parseStringArray(request.body.aliases, "aliases", 20);
        return store.confirmProductCaptureItem({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId,
          itemId: request.params.itemId,
          ...(request.body.title === undefined
            ? {}
            : { title: parseString(request.body.title, "title") }),
          ...(request.body.category === undefined
            ? {}
            : { category: parseNullableString(request.body.category) }),
          ...(request.body.description === undefined
            ? {}
            : { description: parseNullableString(request.body.description) }),
          ...(request.body.visiblePrice === undefined
            ? {}
            : { visiblePrice: parseNullableNumber(request.body.visiblePrice, "visiblePrice") }),
          existingProductId: parseNullableString(request.body.existingProductId),
          unit: parseNullableString(request.body.unit),
          ...(quantity === undefined ? {} : { quantity }),
          ...(aliases === undefined ? {} : { aliases })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/product-captures/:captureJobId/items/:itemId/reject",
    async (request: FastifyRequest<{ Params: ProductCaptureItemParams }>, reply) => {
      try {
        return store.rejectProductCaptureItem({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          captureJobId: request.params.captureJobId,
          itemId: request.params.itemId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/status-broadcasts/candidates",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          candidates: store.listStatusBroadcastCandidates({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: request.params.businessId
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/status-broadcasts",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: StatusBroadcastCreateBody }>,
      reply
    ) => {
      try {
        return store.createStatusBroadcast({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          sourceCaptureJobId: parseString(request.body.sourceCaptureJobId, "sourceCaptureJobId"),
          recipientNodeIds: parseStringArray(request.body.recipientNodeIds, "recipientNodeIds", 200),
          sellerConversationId: parseNullableString(request.body.sellerConversationId ?? null)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/status-broadcasts/:statusBroadcastId",
    async (request: FastifyRequest<{ Params: StatusBroadcastParams }>, reply) => {
      try {
        return store.getStatusBroadcast({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          statusBroadcastId: request.params.statusBroadcastId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/status-broadcasts",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return {
          statusBroadcasts: store.listStatusBroadcastsForBusiness({
            sessionId: readSessionCookie(request.headers.cookie),
            businessId: request.params.businessId
          })
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/status-broadcasts/received", async (request, reply) => {
    try {
      return {
        statusBroadcasts: store.listStatusBroadcastsReceivedByViewer({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/status-broadcasts/:statusBroadcastId/view",
    async (request: FastifyRequest<{ Params: StatusBroadcastEngagementParams }>, reply) => {
      try {
        return store.recordStatusBroadcastView({
          sessionId: readSessionCookie(request.headers.cookie),
          statusBroadcastId: request.params.statusBroadcastId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/status-broadcasts/:statusBroadcastId/reply",
    async (request: FastifyRequest<{ Params: StatusBroadcastEngagementParams }>, reply) => {
      try {
        return store.recordStatusBroadcastReply({
          sessionId: readSessionCookie(request.headers.cookie),
          statusBroadcastId: request.params.statusBroadcastId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/buy/search",
    async (request: FastifyRequest<{ Querystring: BuySearchQuery }>, reply) => {
      try {
        return store.searchBuyFeed({
          sessionId: readSessionCookie(request.headers.cookie),
          query: request.query.query ?? ""
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/buy/checkout",
    async (request: FastifyRequest<{ Body: BuyCheckoutBody }>, reply) => {
      try {
        return store.createUnifiedCheckout({
          sessionId: readSessionCookie(request.headers.cookie),
          items: parseBuyCheckoutItems(request.body.items),
          sellerConversationId: parseNullableString(request.body.sellerConversationId ?? null)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/buy/checkouts/:unifiedCheckoutId",
    async (request: FastifyRequest<{ Params: UnifiedCheckoutParams }>, reply) => {
      try {
        return store.getUnifiedCheckout({
          sessionId: readSessionCookie(request.headers.cookie),
          unifiedCheckoutId: request.params.unifiedCheckoutId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/runtime/sessions",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.createRuntimeSession({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/runtime/sessions",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listRuntimeSessions({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/runtime/sessions/:runtimeSessionId/turns",
    async (request: FastifyRequest<{ Params: RuntimeSessionParams }>, reply) => {
      try {
        return store.listRuntimeTurns({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          runtimeSessionId: request.params.runtimeSessionId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/runtime/turns",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: RuntimeTurnBody }>, reply) => {
      try {
        return await store.createRuntimeTurn({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...parseRuntimeTurnBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/offline-cache",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getOfflineCache({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/sync-queue",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listSyncQueue({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/sync-queue",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: SyncMutationBody }>, reply) => {
      try {
        const body = parseSyncMutationBody(request.body);
        return store.enqueueSyncMutation({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ...body
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/sync-queue/replay",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.replaySyncQueue({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/sync-queue/:syncItemId/replay",
    async (request: FastifyRequest<{ Params: SyncQueueParams }>, reply) => {
      try {
        return store.replaySyncQueueItem({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          syncItemId: request.params.syncItemId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  return store;
}

function parseSyncMutationBody(body: SyncMutationBody | null | undefined): {
  idempotencyKey: string;
  mutationType: SyncMutationType;
  clientCreatedAt?: string;
  payload: SyncMutationPayload;
} {
  const record = parseRequestBody(body);
  const idempotencyKey = parseString(record.idempotencyKey, "idempotencyKey");
  const mutationType = parseSyncMutationType(record.mutationType);
  const clientCreatedAt =
    record.clientCreatedAt === undefined
      ? undefined
      : parseIsoTimestamp(record.clientCreatedAt, "clientCreatedAt");
  const parsed = {
    idempotencyKey,
    mutationType,
    payload: parseSyncMutationPayload(mutationType, record.payload)
  };

  return clientCreatedAt === undefined ? parsed : { ...parsed, clientCreatedAt };
}

function parseSyncMutationType(value: unknown): SyncMutationType {
  if (typeof value === "string" && isSyncMutationType(value)) {
    return value;
  }

  throw new Cp2Error(400, "mutation_type_invalid", "Sync mutation type is not supported.");
}

function parseSyncMutationPayload(
  mutationType: SyncMutationType,
  value: unknown
): SyncMutationPayload {
  const payload = parseRequestBody(value);

  switch (mutationType) {
    case "product.create":
      return parseProductBody(payload);

    case "customer.create":
    case "supplier.create":
      return parseContactRecordBody(payload);

    case "inventory.adjust":
      return {
        productId: parseString(payload.productId, "payload.productId"),
        ...parseStockAdjustmentBody(payload)
      };

    case "invoice.create":
      return parseInvoiceBody(payload);

    case "invoice.confirm":
      return {
        invoiceId: parseString(payload.invoiceId, "payload.invoiceId")
      };

    case "payment.record":
      return parsePaymentBody(payload);

    case "logistics.create":
      return parseLogisticsBody(payload);

    case "logistics.update_status":
      return {
        logisticsId: parseString(payload.logisticsId, "payload.logisticsId"),
        ...parseLogisticsStatusBody(payload)
      };
  }
}

function parseAgentProfileBody(body: AgentProfileBody): BusinessAgentProfileInput {
  const language = parseString(body.language, "language");
  if (!isSupportedLanguage(language)) {
    throw new Cp2Error(400, "language_invalid", "language is not supported.");
  }
  const status = parseString(body.status, "status");
  if (status !== "active" && status !== "draft") {
    throw new Cp2Error(400, "agent_status_invalid", "Agent status is invalid.");
  }

  const personalityConfig =
    body.personalityConfig === undefined
      ? undefined
      : (parseRequestBody(body.personalityConfig) as unknown as AgentPersonality);
  const instructionPolicy =
    body.instructionPolicy === undefined
      ? undefined
      : (parseRequestBody(body.instructionPolicy) as unknown as AgentInstructions);
  const skillBindings =
    body.skillBindings === undefined
      ? undefined
      : parseStructuredArray<AgentSkillBinding>(body.skillBindings, "skillBindings", 32);
  const memoryPolicy =
    body.memoryPolicy === undefined
      ? undefined
      : (parseRequestBody(body.memoryPolicy) as unknown as AgentMemoryPolicy);
  const evaluationPolicy =
    body.evaluationPolicy === undefined
      ? undefined
      : (parseRequestBody(body.evaluationPolicy) as unknown as AgentEvaluationPolicy);
  const supportedLanguages =
    body.supportedLanguages === undefined
      ? undefined
      : parseStringArray(body.supportedLanguages, "supportedLanguages", 2).map((item) => {
          if (!isSupportedLanguage(item)) {
            throw new Cp2Error(400, "language_invalid", "language is not supported.");
          }
          return item;
        });
  return {
    name: parseString(body.name, "name"),
    description: parseString(body.description, "description"),
    modelId: parseString(body.modelId, "modelId"),
    role: parseString(body.role, "role"),
    language,
    personality: parseString(body.personality, "personality"),
    instructions: parseString(body.instructions, "instructions"),
    knowledge: parseString(body.knowledge, "knowledge"),
    tools: parseStringArray(body.tools, "tools", 24),
    integrations: parseStringArray(body.integrations, "integrations", 24),
    contextScripts: parseStringArray(body.contextScripts, "contextScripts", 12),
    ...(personalityConfig === undefined ? {} : { personalityConfig }),
    ...(instructionPolicy === undefined ? {} : { instructionPolicy }),
    ...(skillBindings === undefined ? {} : { skillBindings }),
    ...(memoryPolicy === undefined ? {} : { memoryPolicy }),
    ...(evaluationPolicy === undefined ? {} : { evaluationPolicy }),
    ...(supportedLanguages === undefined ? {} : { supportedLanguages }),
    ...(body.businessCategory === undefined
      ? {}
      : { businessCategory: parseString(body.businessCategory, "businessCategory") }),
    ...(body.publicIntroduction === undefined
      ? {}
      : { publicIntroduction: parseString(body.publicIntroduction, "publicIntroduction") }),
    status
  };
}

function parseAgentContextSourceBody(body: AgentContextSourceBody | null | undefined): {
  sourceId?: string;
  type: AgentContextSource["type"];
  title: string;
  content: string;
  sensitivity: AgentContextSource["sensitivity"];
  customerVisible: boolean;
  status: AgentContextSource["status"];
} {
  const record = parseRequestBody(body);
  const type = parseString(record.type, "type");
  const sensitivity = parseString(record.sensitivity, "sensitivity");
  const status = parseString(record.status, "status");
  const types: AgentContextSource["type"][] = [
    "catalogue",
    "inventory",
    "customer",
    "supplier",
    "receipt",
    "order",
    "policy",
    "document",
    "conversation",
    "context_script",
    "owner_note"
  ];
  if (!types.includes(type as AgentContextSource["type"])) {
    throw new Cp2Error(400, "context_source_type_invalid", "Context source type is invalid.");
  }
  if (!["public", "internal", "confidential", "restricted"].includes(sensitivity)) {
    throw new Cp2Error(
      400,
      "context_source_sensitivity_invalid",
      "Context source sensitivity is invalid."
    );
  }
  if (!["active", "disabled", "archived"].includes(status)) {
    throw new Cp2Error(400, "context_source_status_invalid", "Context source status is invalid.");
  }
  return {
    ...(record.id === undefined ? {} : { sourceId: parseString(record.id, "id") }),
    type: type as AgentContextSource["type"],
    title: parseString(record.title, "title"),
    content: parseString(record.content, "content"),
    sensitivity: sensitivity as AgentContextSource["sensitivity"],
    customerVisible: parseBoolean(record.customerVisible, "customerVisible"),
    status: status as AgentContextSource["status"]
  };
}

function parseAgentCorrectionBody(body: AgentCorrectionBody | null | undefined): {
  correction: string;
  category: AgentOwnerCorrection["category"];
  sourceMessageId?: string | null;
  promoteToInstruction: boolean;
} {
  const record = parseRequestBody(body);
  const category = parseString(record.category, "category");
  if (!["instruction", "business_fact", "memory", "response"].includes(category)) {
    throw new Cp2Error(400, "agent_correction_category_invalid", "Correction category is invalid.");
  }
  return {
    correction: parseString(record.correction, "correction"),
    category: category as AgentOwnerCorrection["category"],
    ...(record.sourceMessageId === undefined
      ? {}
      : { sourceMessageId: parseNullableString(record.sourceMessageId) }),
    promoteToInstruction: parseBoolean(record.promoteToInstruction, "promoteToInstruction")
  };
}

function parseAgentFeedbackBody(body: AgentFeedbackBody | null | undefined): {
  messageId?: string | null;
  correct: boolean;
  reason?: string | null;
} {
  const record = parseRequestBody(body);
  return {
    ...(record.messageId === undefined ? {} : { messageId: parseNullableString(record.messageId) }),
    correct: parseBoolean(record.correct, "correct"),
    ...(record.reason === undefined ? {} : { reason: parseNullableString(record.reason) })
  };
}

function parseStructuredArray<T>(value: unknown, name: string, maximumItems: number): T[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Cp2Error(
      400,
      `${name}_invalid`,
      `${name} must be an array with ${maximumItems} items or fewer.`
    );
  }
  return value.map((item) => parseRequestBody(item) as unknown as T);
}

function isMessageChannel(value: string): value is MessageChannel {
  return [
    "soko",
    "sms",
    "mms",
    "rcs_business",
    "whatsapp_business",
    "telegram",
    "facebook_messenger",
    "instagram_messaging",
    "tiktok_business",
    "x_dm",
    "native_sms",
    "email"
  ].includes(value);
}

function parseChannelProvider(value: unknown): ChannelProvider {
  const provider = parseString(value, "provider");
  if (
    [
      "soko",
      "telegram",
      "whatsapp",
      "messenger",
      "instagram",
      "tiktok",
      "x",
      "sms",
      "native_sms",
      "email"
    ].includes(provider)
  ) {
    return provider as ChannelProvider;
  }
  throw new Cp2Error(400, "channel_provider_invalid", "The channel provider is invalid.");
}

function parseConnectedMailboxProvider(value: unknown): ConnectedMailboxProvider {
  const provider = parseString(value, "provider");
  if (provider === "gmail" || provider === "outlook") return provider;
  throw new Cp2Error(400, "mailbox_provider_invalid", "Mailbox provider is invalid.");
}

function parseNativeSmsCommandResultStatus(
  value: unknown
): "sending" | "sent" | "delivered" | "failed" {
  const status = parseString(value, "status");
  if (["sending", "sent", "delivered", "failed"].includes(status)) {
    return status as "sending" | "sent" | "delivered" | "failed";
  }
  throw new Cp2Error(400, "sms_result_status_invalid", "SMS result status is invalid.");
}

function parseNativeSmsResultCode(value: unknown): NativeSmsResultCode {
  const code = parseString(value, "resultCode");
  if (
    [
      "SMS_SENT",
      "SMS_DELIVERED",
      "SMS_DEVICE_UNAVAILABLE",
      "SMS_NO_SERVICE",
      "SMS_RADIO_OFF",
      "SMS_SIM_UNAVAILABLE",
      "SMS_SIM_SELECTION_REQUIRED",
      "SMS_PERMISSION_REQUIRED",
      "SMS_ROLE_REQUIRED",
      "SMS_SEND_FAILED",
      "SMS_DELIVERY_UNKNOWN"
    ].includes(code)
  ) {
    return code as NativeSmsResultCode;
  }
  throw new Cp2Error(400, "sms_result_code_invalid", "SMS result code is invalid.");
}

function isMessageHandoffStatus(value: string): value is MessageHandoffStatus {
  return [
    "preparing",
    "composer_opened",
    "no_sms_app",
    "invalid_recipient",
    "cancelled_before_handoff",
    "native_bridge_unavailable",
    "share_completed",
    "share_cancelled",
    "copied_to_clipboard",
    "share_unavailable",
    "unsupported"
  ].includes(value);
}

function isMessageHandoffChannel(value: string): value is MessageHandoffChannel {
  return value === "sms_external_app" || value === "platform_share_sheet";
}

function defaultOAuthRedirectUri(request: FastifyRequest): string {
  const origin = request.headers.origin ?? process.env.APP_URL?.trim() ?? "http://127.0.0.1:5173";
  let url: URL;

  try {
    url = new URL("/auth/oauth/callback", origin);
  } catch {
    throw new Cp2Error(400, "redirect_uri_invalid", "OAuth redirect URI is invalid.");
  }

  return url.toString();
}

function parseAuthChannel(value: string | undefined): AuthChannel {
  if (value === "email" || value === "phone") {
    return value;
  }

  throw new Cp2Error(400, "channel_invalid", "Auth channel must be email or phone.");
}

function parseOtpPurpose(value: string | undefined): "signup" | "recovery" {
  if (value === undefined || value === "signup") {
    return "signup";
  }

  if (value === "recovery") {
    return "recovery";
  }

  throw new Cp2Error(400, "otp_purpose_invalid", "OTP purpose must be signup or recovery.");
}


function parseOtpDeliveryChannel(value: string | undefined, authChannel: AuthChannel): "email" {
  const deliveryChannel = value ?? "email";

  if (authChannel !== "email" || deliveryChannel !== "email") {
    throw new Cp2Error(400, "otp_delivery_channel_invalid", "OTP delivery channel must be email.");
  }

  return "email";
}

function parseLanguage(value: string | undefined) {
  if (value === undefined || !isSupportedLanguage(value)) {
    throw new Cp2Error(400, "language_invalid", "Language must be en or sw.");
  }

  return value;
}

function parseProductBody(body: ProductBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    name: parseString(record.name, "name"),
    sku: parseNullableString(record.sku),
    ...(record.aliases === undefined
      ? {}
      : { aliases: parseStringArray(record.aliases, "aliases", 20) }),
    unit: parseNullableString(record.unit),
    quantity: record.quantity === undefined ? 0 : parseNumber(record.quantity, "quantity"),
    buyingPrice:
      record.buyingPrice === undefined || record.buyingPrice === null
        ? null
        : parseNumber(record.buyingPrice, "buyingPrice"),
    sellingPrice:
      record.sellingPrice === undefined || record.sellingPrice === null
        ? null
        : parseNumber(record.sellingPrice, "sellingPrice")
  };
}

function parseProductFieldDefinitions(value: unknown): ProductFieldDefinition[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "product_fields_required", "Product fields are required.");
  }

  return value.map((field, index) => {
    const record = parseRequestBody(field);
    const inputType = parseString(record.inputType, `fields[${index}].inputType`);
    if (!isProductFieldInputType(inputType)) {
      throw new Cp2Error(
        400,
        "product_field_type_invalid",
        `Field ${index + 1} has an unsupported input type.`
      );
    }
    return {
      id: parseString(record.id, `fields[${index}].id`),
      label: parseString(record.label, `fields[${index}].label`),
      inputType,
      required: parseBoolean(record.required, `fields[${index}].required`)
    };
  });
}

function isProductFieldInputType(value: string): value is ProductFieldInputType {
  return ["text", "number", "select", "textarea", "yes_no"].includes(value);
}

function parseStockAdjustmentBody(body: StockAdjustmentBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    quantityAfter: parseNumber(record.quantityAfter, "quantityAfter"),
    reason: parseNullableString(record.reason)
  };
}

function parseInvoiceBody(body: InvoiceBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    customerId: parseNullableString(record.customerId),
    customerName: parseNullableString(record.customerName),
    taxRate: record.taxRate === undefined ? 0 : parseNullableNumber(record.taxRate, "taxRate"),
    items: parseInvoiceItems(record.items)
  };
}

function parsePaymentBody(body: PaymentBody | null | undefined) {
  const record = parseRequestBody(body);
  const method = parseString(record.method, "method");

  if (!isPaymentMethod(method)) {
    throw new Cp2Error(400, "payment_method_invalid", "Payment method is not supported.");
  }

  return {
    invoiceId: parseString(record.invoiceId, "invoiceId"),
    amount: parseNumber(record.amount, "amount"),
    method,
    reference: parseNullableString(record.reference),
    note: parseNullableString(record.note)
  };
}

function parseRuntimeTurnBody(body: RuntimeTurnBody | null | undefined): {
  runtimeSessionId?: string;
  message: string;
  confirmationToken?: string;
  recallEscalation?: RuntimeRecallEscalation;
  clientInferenceCompletion?: ClientInferenceCompletion;
} {
  const record = parseRequestBody(body);
  const runtimeSessionId =
    record.runtimeSessionId === undefined || record.runtimeSessionId === null
      ? undefined
      : parseString(record.runtimeSessionId, "runtimeSessionId");
  const confirmationToken =
    record.confirmationToken === undefined || record.confirmationToken === null
      ? undefined
      : parseString(record.confirmationToken, "confirmationToken");
  const recallEscalation =
    record.recallEscalation === undefined || record.recallEscalation === null
      ? undefined
      : parseRuntimeRecallEscalation(record.recallEscalation);
  const clientInferenceCompletion =
    record.clientInferenceCompletion === undefined || record.clientInferenceCompletion === null
      ? undefined
      : parseClientInferenceCompletion(record.clientInferenceCompletion);
  const parsed = {
    message: parseString(record.message, "message")
  };
  return {
    ...parsed,
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken }),
    ...(recallEscalation === undefined ? {} : { recallEscalation }),
    ...(clientInferenceCompletion === undefined ? {} : { clientInferenceCompletion })
  };
}

function parseClientInferenceCompletion(value: unknown): ClientInferenceCompletion {
  const record = parseRequestBody(value);
  const runtime = parseString(record.runtime, "clientInferenceCompletion.runtime");
  if (
    runtime !== "browser-webgpu" &&
    runtime !== "browser-wasm" &&
    runtime !== "native-llama-cpp"
  ) {
    throw new Cp2Error(
      400,
      "client_inference_runtime_invalid",
      "The client inference runtime is not supported."
    );
  }
  const outputText = parseString(record.outputText, "clientInferenceCompletion.outputText");
  if (outputText.length > 20_000) {
    throw new Cp2Error(
      400,
      "client_inference_output_too_large",
      "The client inference output is too large."
    );
  }
  const durationMs = parseNumber(record.durationMs, "clientInferenceCompletion.durationMs");
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 120_000) {
    throw new Cp2Error(
      400,
      "client_inference_duration_invalid",
      "The client inference duration is invalid."
    );
  }
  const installationId =
    record.installationId === undefined || record.installationId === null
      ? undefined
      : parseString(record.installationId, "clientInferenceCompletion.installationId");
  const promptTokens = parseOptionalClientTokenCount(
    record.promptTokens,
    "clientInferenceCompletion.promptTokens"
  );
  const completionTokens = parseOptionalClientTokenCount(
    record.completionTokens,
    "clientInferenceCompletion.completionTokens"
  );
  return {
    requestId: parseString(record.requestId, "clientInferenceCompletion.requestId"),
    runtime,
    modelId: parseString(record.modelId, "clientInferenceCompletion.modelId"),
    deviceId: parseString(record.deviceId, "clientInferenceCompletion.deviceId"),
    ...(installationId === undefined ? {} : { installationId }),
    outputText,
    durationMs,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens })
  };
}

function parseOptionalClientTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const count = parseNumber(value, field);
  if (!Number.isInteger(count) || count < 0 || count > 1_000_000) {
    throw new Cp2Error(400, "client_inference_usage_invalid", `${field} is invalid.`);
  }
  return count;
}

function parseRuntimeRecallEscalation(value: unknown): RuntimeRecallEscalation {
  const record = parseRequestBody(value);
  const localRuntime = parseString(record.localRuntime, "recallEscalation.localRuntime");
  if (
    localRuntime !== "browser-webgpu" &&
    localRuntime !== "browser-wasm" &&
    localRuntime !== "native-llama-cpp" &&
    localRuntime !== "owner-node" &&
    localRuntime !== "server-local"
  ) {
    throw new Cp2Error(
      400,
      "recall_escalation_invalid",
      "recallEscalation.localRuntime is not supported."
    );
  }
  const reason = parseString(record.reason, "recallEscalation.reason");
  if (reason.length > 80 || !/^[A-Za-z0-9_.-]+$/u.test(reason)) {
    throw new Cp2Error(
      400,
      "recall_escalation_invalid",
      "recallEscalation.reason must be a bounded reason code."
    );
  }
  const localModelId =
    record.localModelId === undefined || record.localModelId === null
      ? undefined
      : parseString(record.localModelId, "recallEscalation.localModelId").slice(0, 120);
  return { localRuntime, reason, ...(localModelId === undefined ? {} : { localModelId }) };
}

function parseRecallEffectivenessBody(body: RecallEffectivenessBody | null | undefined): {
  sourceIds: string[];
  outcome: "local_success" | "cloud_fallback";
  localRuntime: RuntimeRecallEscalation["localRuntime"];
  modelId: string;
} {
  const record = parseRequestBody(body);
  const outcome = parseString(record.outcome, "outcome");
  if (outcome !== "local_success" && outcome !== "cloud_fallback") {
    throw new Cp2Error(
      400,
      "recall_effectiveness_invalid",
      "Recall effectiveness outcome is not supported."
    );
  }
  const localRuntime = parseRuntimeRecallEscalation({
    reason: "effectiveness",
    localRuntime: record.localRuntime
  }).localRuntime;
  return {
    sourceIds: parseStringArray(record.sourceIds, "sourceIds", 3),
    outcome,
    localRuntime,
    modelId: parseString(record.modelId, "modelId")
  };
}

function parseAccountDeletionBody(body: AccountDeletionBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    confirmation: parseString(record.confirmation, "confirmation"),
    reason: parseNullableString(record.reason)
  };
}

function parseVerificationTierBody(body: VerificationTierBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    tier: parseVerificationTier(record.tier),
    evidenceType:
      record.evidenceType === undefined || record.evidenceType === null
        ? null
        : parseVerificationEvidenceType(record.evidenceType),
    note: parseNullableString(record.note)
  };
}

function parseTaxConfigBody(body: TaxConfigBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    countryCode: parseTaxCountryCode(record.countryCode),
    defaultTaxRate: parseNumber(record.defaultTaxRate, "defaultTaxRate"),
    taxId: parseNullableString(record.taxId),
    pricesIncludeTax:
      record.pricesIncludeTax === undefined
        ? false
        : parseBoolean(record.pricesIncludeTax, "pricesIncludeTax")
  };
}

function parseDeviceTrustBody(body: DeviceTrustBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    deviceId: parseString(record.deviceId, "deviceId"),
    level: parseDeviceTrustLevel(record.level),
    reason: parseNullableString(record.reason)
  };
}

function parseBetaAccessBody(body: BetaAccessBody | null | undefined) {
  const record = parseRequestBody(body);
  const invitedMerchantCount =
    record.invitedMerchantCount === undefined
      ? undefined
      : parseNonNegativeInteger(record.invitedMerchantCount, "invitedMerchantCount");

  return {
    status: parseBetaAccessStatus(record.status),
    pauseReason: parseNullableString(record.pauseReason),
    ...(invitedMerchantCount === undefined ? {} : { invitedMerchantCount })
  };
}

function parseBetaFeatureFlagBody(body: BetaFeatureFlagBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    enabled: parseBoolean(record.enabled, "enabled"),
    reason: parseNullableString(record.reason)
  };
}

function parseBetaDeviceTestBody(body: BetaDeviceTestBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    deviceClass: parseBetaDeviceClass(record.deviceClass),
    workflow: parseString(record.workflow, "workflow"),
    status: parseBetaDeviceTestStatus(record.status),
    durationMs: parseNumber(record.durationMs, "durationMs"),
    notes: parseNullableString(record.notes)
  };
}

function parseBetaSupportTicketBody(body: BetaSupportTicketBody | null | undefined) {
  const record = parseRequestBody(body);
  const source = record.source === undefined ? undefined : parseBetaSupportSource(record.source);

  return {
    severity: parseBetaSupportSeverity(record.severity),
    title: parseString(record.title, "title"),
    body: parseNullableString(record.body),
    ...(source === undefined ? {} : { source })
  };
}

function parseBetaSupportTicketStatusBody(body: BetaSupportTicketStatusBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    status: parseBetaSupportTicketStatus(record.status)
  };
}

function parseBetaTelemetryBody(body: BetaTelemetryBody | null | undefined) {
  const record = parseRequestBody(body);
  const metadata =
    record.metadata === undefined ? undefined : parseBetaTelemetryMetadata(record.metadata);

  return {
    kind: parseBetaTelemetryKind(record.kind),
    message: parseNullableString(record.message),
    ...(metadata === undefined ? {} : { metadata })
  };
}

function parseLaunchSettingsBody(body: LaunchSettingsBody | null | undefined) {
  const record = parseRequestBody(body);
  const publicOnboardingEnabled =
    record.publicOnboardingEnabled === undefined
      ? undefined
      : parseBoolean(record.publicOnboardingEnabled, "publicOnboardingEnabled");
  const rollbackArmed =
    record.rollbackArmed === undefined
      ? undefined
      : parseBoolean(record.rollbackArmed, "rollbackArmed");
  const freezeActive =
    record.freezeActive === undefined
      ? undefined
      : parseBoolean(record.freezeActive, "freezeActive");
  const allowedSignupCount =
    record.allowedSignupCount === undefined
      ? undefined
      : parseNumber(record.allowedSignupCount, "allowedSignupCount");

  return {
    status: parseLaunchAccessStatus(record.status),
    ...(publicOnboardingEnabled === undefined ? {} : { publicOnboardingEnabled }),
    ...(rollbackArmed === undefined ? {} : { rollbackArmed }),
    ...(freezeActive === undefined ? {} : { freezeActive }),
    ...(allowedSignupCount === undefined ? {} : { allowedSignupCount }),
    pauseReason: parseNullableString(record.pauseReason)
  };
}

function parseLaunchChecklistBody(key: string, body: LaunchChecklistBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    key: parseLaunchChecklistKey(key),
    status: parseLaunchChecklistStatus(record.status),
    evidence: parseNullableString(record.evidence)
  };
}

function parseLaunchIncidentBody(body: LaunchIncidentBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    severity: parseLaunchIncidentSeverity(record.severity),
    category: parseLaunchIncidentCategory(record.category),
    title: parseString(record.title, "title"),
    body: parseNullableString(record.body)
  };
}

function parseLaunchIncidentStatusBody(body: LaunchIncidentStatusBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    status: parseLaunchIncidentStatus(record.status)
  };
}

function parseVerificationTier(value: unknown): VerificationTier {
  const tier = parseString(value, "tier");

  if (tier === "unverified" || tier === "owner_verified" || tier === "business_verified") {
    return tier;
  }

  throw new Cp2Error(400, "verification_tier_invalid", "Verification tier is not supported.");
}

function parseVerificationEvidenceType(
  value: unknown
): "none" | "owner_attestation" | "business_document" {
  const evidenceType = parseString(value, "evidenceType");

  if (
    evidenceType === "none" ||
    evidenceType === "owner_attestation" ||
    evidenceType === "business_document"
  ) {
    return evidenceType;
  }

  throw new Cp2Error(
    400,
    "verification_evidence_invalid",
    "Verification evidence type is not supported."
  );
}

function parseTaxCountryCode(value: unknown): TaxCountryCode {
  const countryCode = parseString(value, "countryCode");

  if (countryCode === "KE") {
    return countryCode;
  }

  throw new Cp2Error(400, "tax_country_invalid", "Tax country code is not supported.");
}

function parseDeviceTrustLevel(value: unknown): DeviceTrustLevel {
  const level = parseString(value, "level");

  if (level === "unknown" || level === "trusted" || level === "restricted") {
    return level;
  }

  throw new Cp2Error(400, "device_trust_invalid", "Device trust level is not supported.");
}

function parseBetaAccessStatus(value: unknown): BetaAccessStatus {
  const status = parseString(value, "status");

  if (status === "not_invited" || status === "active" || status === "paused") {
    return status;
  }

  throw new Cp2Error(400, "beta_access_invalid", "Beta access status is not supported.");
}

function parseBetaFeatureFlagKey(value: unknown): BetaFeatureFlagKey {
  const key = parseString(value, "featureFlagKey");

  if (
    key === "closed_beta" ||
    key === "offline_hardening" ||
    key === "controlled_payments" ||
    key === "support_intake" ||
    key === "crash_telemetry"
  ) {
    return key;
  }

  throw new Cp2Error(400, "beta_feature_flag_invalid", "Beta feature flag is not supported.");
}

function parseBetaDeviceClass(value: unknown): BetaDeviceClass {
  const deviceClass = parseString(value, "deviceClass");

  if (deviceClass === "android_1gb" || deviceClass === "android_2gb") {
    return deviceClass;
  }

  throw new Cp2Error(400, "beta_device_class_invalid", "Beta device class is not supported.");
}

function parseBetaDeviceTestStatus(value: unknown): BetaDeviceTestStatus {
  const status = parseString(value, "status");

  if (status === "passed" || status === "failed") {
    return status;
  }

  throw new Cp2Error(400, "beta_device_status_invalid", "Beta device status is not supported.");
}

function parseBetaSupportSeverity(value: unknown): BetaSupportSeverity {
  const severity = parseString(value, "severity");

  if (
    severity === "low" ||
    severity === "medium" ||
    severity === "high" ||
    severity === "critical"
  ) {
    return severity;
  }

  throw new Cp2Error(
    400,
    "beta_support_severity_invalid",
    "Beta support severity is not supported."
  );
}

function parseBetaSupportTicketStatus(value: unknown): BetaSupportTicketStatus {
  const status = parseString(value, "status");

  if (status === "open" || status === "triaged" || status === "resolved") {
    return status;
  }

  throw new Cp2Error(400, "beta_support_status_invalid", "Beta support status is not supported.");
}

function parseBetaSupportSource(value: unknown): "merchant" | "operator" {
  const source = parseString(value, "source");

  if (source === "merchant" || source === "operator") {
    return source;
  }

  throw new Cp2Error(400, "beta_support_source_invalid", "Beta support source is not supported.");
}

function parseBetaTelemetryKind(value: unknown): BetaTelemetryKind {
  const kind = parseString(value, "kind");

  if (kind === "session" || kind === "crash" || kind === "error") {
    return kind;
  }

  throw new Cp2Error(400, "beta_telemetry_kind_invalid", "Beta telemetry kind is not supported.");
}

function parseLaunchAccessStatus(value: unknown): LaunchAccessStatus {
  const status = parseString(value, "status");

  if (status === "closed" || status === "open" || status === "paused") {
    return status;
  }

  throw new Cp2Error(400, "launch_status_invalid", "Launch status is not supported.");
}

function parseLaunchChecklistKey(value: unknown): LaunchChecklistKey {
  const key = parseString(value, "checklistKey");

  if (
    key === "environment_config" ||
    key === "secrets_ready" ||
    key === "backup_verified" ||
    key === "monitoring_ready" ||
    key === "deploy_verified" ||
    key === "rollback_runbook" ||
    key === "support_coverage"
  ) {
    return key;
  }

  throw new Cp2Error(400, "launch_checklist_invalid", "Launch checklist key is not supported.");
}

function parseLaunchChecklistStatus(value: unknown): LaunchChecklistStatus {
  const status = parseString(value, "status");

  if (status === "pending" || status === "passed" || status === "failed") {
    return status;
  }

  throw new Cp2Error(
    400,
    "launch_checklist_status_invalid",
    "Launch checklist status is not supported."
  );
}

function parseLaunchIncidentSeverity(value: unknown): LaunchIncidentSeverity {
  const severity = parseString(value, "severity");

  if (
    severity === "low" ||
    severity === "medium" ||
    severity === "high" ||
    severity === "critical"
  ) {
    return severity;
  }

  throw new Cp2Error(
    400,
    "launch_incident_severity_invalid",
    "Launch incident severity is not supported."
  );
}

function parseLaunchIncidentCategory(value: unknown): LaunchIncidentCategory {
  const category = parseString(value, "category");

  if (
    category === "onboarding" ||
    category === "payments" ||
    category === "sync" ||
    category === "support" ||
    category === "telemetry" ||
    category === "rollback"
  ) {
    return category;
  }

  throw new Cp2Error(
    400,
    "launch_incident_category_invalid",
    "Launch incident category is not supported."
  );
}

function parseLaunchIncidentStatus(value: unknown): LaunchIncidentStatus {
  const status = parseString(value, "status");

  if (status === "open" || status === "mitigating" || status === "resolved") {
    return status;
  }

  throw new Cp2Error(
    400,
    "launch_incident_status_invalid",
    "Launch incident status is not supported."
  );
}

function parseBetaTelemetryMetadata(
  value: unknown
): Record<string, string | number | boolean | null> {
  const record = parseRequestBody(value);
  const metadata: Record<string, string | number | boolean | null> = {};

  for (const [key, metadataValue] of Object.entries(record)) {
    if (
      typeof metadataValue === "string" ||
      typeof metadataValue === "number" ||
      typeof metadataValue === "boolean" ||
      metadataValue === null
    ) {
      metadata[key] = metadataValue;
      continue;
    }

    throw new Cp2Error(
      400,
      "beta_telemetry_metadata_invalid",
      "Beta telemetry metadata values must be scalar."
    );
  }

  return metadata;
}

function parseInvoiceItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "items_required", "items is required.");
  }

  return value.map((item, index) => {
    const record = parseRequestBody(item);

    return {
      productId: parseString(record.productId, `items.${index}.productId`),
      quantity: parseNumber(record.quantity, `items.${index}.quantity`),
      unitPrice: parseNumber(record.unitPrice, `items.${index}.unitPrice`)
    };
  });
}

function parseSokoMode(value: unknown): SokoMode {
  if (value === "marketplace" || value === "seller") {
    return value;
  }

  throw new Cp2Error(400, "mode_invalid", "mode must be marketplace or seller.");
}

function parseOptionalSokoMode(value: unknown): SokoMode | undefined {
  return value === undefined ? undefined : parseSokoMode(value);
}

function parseSokoChatSurface(value: unknown): SokoChatSurface {
  if (
    value === "conversation" ||
    value === "storefront" ||
    value === "catalogue" ||
    value === "product" ||
    value === "order" ||
    value === "receipt" ||
    value === "owner-controls"
  ) {
    return value;
  }

  throw new Cp2Error(400, "surface_invalid", "activeSurface is not supported.");
}

function parseOptionalSokoChatSurface(value: unknown): SokoChatSurface | undefined {
  return value === undefined ? undefined : parseSokoChatSurface(value);
}

function parseOptionalNullableString(value: unknown): string | null | undefined {
  return value === undefined ? undefined : parseNullableString(value);
}

function parseConversationKind(value: unknown): ConversationKind {
  if (value === "personal" || value === "storefront" || value === "order") {
    return value;
  }

  throw new Cp2Error(400, "conversation_kind_invalid", "Conversation kind is not supported.");
}

function parseConversationMessageContent(value: unknown): ConversationMessageContent {
  const content = parseRequestBody(value);
  const type = parseString(content.type, "content.type");

  if (type === "text") {
    const attachments = content.attachments;
    if (attachments !== undefined && !Array.isArray(attachments)) {
      throw new Cp2Error(400, "message_content_invalid", "content.attachments must be an array.");
    }
    return {
      type,
      text: parseString(content.text, "content.text"),
      ...(Array.isArray(attachments)
        ? {
            attachments: attachments.map((value, index) => {
              const attachment = parseRequestBody(value);
              const category = parseString(
                attachment.category,
                `content.attachments[${index}].category`
              );
              if (!["document", "image", "video", "audio", "other"].includes(category)) {
                throw new Cp2Error(
                  400,
                  "message_content_invalid",
                  "Attachment category is not supported."
                );
              }
              return {
                id: parseString(attachment.id, `content.attachments[${index}].id`),
                name: parseString(attachment.name, `content.attachments[${index}].name`),
                mimeType: parseString(
                  attachment.mimeType,
                  `content.attachments[${index}].mimeType`
                ),
                size: parseNonNegativeInteger(
                  attachment.size,
                  `content.attachments[${index}].size`
                ),
                category: category as "document" | "image" | "video" | "audio" | "other",
                url: parseString(attachment.url, `content.attachments[${index}].url`)
              };
            })
          }
        : {})
    };
  }

  if (type === "encrypted") {
    if (!Array.isArray(content.envelopes)) {
      throw new Cp2Error(400, "message_content_invalid", "content.envelopes must be an array.");
    }
    return {
      type,
      attachmentCount: parseNonNegativeInteger(content.attachmentCount, "content.attachmentCount"),
      iv: parseString(content.iv, "content.iv"),
      ciphertext: parseString(content.ciphertext, "content.ciphertext"),
      envelopes: content.envelopes.map((value, index) => {
        const envelope = parseRequestBody(value);
        return {
          version: parsePositiveInteger(
            envelope.version,
            `content.envelopes[${index}].version`
          ) as 1,
          algorithm: parseString(
            envelope.algorithm,
            `content.envelopes[${index}].algorithm`
          ) as "ECDH-P256-HKDF-SHA256-AES-256-GCM",
          recipientDeviceId: parseString(
            envelope.recipientDeviceId,
            `content.envelopes[${index}].recipientDeviceId`
          ),
          ephemeralPublicKey: parseE2eePublicKey(
            envelope.ephemeralPublicKey,
            `content.envelopes[${index}].ephemeralPublicKey`
          ),
          salt: parseString(envelope.salt, `content.envelopes[${index}].salt`),
          iv: parseString(envelope.iv, `content.envelopes[${index}].iv`),
          ciphertext: parseString(envelope.ciphertext, `content.envelopes[${index}].ciphertext`)
        };
      })
    };
  }

  if (type === "storefront" || type === "owner-controls") {
    return { type, shopId: parseString(content.shopId, "content.shopId") };
  }

  if (type === "confirmation") {
    return {
      type,
      confirmationToken: parseString(content.confirmationToken, "content.confirmationToken"),
      prompt: parseString(content.prompt, "content.prompt")
    };
  }

  throw new Cp2Error(400, "message_content_invalid", "Message content type is not supported.");
}

function parseE2eePublicKey(value: unknown, field: string): E2eePublicKey {
  const key = parseRequestBody(value);
  return {
    kty: parseString(key.kty, `${field}.kty`) as "EC",
    crv: parseString(key.crv, `${field}.crv`) as "P-256",
    x: parseString(key.x, `${field}.x`),
    y: parseString(key.y, `${field}.y`),
    ...(typeof key.ext === "boolean" ? { ext: key.ext } : {}),
    ...(Array.isArray(key.key_ops)
      ? {
          key_ops: key.key_ops.map((item, index) => parseString(item, `${field}.key_ops[${index}]`))
        }
      : {})
  };
}

function parseShopPresenceStatus(value: unknown): ShopPresenceStatus {
  if (value === "online" || value === "private" || value === "offline") return value;
  throw new Cp2Error(400, "presence_status_invalid", "Presence status is invalid.");
}

function parsePublicCustomerCareType(value: unknown): PublicCustomerCareRequestType {
  if (
    value === "callback" ||
    value === "quote" ||
    value === "support" ||
    value === "registration"
  ) {
    return value;
  }
  throw new Cp2Error(400, "customer_care_type_invalid", "Customer-care request type is invalid.");
}

function parseBuySourceKind(value: unknown): BuyResultSourceKind {
  if (value === "contact" || value === "catalogue" || value === "marketplace_connector") {
    return value;
  }
  throw new Cp2Error(400, "buy_source_kind_invalid", "Checkout item source is invalid.");
}

function parseBuyCheckoutItems(value: unknown): BuyCheckoutItemInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Cp2Error(400, "buy_checkout_items_invalid", "Checkout needs between 1 and 100 items.");
  }
  return value.map((raw, index) => {
    const item = parseRequestBody(raw);
    return {
      sourceKind: parseBuySourceKind(item.sourceKind),
      sourceId: parseString(item.sourceId, `items[${index}].sourceId`),
      sourceLabel: parseString(item.sourceLabel, `items[${index}].sourceLabel`),
      title: parseString(item.title, `items[${index}].title`),
      quantity: parseNumber(item.quantity, `items[${index}].quantity`),
      agentId: parseNullableString(item.agentId ?? null),
      productId: parseNullableString(item.productId ?? null),
      statusBroadcastId: parseNullableString(item.statusBroadcastId ?? null),
      productCaptureItemId: parseNullableString(item.productCaptureItemId ?? null)
    };
  });
}

function parseTrustedMessageAttachmentReferences(
  value: unknown
): TrustedMessageAttachmentReference[] {
  if (!Array.isArray(value) || value.length > 3) {
    throw new Cp2Error(
      400,
      "EMAIL_ATTACHMENT_UNAVAILABLE",
      "Email attachments must contain at most three trusted resource references."
    );
  }
  return value.map((item, index) => {
    const record = parseRequestBody(item);
    const resourceType = parseString(record.resourceType, `attachments[${index}].resourceType`);
    if (resourceType !== "invoice") {
      throw new Cp2Error(
        400,
        "EMAIL_ATTACHMENT_UNAVAILABLE",
        "Only trusted invoice resources can currently be attached to email."
      );
    }
    return {
      resourceType,
      resourceId: parseString(record.resourceId, `attachments[${index}].resourceId`)
    };
  });
}

function parseNetworkInviteContacts(value: unknown): Array<{
  name: string;
  phone: string | null;
  email: string | null;
}> {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "contacts_required", "contacts is required.");
  }
  return value.map((item, index) => {
    const record = parseRequestBody(item);
    return {
      name: parseString(record.name, `contacts[${index}].name`),
      phone: parseNullableString(record.phone),
      email: parseNullableString(record.email)
    };
  });
}

function parsePublicOrderItems(value: unknown): Array<{ productId: string; quantity: number }> {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "order_items_required", "Order items are required.");
  }
  return value.map((item, index) => {
    const record = parseRequestBody(item);
    return {
      productId: parseString(record.productId, `items[${index}].productId`),
      quantity: parsePositiveInteger(record.quantity, `items[${index}].quantity`)
    };
  });
}

function parseOwnerInferenceRequest(value: unknown): InferenceRequest {
  const body = parseRequestBody(value);
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 100) {
    throw new Cp2Error(400, "inference_messages_invalid", "Inference messages are invalid.");
  }
  const messages = body.messages.map((item, index) => {
    const message = parseRequestBody(item);
    const role = message.role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new Cp2Error(
        400,
        "inference_message_role_invalid",
        `messages[${index}].role is invalid.`
      );
    }
    const content = parseString(message.content, `messages[${index}].content`);
    if (content.length > 32_000) {
      throw new Cp2Error(
        400,
        "inference_message_too_large",
        `messages[${index}].content is too large.`
      );
    }
    return { role, content } satisfies InferenceRequest["messages"][number];
  });
  const request: InferenceRequest = {
    requestId: parseString(body.requestId, "requestId"),
    tenantId: parseString(body.tenantId, "tenantId"),
    conversationId: parseString(body.conversationId, "conversationId"),
    agentId: parseString(body.agentId, "agentId"),
    modelId: parseString(body.modelId, "modelId"),
    messages
  };
  if (typeof body.systemPrompt === "string") request.systemPrompt = body.systemPrompt;
  if (body.maxTokens !== undefined) {
    request.maxTokens = Math.min(512, parsePositiveInteger(body.maxTokens, "maxTokens"));
  }
  if (typeof body.temperature === "number" && Number.isFinite(body.temperature)) {
    request.temperature = Math.max(0, Math.min(2, body.temperature));
  }
  if (
    body.taskType === "conversation" ||
    body.taskType === "reasoning" ||
    body.taskType === "coding" ||
    body.taskType === "verification"
  ) {
    request.taskType = body.taskType;
  }
  return request;
}

function parseInstalledModelBody(
  body: InstalledModelBody
): Omit<InstalledAgentModelSummary, "accountId" | "userId"> {
  return {
    id: parseString(body.id, "id"),
    deviceId: parseString(body.deviceId, "deviceId"),
    modelId: parseString(body.modelId, "modelId"),
    displayName: parseString(body.displayName, "displayName"),
    provider: parseModelProvider(body.provider),
    repositoryId: parseNullableString(body.repositoryId),
    filename: parseString(body.filename, "filename"),
    format: parseModelFormat(body.format),
    quantization: parseNullableString(body.quantization),
    architecture: parseNullableString(body.architecture),
    parameterCount: parseNullablePositiveInteger(body.parameterCount, "parameterCount"),
    contextLength: parseNullablePositiveInteger(body.contextLength, "contextLength"),
    fileSizeBytes: parsePositiveInteger(body.fileSizeBytes, "fileSizeBytes"),
    checksum: parseNullableString(body.checksum),
    packageManifestVersion: parseNullableString(body.packageManifestVersion),
    packageSignature: parseNullableString(body.packageSignature),
    packageSigningKeyId: parseNullableString(body.packageSigningKeyId),
    license: parseString(body.license, "license"),
    commercialUseAllowed: parseBoolean(body.commercialUseAllowed, "commercialUseAllowed"),
    storageKey: parseString(body.storageKey, "storageKey"),
    runtimeBackend: parseAgentModelRuntimeBackend(body.runtimeBackend),
    installationStatus: parseModelInstallationStatus(body.installationStatus),
    compatibilityStatus: parseModelCompatibilityStatus(body.compatibilityStatus),
    installedAt: parseIsoTimestamp(body.installedAt, "installedAt"),
    lastVerifiedAt:
      body.lastVerifiedAt === null
        ? null
        : parseIsoTimestamp(body.lastVerifiedAt, "lastVerifiedAt"),
    validationError: parseNullableString(body.validationError)
  };
}

function parseModelProvider(value: unknown): InstalledAgentModelSummary["provider"] {
  if (value === "huggingface" || value === "github" || value === "custom") return value;
  throw new Cp2Error(400, "model_provider_invalid", "Model provider is invalid.");
}

function parseModelFormat(value: unknown): "GGUF" {
  if (value === "GGUF") return value;
  throw new Cp2Error(400, "model_format_invalid", "Only GGUF models are supported.");
}

function parseModelInstallationStatus(value: unknown): ModelInstallationStatus {
  if (
    value === "DOWNLOADING" ||
    value === "INSTALLED" ||
    value === "CORRUPT" ||
    value === "REMOVED" ||
    value === "FAILED"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_installation_status_invalid", "Installation status is invalid.");
}

function parseModelCompatibilityStatus(value: unknown): ModelCompatibilityStatus {
  if (
    value === "UNKNOWN" ||
    value === "COMPATIBLE" ||
    value === "INCOMPATIBLE" ||
    value === "INSUFFICIENT_MEMORY" ||
    value === "UNSUPPORTED_ARCHITECTURE" ||
    value === "UNSUPPORTED_QUANTIZATION"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_compatibility_status_invalid", "Compatibility status is invalid.");
}

function parseAgentModelRuntimeBackend(value: unknown): AgentModelRuntimeBackend {
  if (
    value === "LLAMA_CPP_ANDROID" ||
    value === "LLAMA_CPP_BROWSER" ||
    value === "OLLAMA" ||
    value === "CLOUD"
  ) {
    return value;
  }
  throw new Cp2Error(400, "model_runtime_backend_invalid", "Runtime backend is invalid.");
}

function parsePreferredExecutionMode(value: unknown): PreferredExecutionMode {
  if (value === "LOCAL_ONLY" || value === "LOCAL_FIRST" || value === "CLOUD_ONLY") return value;
  throw new Cp2Error(400, "execution_mode_invalid", "Execution mode is invalid.");
}

function parseAgentModelFallbackPolicy(value: unknown): AgentModelFallbackPolicy {
  if (
    value === "NEVER" ||
    value === "WHEN_LOCAL_UNAVAILABLE" ||
    value === "WHEN_LOCAL_FAILS" ||
    value === "WHEN_CONTEXT_EXCEEDED"
  ) {
    return value;
  }
  throw new Cp2Error(400, "fallback_policy_invalid", "Fallback policy is invalid.");
}

function parseModelExecutionTarget(value: unknown): ModelExecutionTarget {
  if (
    value === "backend" ||
    value === "browser-local" ||
    value === "installed-app" ||
    value === "remote-shop-device" ||
    value === "openai"
  ) {
    return value;
  }
  throw new Cp2Error(400, "execution_target_invalid", "Execution target is invalid.");
}

function parseAgentModelBindingPermissions(value: unknown): AgentModelBindingPermissions {
  const permissions = parseRequestBody(value);
  return {
    allowInstalledApp: parseBoolean(permissions.allowInstalledApp, "permissions.allowInstalledApp"),
    allowRemoteShopDevice: parseBoolean(
      permissions.allowRemoteShopDevice,
      "permissions.allowRemoteShopDevice"
    ),
    allowOpenAIFallback: parseBoolean(
      permissions.allowOpenAIFallback,
      "permissions.allowOpenAIFallback"
    )
  };
}

function parseAgentModelReadinessStatus(value: unknown): AgentModelReadinessStatus {
  if (value === "ATTACHED" || value === "LOADING" || value === "READY" || value === "FAILED") {
    return value;
  }
  throw new Cp2Error(400, "model_readiness_status_invalid", "Readiness status is invalid.");
}

function parseBrowserDeviceTier(value: unknown): BrowserDeviceTier | null {
  if (value === null || value === undefined) return null;
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Cp2Error(400, "browser_device_tier_invalid", "Browser device tier is invalid.");
}

function parseBrowserRuntimeContract(value: unknown): BrowserRuntimeContract | null {
  if (value === null || value === undefined) return null;
  const contract = parseRequestBody(value);
  if (
    contract.schemaVersion !== 1 ||
    (contract.adapterId !== "transformers-js" && contract.adapterId !== "webllm") ||
    (contract.runtime !== "browser-webgpu" && contract.runtime !== "browser-wasm") ||
    (contract.backend !== "webgpu" && contract.backend !== "wasm") ||
    contract.streaming !== true ||
    contract.cancellation !== true ||
    (contract.tokenCounting !== "exact" && contract.tokenCounting !== "estimated") ||
    !Array.isArray(contract.checkpointKinds) ||
    contract.checkpointKinds.some(
      (kind) => kind !== "task-state" && kind !== "token-replay" && kind !== "native-kv"
    ) ||
    (contract.nativeStateFormat !== null && typeof contract.nativeStateFormat !== "string")
  ) {
    throw new Cp2Error(
      400,
      "browser_runtime_contract_invalid",
      "Browser runtime contract is invalid."
    );
  }
  return {
    schemaVersion: 1,
    adapterId: contract.adapterId,
    adapterVersion: parseString(contract.adapterVersion, "runtimeContract.adapterVersion"),
    libraryRevision: parseNullableString(contract.libraryRevision),
    runtime: contract.runtime,
    backend: contract.backend,
    streaming: true,
    cancellation: true,
    tokenCounting: contract.tokenCounting,
    checkpointKinds: [...contract.checkpointKinds] as BrowserRuntimeContract["checkpointKinds"],
    nativeStateFormat: parseNullableString(contract.nativeStateFormat)
  };
}

function parseBrowserCheckpointContract(
  value: unknown
): BrowserCheckpointCompatibilityContract | null {
  if (value === null || value === undefined) return null;
  const contract = parseRequestBody(value);
  if (
    contract.schemaVersion !== 1 ||
    contract.checkpointKind !== "task-state" ||
    contract.taskStateSchema !== "soko.browser-task-state.v2" ||
    (contract.sourceAdapterId !== "transformers-js" && contract.sourceAdapterId !== "webllm") ||
    contract.promptRepresentation !== "role-content-messages" ||
    contract.portableAcrossAdapters !== true
  ) {
    throw new Cp2Error(
      400,
      "browser_checkpoint_contract_invalid",
      "Browser checkpoint compatibility contract is invalid."
    );
  }
  return {
    schemaVersion: 1,
    checkpointKind: "task-state",
    taskStateSchema: "soko.browser-task-state.v2",
    modelFamilyId: parseString(contract.modelFamilyId, "checkpointContract.modelFamilyId"),
    sourceModelId: parseString(contract.sourceModelId, "checkpointContract.sourceModelId"),
    sourceModelRevision: parseString(
      contract.sourceModelRevision,
      "checkpointContract.sourceModelRevision"
    ),
    sourceAdapterId: contract.sourceAdapterId,
    promptRepresentation: "role-content-messages",
    portableAcrossAdapters: true
  };
}

function parseNullablePositiveInteger(value: unknown, name: string): number | null {
  return value === null ? null : parsePositiveInteger(value, name);
}

function parseOptionalPermission(value: string | undefined): BusinessPermission | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (businessPermissions.includes(value as BusinessPermission)) {
    return value as BusinessPermission;
  }

  throw new Cp2Error(400, "permission_invalid", "Permission is not supported.");
}

const businessPermissions: BusinessPermission[] = [
  "business:create",
  "business:read",
  "membership:read",
  "membership:manage",
  "product:read",
  "product:write",
  "customer:read",
  "customer:write",
  "supplier:read",
  "supplier:write",
  "inventory:adjust",
  "invoice:read",
  "invoice:write",
  "invoice:confirm",
  "payment:read",
  "payment:write",
  "logistics:read",
  "logistics:write",
  "import:read",
  "import:write",
  "report:read",
  "notification:read",
  "notification:write",
  "compliance:read",
  "compliance:export",
  "compliance:delete",
  "verification:read",
  "verification:write",
  "tax:read",
  "tax:write",
  "device_trust:read",
  "device_trust:write",
  "beta:read",
  "beta:write",
  "beta:support",
  "beta:telemetry",
  "launch:read",
  "launch:write",
  "launch:support"
];

function observeRequestAbort(
  request: FastifyRequest,
  reply: FastifyReply
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("The HTTP client disconnected."));
  const abortIfResponseClosed = () => {
    if (!reply.raw.writableEnded) abort();
  };
  if (request.raw.aborted) {
    abort();
  } else {
    request.raw.once("aborted", abort);
    reply.raw.once("close", abortIfResponseClosed);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.off("aborted", abort);
      reply.raw.off("close", abortIfResponseClosed);
    }
  };
}

