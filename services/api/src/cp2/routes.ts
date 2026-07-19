import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { isPaymentMethod, type BusinessPermission } from "@soko/business-core";
import type {
  AuthChannel,
  BusinessNotificationStatus,
  BetaAccessStatus,
  BetaDeviceClass,
  BetaDeviceTestStatus,
  BetaFeatureFlagKey,
  BetaSupportSeverity,
  BetaSupportTicketStatus,
  BetaTelemetryKind,
  DeviceTrustLevel,
  FulfillmentMethod,
  FulfillmentStatus,
  LaunchAccessStatus,
  LaunchChecklistKey,
  LaunchChecklistStatus,
  LaunchIncidentCategory,
  LaunchIncidentSeverity,
  LaunchIncidentStatus,
  MessageHandoffStatus,
  ProductFieldDefinition,
  ProductFieldInputType,
  ProductImportDraft,
  PublicCustomerCareRequestType,
  ShopPresenceStatus,
  SocialNetworkProvider,
  SupplierImportDraft,
  TaxCountryCode,
  SyncMutationPayload,
  SyncMutationType,
  ConversationKind,
  ConversationMessageContent,
  E2eePublicKey,
  MessageChannel,
  SokoChatSurface,
  SokoMode,
  SyncRealtimeReadyEvent,
  VerificationTier
} from "@soko/shared-types";
import { isSyncMutationType } from "@soko/sync-core";
import {
  clearSessionCookie,
  Cp2Error,
  createCp2Store,
  isSupportedLanguage,
  readSessionCookie,
  serializeSessionCookie,
  type BusinessAgentProfileInput,
  type Cp2Store,
  type PhoneContactNetworkInput,
  type RuntimeAgentProfile,
  type SocialProfileNetworkInput
} from "./store.js";
import { createEmailProviderFromEnvironment, type EmailProvider } from "./email-provider.js";
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
  parseOAuthProvider,
  type OAuthProfile,
  type OAuthTokenResponse
} from "./oauth.js";
import {
  extractDocumentImportSource,
  extractUploadedDocument,
  type DocumentUploadInput
} from "./document-extraction.js";
import type { ReceiptOCRExtractionResult, ReceiptOCRProcessor } from "./receipt-ocr-provider.js";
import type { BinaryUploadPipeline } from "./binary-upload-pipeline.js";

export interface Cp2RouteOptions {
  binaryUploadPipeline?: BinaryUploadPipeline;
  emailProvider?: EmailProvider;
  githubModelCatalog?: GitHubModelCatalog;
  huggingFaceModelCatalog?: HuggingFaceModelCatalog;
  oauthAllowedRedirectOrigins?: string[];
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

type OtpDeliveryChannel = "email" | "sms";

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
  profile?: {
    providerSubject?: string;
    email?: string | null;
    emailVerified?: boolean;
    displayName?: string | null;
  };
  provider?: string;
  state?: string;
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scope?: string;
  };
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

interface PinBody {
  pin?: string;
}

interface PinLoginBody extends PinBody {
  channel?: string;
  contact?: string;
  destination?: string;
  method?: string;
}

interface PhonePinRecoveryBody extends PinLoginBody {
  recoveryCode?: string;
}

interface PasskeyRegistrationVerifyBody {
  ceremonyId?: string;
  label?: string;
  response?: RegistrationResponseJSON;
}

interface PasskeyAuthenticationVerifyBody {
  ceremonyId?: string;
  response?: AuthenticationResponseJSON;
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

interface BusinessParams {
  businessId: string;
}

interface StorefrontParams {
  agentId: string;
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
  visitorId?: string;
  body?: string;
  attachmentNames?: string[];
}

interface PublicOrderBody {
  visitorId?: string;
  customerName?: string;
  phone?: string;
  note?: string | null;
  items?: Array<{ productId?: string; quantity?: number }>;
}

interface ProductParams extends BusinessParams {
  productId: string;
}

interface CustomerParams extends BusinessParams {
  customerId: string;
}

interface SupplierParams extends BusinessParams {
  supplierId: string;
}

interface SalesAgentParams extends BusinessParams {
  salesAgentId: string;
}

interface SupplierSalesAgentParams extends SupplierParams {
  salesAgentId: string;
}

interface ReceiptOCRParams extends BusinessParams {
  ocrJobId: string;
}

interface PurchaseReceiptParams extends BusinessParams {
  receiptId: string;
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

interface NotificationParams extends BusinessParams {
  notificationId: string;
}

interface LogisticsParams extends BusinessParams {
  logisticsId: string;
}

interface DocumentImportParams extends BusinessParams {
  importJobId: string;
}

interface DocumentImportRowParams extends DocumentImportParams {
  rowNumber: string;
}

interface PaymentParams extends BusinessParams {
  invoiceId: string;
}

interface ProductBody {
  name?: string;
  sku?: string | null;
  unit?: string | null;
  quantity?: number;
  buyingPrice?: number | null;
  sellingPrice?: number | null;
}

interface ProductFieldStructureBody {
  fields?: unknown[];
}

interface ContactRecordBody {
  name?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

interface PhonebookSearchQuery {
  q?: string;
}

interface PhonebookLinkBody {
  networkNodeId?: string;
  notes?: string | null;
}

interface ReceiptOCRBody {
  fileName?: string;
  contentType?: string;
  contentBase64?: string;
  extractedText?: string;
  fileSizeBytes?: number;
  fileSignature?: string;
}

interface ReceiptOCRConfirmBody {
  supplierId?: string | null;
  salesAgentId?: string | null;
  createSupplier?: boolean;
  createSalesAgent?: boolean;
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

interface LogisticsBody {
  invoiceId?: string;
  method?: string;
  destination?: string | null;
  note?: string | null;
}

interface LogisticsStatusBody {
  status?: string;
  note?: string | null;
}

interface SyncMutationBody {
  idempotencyKey?: string;
  mutationType?: string;
  clientCreatedAt?: string;
  payload?: unknown;
}

interface SupplierCsvImportBody {
  fileName?: string;
  contentType?: string | null;
  content?: string;
  contentBase64?: string;
  sourceType?: string;
  sourceLocator?: string | null;
}

interface ProductCatalogueImportBody {
  fileName?: string;
  contentType?: string | null;
  content?: string;
  contentBase64?: string;
  sourceType?: string;
  sourceLocator?: string | null;
}

interface SupplierImportRowBody {
  mapped?: Partial<SupplierImportDraft>;
  selected?: boolean;
}

interface ProductImportRowBody {
  mapped?: Partial<ProductImportDraft>;
  selected?: boolean;
}

interface NetworkConnectionBody {
  name?: string;
  phone?: string | null;
  email?: string | null;
  providerSubject?: string | null;
  handle?: string | null;
}

interface PhoneContactNetworkBody extends NetworkConnectionBody {
  connections?: NetworkConnectionBody[];
}

interface SocialProfileNetworkBody extends NetworkConnectionBody {
  relationship?: "followed" | "follower" | "interaction" | "message";
  connections?: NetworkConnectionBody[];
}

interface NetworkContactsSyncBody {
  contacts?: PhoneContactNetworkBody[];
  sourceName?: string;
}

interface NetworkSocialSyncBody {
  profiles?: SocialProfileNetworkBody[];
  sourceName?: string;
}

interface NetworkRouteBody {
  requestText?: string;
  targetNodeId?: string | null;
}

interface NetworkRouteParams {
  routeId: string;
}

interface NetworkSourceParams {
  sourceId: string;
}

interface NetworkSocialParams {
  provider: string;
}

interface NetworkProviderSyncParams {
  provider: string;
}

interface SupplierImportConfirmBody {
  selectedRowNumbers?: number[];
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
}

interface NotificationStatusBody {
  status?: string;
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

  function passkeyRelyingParty(request: FastifyRequest): { origin: string; rpId: string } {
    const origin = request.headers.origin;

    if (origin === undefined || !realtimeAllowedOrigins.has(origin)) {
      throw new Cp2Error(
        403,
        "passkey_origin_not_allowed",
        "Passkeys are not available from this origin."
      );
    }

    const url = new URL(origin);
    const configuredRpId = process.env.WEBAUTHN_RP_ID?.trim();
    const rpId =
      configuredRpId && configuredRpId.length > 0
        ? configuredRpId
        : url.hostname.startsWith("www.")
          ? url.hostname.slice(4)
          : url.hostname;

    return { origin: url.origin, rpId };
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
    parseOtpDeliveryChannel(body.deliveryChannel, channel);
    const purpose = parseOtpPurpose(body.purpose);

    if (channel === "phone") {
      throw new Cp2Error(403, "phone_pin_only", "Phone accounts use PIN-only signup and login.");
    }

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
    tokens?: OAuthCallbackBody["tokens"];
    profile?: OAuthCallbackBody["profile"];
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
    const bodyTokens = parseOptionalOAuthTokens(input.tokens);
    const tokens =
      bodyTokens ??
      (await exchangeOAuthCode({
        provider: providerConfig,
        code: parseString(input.code, "code"),
        codeVerifier: exchangeData.codeVerifier,
        redirectUri: exchangeData.redirectUri
      }));
    const profile =
      input.profile === undefined
        ? await fetchOAuthProfile({ provider: providerConfig, tokens })
        : parseOAuthProfileBody(input.profile);
    return store.completeOAuthCallback({
      provider,
      state,
      csrfToken,
      profile,
      tokens
    });
  }

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
    "/auth/phone/request-otp",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody({ ...request.body, method: "phone" });
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
    "/auth/whatsapp/request-otp",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody({
          ...request.body,
          method: "phone",
          deliveryChannel: "whatsapp"
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/phone/request-otp",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody({ ...request.body, method: "phone" });
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

  app.post(
    "/api/auth/whatsapp/request-otp",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        return await requestOtpForBody({
          ...request.body,
          method: "phone",
          deliveryChannel: "whatsapp"
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/otp/verify", async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
    try {
      const result = await verifyOtpForBody(request.body);
      reply.header("set-cookie", serializeSessionCookie(result.session.id));
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/phone/verify-otp",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody({ ...request.body, method: "phone" });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/otp/verify",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody(request.body);
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
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
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/whatsapp/verify-otp",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody({ ...request.body, method: "phone" });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/phone/verify-otp",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody({ ...request.body, method: "phone" });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
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
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/whatsapp/verify-otp",
    async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
      try {
        const result = await verifyOtpForBody({ ...request.body, method: "phone" });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/passkeys/register/options", async (request, reply) => {
    try {
      const relyingParty = passkeyRelyingParty(request);
      return await store.beginPasskeyRegistration({
        sessionId: readSessionCookie(request.headers.cookie),
        rpId: relyingParty.rpId
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/passkeys/register/verify",
    async (request: FastifyRequest<{ Body: PasskeyRegistrationVerifyBody }>, reply) => {
      try {
        const relyingParty = passkeyRelyingParty(request);
        const label = parseOptionalString(request.body.label);
        return await store.completePasskeyRegistration({
          sessionId: readSessionCookie(request.headers.cookie),
          ceremonyId: parseString(request.body.ceremonyId, "ceremonyId"),
          ...(label === undefined ? {} : { label }),
          origin: relyingParty.origin,
          rpId: relyingParty.rpId,
          response: parsePasskeyResponse<RegistrationResponseJSON>(request.body.response)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/passkeys/login/options", async (request, reply) => {
    try {
      const relyingParty = passkeyRelyingParty(request);
      return await store.beginPasskeyAuthentication({
        rpId: relyingParty.rpId
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/auth/passkeys/login/verify",
    async (request: FastifyRequest<{ Body: PasskeyAuthenticationVerifyBody }>, reply) => {
      try {
        const relyingParty = passkeyRelyingParty(request);
        const result = await store.completePasskeyAuthentication({
          ceremonyId: parseString(request.body.ceremonyId, "ceremonyId"),
          origin: relyingParty.origin,
          rpId: relyingParty.rpId,
          response: parsePasskeyResponse<AuthenticationResponseJSON>(request.body.response)
        });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/auth/passkeys", async (request, reply) => {
    try {
      return {
        passkeys: store.listPasskeys({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.delete(
    "/auth/passkeys/:credentialId",
    async (request: FastifyRequest<{ Params: { credentialId: string } }>, reply) => {
      try {
        return store.revokePasskey({
          sessionId: readSessionCookie(request.headers.cookie),
          credentialId: parseString(request.params.credentialId, "credentialId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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
          code: request.body.code,
          tokens: request.body.tokens,
          profile: request.body.profile
        });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
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
          code: request.body.code,
          tokens: request.body.tokens,
          profile: request.body.profile
        });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
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
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
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
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
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

  app.post("/auth/pin/signup", async (request: FastifyRequest<{ Body: PinLoginBody }>, reply) => {
    try {
      const channel = parseAuthChannel(request.body.method ?? request.body.channel ?? "phone");

      if (channel !== "phone") {
        throw new Cp2Error(400, "phone_pin_signup_only", "PIN signup requires a phone number.");
      }

      const result = store.signupWithPhonePin({
        destination: parseString(request.body.contact ?? request.body.destination, "contact"),
        pin: parseString(request.body.pin, "pin")
      });
      reply.header("set-cookie", serializeSessionCookie(result.session.id));
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

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
      const result = store.loginWithAccountPin({
        channel: parseAuthChannel(request.body.method ?? request.body.channel),
        destination: parseString(request.body.contact ?? request.body.destination, "contact"),
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
      reply.header("set-cookie", serializeSessionCookie(result.session.id));
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

  app.post(
    "/auth/pin/recover/phone",
    async (request: FastifyRequest<{ Body: PhonePinRecoveryBody }>, reply) => {
      try {
        const result = store.recoverPhoneAccountPin({
          destination: parseString(request.body.contact ?? request.body.destination, "contact"),
          recoveryCode: parseString(request.body.recoveryCode, "recoveryCode"),
          pin: parseString(request.body.pin, "pin")
        });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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
        return store.updateSokoSessionContext({
          sessionId: readSessionCookie(request.headers.cookie),
          mode: parseSokoMode(request.body.mode),
          activeShopId: parseNullableString(request.body.activeShopId),
          activeSurface: parseSokoChatSurface(request.body.activeSurface),
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
        const processed = await store.createAgentConversationMessage({
          ...messageInput,
          businessId: parseString(agent.businessId, "agent.businessId"),
          message: runtime.message,
          ...(runtime.runtimeSessionId === undefined
            ? {}
            : { runtimeSessionId: runtime.runtimeSessionId }),
          ...(runtime.agentProfile === undefined ? {} : { agentProfile: runtime.agentProfile })
        });
        const modelPromptEvent = processed.runtime?.turn.telemetry.find(
          (event) => event.state === "model.prompt_built"
        );
        request.log.info(
          {
            correlationId: processed.processing.correlationId,
            tenantId: parseString(agent.businessId, "agent.businessId"),
            conversationId: processed.message.conversationId,
            messageId: processed.message.id,
            agentId: processed.agentMessage?.authorId ?? null,
            modelId: modelPromptEvent?.metadata.modelProfile ?? null,
            provider: processed.runtime?.turn.model?.provider ?? null,
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

  app.post(
    "/v1/message-handoffs",
    async (request: FastifyRequest<{ Body: MessageHandoffBody }>, reply) => {
      try {
        const channel = parseString(request.body.channel, "channel");
        if (channel !== "sms_external_app") {
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
    reply.header("set-cookie", clearSessionCookie());
    return {
      revoked
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const revoked = store.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", clearSessionCookie());
    return {
      revoked
    };
  });

  app.post("/auth/logout-all", async (request, reply) => {
    const result = store.logoutAll(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", clearSessionCookie());
    return result;
  });

  app.post("/api/auth/logout-all", async (request, reply) => {
    const result = store.logoutAll(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", clearSessionCookie());
    return result;
  });

  app.post(
    "/network/sync/contacts",
    async (request: FastifyRequest<{ Body: NetworkContactsSyncBody }>, reply) => {
      try {
        const sourceName = parseOptionalString(request.body.sourceName);
        return store.syncPhoneContacts({
          sessionId: readSessionCookie(request.headers.cookie),
          contacts: parsePhoneContactNetworkBodies(request.body.contacts),
          ...(sourceName === undefined ? {} : { sourceName })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/sync/social/:provider",
    async (
      request: FastifyRequest<{ Params: NetworkSocialParams; Body: NetworkSocialSyncBody }>,
      reply
    ) => {
      try {
        const sourceName = parseOptionalString(request.body.sourceName);
        return store.syncSocialNetwork({
          sessionId: readSessionCookie(request.headers.cookie),
          provider: parseNetworkSocialProvider(request.params.provider),
          profiles: parseSocialProfileNetworkBodies(request.body.profiles),
          ...(sourceName === undefined ? {} : { sourceName })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/providers/:provider/sync",
    async (request: FastifyRequest<{ Params: NetworkProviderSyncParams }>, reply) => {
      try {
        return store.syncConnectedSocialProvider({
          sessionId: readSessionCookie(request.headers.cookie),
          provider: parseNetworkSocialProvider(request.params.provider)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get("/network", async (request, reply) => {
    try {
      return store.getNetworkGraph({
        sessionId: readSessionCookie(request.headers.cookie)
      });
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/network/direct", async (request, reply) => {
    try {
      return {
        nodes: store.getDirectNetwork({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/network/extended", async (request, reply) => {
    try {
      return {
        nodes: store.getExtendedNetwork({
          sessionId: readSessionCookie(request.headers.cookie)
        })
      };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.post(
    "/network/routes",
    async (request: FastifyRequest<{ Body: NetworkRouteBody }>, reply) => {
      try {
        return store.createAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          requestText: parseString(request.body.requestText, "requestText"),
          targetNodeId: parseNullableString(request.body.targetNodeId)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/network/routes/:routeId",
    async (request: FastifyRequest<{ Params: NetworkRouteParams }>, reply) => {
      try {
        return store.getAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          routeId: parseString(request.params.routeId, "routeId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/routes/:routeId/approve",
    async (request: FastifyRequest<{ Params: NetworkRouteParams }>, reply) => {
      try {
        return store.approveAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          routeId: parseString(request.params.routeId, "routeId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/network/routes/:routeId/reject",
    async (request: FastifyRequest<{ Params: NetworkRouteParams }>, reply) => {
      try {
        return store.rejectAgentRoute({
          sessionId: readSessionCookie(request.headers.cookie),
          routeId: parseString(request.params.routeId, "routeId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/network/sources/:sourceId",
    async (request: FastifyRequest<{ Params: NetworkSourceParams }>, reply) => {
      try {
        return store.deleteNetworkSource({
          sessionId: readSessionCookie(request.headers.cookie),
          sourceId: parseString(request.params.sourceId, "sourceId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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
    "/public/storefronts/:agentId/messages",
    async (
      request: FastifyRequest<{ Params: StorefrontParams; Body: PublicStorefrontMessageBody }>,
      reply
    ) => {
      try {
        return store.createPublicStorefrontMessage({
          agentId: parseString(request.params.agentId, "agentId"),
          visitorId: parseString(request.body.visitorId, "visitorId"),
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
          visitorId: parseString(request.body.visitorId, "visitorId"),
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

  app.get(
    "/businesses/:businessId/suppliers",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listSuppliers({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/suppliers",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: ContactRecordBody }>, reply) => {
      try {
        return store.createSupplier({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplier: parseContactRecordBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/suppliers/:supplierId",
    async (request: FastifyRequest<{ Params: SupplierParams; Body: ContactRecordBody }>, reply) => {
      try {
        return store.updateSupplier({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplierId: request.params.supplierId,
          supplier: parseContactRecordBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/suppliers/:supplierId",
    async (request: FastifyRequest<{ Params: SupplierParams }>, reply) => {
      try {
        return store.deleteSupplier({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplierId: request.params.supplierId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/suppliers/phonebook/search",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: PhonebookSearchQuery }>,
      reply
    ) => {
      try {
        return store.searchSupplierPhonebookContacts({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          query: request.query.q ?? ""
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/suppliers/from-phonebook",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: PhonebookLinkBody }>, reply) => {
      try {
        const body = parsePhonebookLinkBody(request.body);
        return store.createSupplierFromPhoneContact({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          networkNodeId: body.networkNodeId,
          notes: body.notes
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/suppliers/:supplierId/link-contact",
    async (request: FastifyRequest<{ Params: SupplierParams; Body: PhonebookLinkBody }>, reply) => {
      try {
        return store.linkSupplierContact({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplierId: request.params.supplierId,
          networkNodeId: parsePhonebookLinkBody(request.body).networkNodeId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/suppliers/:supplierId/sales-agents",
    async (request: FastifyRequest<{ Params: SupplierParams }>, reply) => {
      try {
        return store.listSalesAgents({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplierId: request.params.supplierId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/suppliers/:supplierId/sales-agents",
    async (request: FastifyRequest<{ Params: SupplierParams; Body: ContactRecordBody }>, reply) => {
      try {
        return store.createSalesAgent({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplierId: request.params.supplierId,
          agent: parseContactRecordBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/suppliers/:supplierId/sales-agents/from-phonebook",
    async (request: FastifyRequest<{ Params: SupplierParams; Body: PhonebookLinkBody }>, reply) => {
      try {
        const body = parsePhonebookLinkBody(request.body);
        return store.createSalesAgentFromPhoneContact({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          supplierId: request.params.supplierId,
          networkNodeId: body.networkNodeId,
          notes: body.notes
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/suppliers/:supplierId/sales-agents/:salesAgentId",
    async (
      request: FastifyRequest<{ Params: SupplierSalesAgentParams; Body: ContactRecordBody }>,
      reply
    ) => {
      try {
        return store.updateSalesAgent({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          salesAgentId: request.params.salesAgentId,
          agent: parseContactRecordBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.delete(
    "/businesses/:businessId/suppliers/:supplierId/sales-agents/:salesAgentId",
    async (request: FastifyRequest<{ Params: SupplierSalesAgentParams }>, reply) => {
      try {
        return store.deleteSalesAgent({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          salesAgentId: request.params.salesAgentId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/sales-agents/:salesAgentId/link-contact",
    async (
      request: FastifyRequest<{ Params: SalesAgentParams; Body: PhonebookLinkBody }>,
      reply
    ) => {
      try {
        return store.linkSalesAgentContact({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          salesAgentId: request.params.salesAgentId,
          networkNodeId: parsePhonebookLinkBody(request.body).networkNodeId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/receipt-ocr/jobs",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: ReceiptOCRBody }>, reply) => {
      try {
        const body = parseReceiptOCRBody(request.body);
        store.assertDocumentImportWriteAccess({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
        let extraction: ReceiptOCRExtractionResult | undefined;
        let fileSizeBytes = body.fileSizeBytes;
        let fileSignature = body.fileSignature;
        let sourceChecksum: string | undefined;

        if (body.extractedText.trim().length === 0 && body.contentBase64 !== null) {
          if (receiptOCRProcessor === undefined) {
            throw new Cp2Error(
              503,
              "receipt_ocr_worker_unconfigured",
              "Receipt OCR is not configured on this deployment."
            );
          }
          const binary = decodeReceiptBase64(body.contentBase64);
          fileSizeBytes = binary.byteLength;
          fileSignature = binary.subarray(0, 16).toString("hex");
          sourceChecksum = createHash("sha256").update(binary).digest("hex");
          await binaryUploadPipeline?.process(
            {
              businessId: request.params.businessId,
              fileName: body.fileName,
              contentType: body.contentType,
              bytes: binary
            },
            { retain: false }
          );
          extraction = await receiptOCRProcessor.process({
            fileName: body.fileName,
            contentType: body.contentType,
            contentBase64: binary.toString("base64")
          });
        }

        return store.createReceiptOCRJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          sourceFileName: body.fileName,
          contentType: body.contentType,
          extractedText: extraction?.fullText ?? body.extractedText,
          fileSizeBytes,
          fileSignature,
          ...(sourceChecksum === undefined ? {} : { sourceChecksum }),
          ...(extraction === undefined ? {} : { extraction })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/receipt-ocr/jobs/:ocrJobId/confirm",
    async (
      request: FastifyRequest<{ Params: ReceiptOCRParams; Body: ReceiptOCRConfirmBody }>,
      reply
    ) => {
      try {
        const body = parseReceiptOCRConfirmBody(request.body);
        return store.confirmReceiptOCRJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          ocrJobId: request.params.ocrJobId,
          supplierId: body.supplierId,
          salesAgentId: body.salesAgentId,
          createSupplier: body.createSupplier,
          createSalesAgent: body.createSalesAgent
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/purchase-receipts",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listPurchaseReceipts({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/purchase-receipts/:receiptId",
    async (request: FastifyRequest<{ Params: PurchaseReceiptParams }>, reply) => {
      try {
        return store.getPurchaseReceipt({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          receiptId: request.params.receiptId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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

  app.get(
    "/businesses/:businessId/logistics",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listLogistics({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/logistics",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: LogisticsBody }>, reply) => {
      try {
        return store.createLogistics({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          logistics: parseLogisticsBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/logistics/:logisticsId",
    async (
      request: FastifyRequest<{ Params: LogisticsParams; Body: LogisticsStatusBody }>,
      reply
    ) => {
      try {
        return store.updateLogisticsStatus({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          logisticsId: request.params.logisticsId,
          status: parseLogisticsStatusBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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

  app.get(
    "/businesses/:businessId/notifications",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listNotifications({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/notifications/:notificationId",
    async (
      request: FastifyRequest<{ Params: NotificationParams; Body: NotificationStatusBody }>,
      reply
    ) => {
      try {
        return store.updateNotificationStatus({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          notificationId: request.params.notificationId,
          status: parseNotificationStatus(request.body?.status)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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
        reply.header("set-cookie", clearSessionCookie());
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

  app.post(
    "/businesses/:businessId/imports/supplier-csv",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: SupplierCsvImportBody }>,
      reply
    ) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        store.assertDocumentImportWriteAccess({
          sessionId,
          businessId: request.params.businessId
        });
        const upload = await prepareDocumentUpload(
          parseDocumentImportBody(request.body),
          request.params.businessId,
          true
        );
        const source = await extractDocumentImportSource(upload);
        return store.createSupplierCsvImport({
          sessionId,
          businessId: request.params.businessId,
          source
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/imports/product-catalogue",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ProductCatalogueImportBody }>,
      reply
    ) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        store.assertDocumentImportWriteAccess({
          sessionId,
          businessId: request.params.businessId
        });
        const upload = await prepareDocumentUpload(
          parseDocumentImportBody(request.body),
          request.params.businessId,
          true
        );
        const source = await extractDocumentImportSource(upload);
        return store.createProductCatalogueImport({
          sessionId,
          businessId: request.params.businessId,
          source
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/documents/extract",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ProductCatalogueImportBody }>,
      reply
    ) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        store.assertDocumentImportWriteAccess({
          sessionId,
          businessId: request.params.businessId
        });
        const upload = await prepareDocumentUpload(
          parseDocumentImportBody(request.body),
          request.params.businessId,
          false
        );
        return await extractUploadedDocument(upload);
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/documents/ocr",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Body: ProductCatalogueImportBody }>,
      reply
    ) => {
      try {
        const sessionId = readSessionCookie(request.headers.cookie);
        store.assertDocumentImportWriteAccess({
          sessionId,
          businessId: request.params.businessId
        });
        if (receiptOCRProcessor === undefined) {
          throw new Cp2Error(
            503,
            "document_ocr_worker_unconfigured",
            "Document OCR is not configured on this deployment."
          );
        }

        const upload = parseDocumentImportBody(request.body);
        if (upload.contentBase64 === undefined) {
          throw new Cp2Error(
            400,
            "document_ocr_content_required",
            "Base64 image or PDF content is required for OCR."
          );
        }
        const contentType = upload.contentType?.trim() || "application/octet-stream";
        if (!documentOcrContentTypes.has(contentType)) {
          throw new Cp2Error(
            415,
            "document_ocr_type_unsupported",
            "OCR supports images and scanned PDF documents."
          );
        }

        const binary = decodeReceiptBase64(upload.contentBase64);
        if (binary.byteLength > 10 * 1024 * 1024) {
          throw new Cp2Error(
            413,
            "document_too_large",
            "Uploaded document must be 10 MB or smaller."
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
        const extraction = await receiptOCRProcessor.process({
          fileName: upload.fileName,
          contentType,
          contentBase64: binary.toString("base64")
        });
        if (extraction.fullText.trim().length === 0) {
          throw new Cp2Error(
            422,
            "document_ocr_text_missing",
            "OCR could not find readable text in this document."
          );
        }

        return {
          fileName: upload.fileName,
          contentType,
          text: extraction.fullText.trim(),
          format: "ocr" as const,
          warnings: extraction.warnings,
          sizeBytes: binary.byteLength,
          checksum: createHash("sha256").update(binary).digest("hex"),
          engine: extraction.engine,
          averageConfidence: extraction.averageConfidence
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  async function prepareDocumentUpload(
    input: DocumentUploadInput,
    businessId: string,
    retain: boolean
  ): Promise<DocumentUploadInput> {
    if (input.contentBase64 === undefined || binaryUploadPipeline === undefined) return input;
    const bytes = decodePipelineBase64(input.contentBase64);
    const result = await binaryUploadPipeline.process(
      {
        businessId,
        fileName: input.fileName,
        contentType: input.contentType?.trim() || "application/octet-stream",
        bytes
      },
      { retain }
    );
    return {
      ...input,
      originalStorageKey: result.storageKey
    };
  }

  app.get(
    "/businesses/:businessId/imports",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.listDocumentImports({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/imports/:importJobId",
    async (request: FastifyRequest<{ Params: DocumentImportParams }>, reply) => {
      try {
        return store.getDocumentImport({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          importJobId: request.params.importJobId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/imports/:importJobId/rows/:rowNumber",
    async (
      request: FastifyRequest<{ Params: DocumentImportRowParams; Body: SupplierImportRowBody }>,
      reply
    ) => {
      try {
        return store.updateSupplierImportRow({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          importJobId: request.params.importJobId,
          rowNumber: parseIntegerString(request.params.rowNumber, "rowNumber"),
          ...parseSupplierImportRowBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/imports/:importJobId/product-rows/:rowNumber",
    async (
      request: FastifyRequest<{ Params: DocumentImportRowParams; Body: ProductImportRowBody }>,
      reply
    ) => {
      try {
        return store.updateProductImportRow({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          importJobId: request.params.importJobId,
          rowNumber: parseIntegerString(request.params.rowNumber, "rowNumber"),
          ...parseProductImportRowBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/imports/:importJobId/confirm",
    async (
      request: FastifyRequest<{ Params: DocumentImportParams; Body: SupplierImportConfirmBody }>,
      reply
    ) => {
      try {
        const selectedRowNumbers = parseOptionalRowNumbers(request.body?.selectedRowNumbers);
        const input = {
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          importJobId: request.params.importJobId
        };
        return store.confirmSupplierImport({
          ...input,
          ...(selectedRowNumbers === undefined ? {} : { selectedRowNumbers })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/imports/:importJobId/confirm-products",
    async (
      request: FastifyRequest<{ Params: DocumentImportParams; Body: SupplierImportConfirmBody }>,
      reply
    ) => {
      try {
        const selectedRowNumbers = parseOptionalRowNumbers(request.body?.selectedRowNumbers);
        const input = {
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          importJobId: request.params.importJobId
        };
        return store.confirmProductImport({
          ...input,
          ...(selectedRowNumbers === undefined ? {} : { selectedRowNumbers })
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

function parseString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Cp2Error(400, `${name}_required`, `${name} is required.`);
  }

  return value.trim();
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
    status
  };
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Cp2Error(400, "value_invalid", "Expected a string value.");
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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
    "email"
  ].includes(value);
}

function isMessageHandoffStatus(value: string): value is MessageHandoffStatus {
  return [
    "preparing",
    "composer_opened",
    "no_sms_app",
    "invalid_recipient",
    "cancelled_before_handoff",
    "native_bridge_unavailable",
    "unsupported"
  ].includes(value);
}

function parsePasskeyResponse<T>(value: unknown): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Cp2Error(400, "passkey_response_required", "Passkey response is required.");
  }

  return value as T;
}

function parseOAuthProfileBody(value: OAuthCallbackBody["profile"]): OAuthProfile {
  if (value === undefined || value === null || typeof value !== "object") {
    throw new Cp2Error(400, "oauth_profile_required", "OAuth profile is required.");
  }

  const email = value.email;
  const displayName = value.displayName;

  return {
    providerSubject: parseString(value.providerSubject, "providerSubject"),
    email: email === undefined || email === null ? null : parseString(email, "email"),
    emailVerified:
      typeof value.emailVerified === "boolean"
        ? value.emailVerified
        : email !== undefined && email !== null,
    displayName:
      displayName === undefined || displayName === null
        ? null
        : parseString(displayName, "displayName")
  };
}

function parseOptionalOAuthTokens(value: OAuthCallbackBody["tokens"]): OAuthTokenResponse | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "object") {
    throw new Cp2Error(400, "oauth_tokens_invalid", "OAuth tokens must be an object.");
  }

  return compactOAuthTokenResponse({
    accessToken: parseOptionalString(value.accessToken),
    refreshToken: parseOptionalString(value.refreshToken),
    idToken: parseOptionalString(value.idToken),
    tokenType: parseOptionalString(value.tokenType),
    expiresIn:
      value.expiresIn === undefined ? undefined : parseNumber(value.expiresIn, "expiresIn"),
    scope: parseOptionalString(value.scope)
  });
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

function compactOAuthTokenResponse(input: {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
  tokenType?: string | undefined;
  expiresIn?: number | undefined;
  scope?: string | undefined;
}): OAuthTokenResponse {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as OAuthTokenResponse;
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

function parseOtpDeliveryChannel(
  value: string | undefined,
  authChannel: AuthChannel
): OtpDeliveryChannel {
  const deliveryChannel = value ?? (authChannel === "email" ? "email" : "sms");

  if (
    (authChannel === "email" && deliveryChannel !== "email") ||
    (authChannel === "phone" && deliveryChannel !== "sms")
  ) {
    throw new Cp2Error(
      400,
      "otp_delivery_channel_invalid",
      `OTP delivery channel must be ${authChannel === "email" ? "email" : "sms"}.`
    );
  }

  return deliveryChannel as OtpDeliveryChannel;
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

function parseContactRecordBody(body: ContactRecordBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    name: parseString(record.name, "name"),
    phone: parseNullableString(record.phone),
    email: parseNullableString(record.email),
    notes: parseNullableString(record.notes)
  };
}

function parsePhonebookLinkBody(body: PhonebookLinkBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    networkNodeId: parseString(record.networkNodeId, "networkNodeId"),
    notes: parseNullableString(record.notes)
  };
}

function parseReceiptOCRBody(body: ReceiptOCRBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    fileName: parseString(record.fileName, "fileName"),
    contentType: parseString(record.contentType, "contentType"),
    contentBase64:
      typeof record.contentBase64 === "string" && record.contentBase64.trim().length > 0
        ? record.contentBase64.trim()
        : null,
    extractedText: typeof record.extractedText === "string" ? record.extractedText : "",
    fileSizeBytes:
      record.fileSizeBytes === undefined
        ? null
        : parsePositiveInteger(record.fileSizeBytes, "fileSizeBytes"),
    fileSignature:
      typeof record.fileSignature === "string" && record.fileSignature.trim().length > 0
        ? record.fileSignature.trim()
        : null
  };
}

function decodeReceiptBase64(value: string): Buffer {
  const normalized = value.includes(",") ? (value.split(",", 2)[1] ?? "") : value;

  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[a-z0-9+/]*={0,2}$/iu.test(normalized)
  ) {
    throw new Cp2Error(400, "receipt_ocr_base64_invalid", "Receipt file content is invalid.");
  }

  const buffer = Buffer.from(normalized, "base64");
  if (buffer.byteLength === 0) {
    throw new Cp2Error(400, "receipt_ocr_content_required", "Receipt file content is required.");
  }
  return buffer;
}

const documentOcrContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf"
]);

function assertDocumentOcrSignature(contentType: string, buffer: Buffer): void {
  const hex = buffer.subarray(0, 16).toString("hex").toLowerCase();
  const matches =
    (contentType === "image/jpeg" && hex.startsWith("ffd8ff")) ||
    (contentType === "image/png" && hex.startsWith("89504e47")) ||
    (contentType === "image/webp" &&
      hex.startsWith("52494646") &&
      hex.slice(16, 24) === "57454250") ||
    (contentType === "application/pdf" && hex.startsWith("25504446")) ||
    ((contentType === "image/heic" || contentType === "image/heif") &&
      ["6674797068656963", "6674797068656966", "667479706d696631"].some((brand) =>
        hex.includes(brand)
      ));

  if (!matches) {
    throw new Cp2Error(
      400,
      "document_ocr_signature_mismatch",
      "Document contents do not match the declared image or PDF type."
    );
  }
}

function decodePipelineBase64(value: string): Buffer {
  const normalized = value.includes(",") ? (value.split(",", 2)[1] ?? "") : value;
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[a-z0-9+/]*={0,2}$/iu.test(normalized)
  ) {
    throw new Cp2Error(400, "document_base64_invalid", "Document file content is invalid.");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.byteLength === 0) {
    throw new Cp2Error(400, "document_content_required", "Document file content is required.");
  }
  return buffer;
}

function parseReceiptOCRConfirmBody(body: ReceiptOCRConfirmBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    supplierId: parseNullableString(record.supplierId),
    salesAgentId: parseNullableString(record.salesAgentId),
    createSupplier:
      record.createSupplier === undefined
        ? false
        : parseBoolean(record.createSupplier, "createSupplier"),
    createSalesAgent:
      record.createSalesAgent === undefined
        ? false
        : parseBoolean(record.createSalesAgent, "createSalesAgent")
  };
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

function parseLogisticsBody(body: LogisticsBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    invoiceId: parseString(record.invoiceId, "invoiceId"),
    method: parseFulfillmentMethod(record.method),
    destination: parseNullableString(record.destination),
    note: parseNullableString(record.note)
  };
}

function parseLogisticsStatusBody(body: LogisticsStatusBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    status: parseFulfillmentStatus(record.status),
    note: parseNullableString(record.note)
  };
}

function parseFulfillmentMethod(value: unknown): FulfillmentMethod {
  const method = parseString(value, "method");

  if (method === "delivery" || method === "pickup") {
    return method;
  }

  throw new Cp2Error(400, "fulfillment_method_invalid", "Fulfillment method is not supported.");
}

function parseFulfillmentStatus(value: unknown): FulfillmentStatus {
  const status = parseString(value, "status");

  if (
    status === "pending" ||
    status === "ready" ||
    status === "out_for_delivery" ||
    status === "completed" ||
    status === "cancelled"
  ) {
    return status;
  }

  throw new Cp2Error(400, "fulfillment_status_invalid", "Fulfillment status is not supported.");
}

function parseDocumentImportBody(
  body: SupplierCsvImportBody | ProductCatalogueImportBody | null | undefined
): DocumentUploadInput {
  const record = parseRequestBody(body);
  const parsed: DocumentUploadInput = {
    fileName: parseString(record.fileName, "fileName"),
    contentType: parseNullableString(record.contentType),
    ...(record.sourceType === undefined
      ? {}
      : { sourceType: parseDocumentImportSourceType(record.sourceType) }),
    sourceLocator: parseNullableString(record.sourceLocator)
  };

  if (record.content !== undefined) {
    parsed.content = parseString(record.content, "content");
  }

  if (record.contentBase64 !== undefined) {
    parsed.contentBase64 = parseString(record.contentBase64, "contentBase64");
  }

  return parsed;
}

function parseDocumentImportSourceType(value: unknown): "upload" | "paste" | "database" {
  const sourceType = parseString(value, "sourceType");
  if (sourceType === "upload" || sourceType === "paste" || sourceType === "database") {
    return sourceType;
  }
  throw new Cp2Error(400, "import_source_type_invalid", "Import source type is not supported.");
}

function parseSupplierImportRowBody(body: SupplierImportRowBody | null | undefined): {
  mapped: SupplierImportDraft;
  selected?: boolean;
} {
  const record = parseRequestBody(body);
  const mapped = parseRequestBody(record.mapped);
  const parsed = {
    mapped: {
      name: parseString(mapped.name, "mapped.name"),
      phone: parseNullableString(mapped.phone),
      email: parseNullableString(mapped.email),
      notes: parseNullableString(mapped.notes)
    }
  };

  return record.selected === undefined
    ? parsed
    : {
        ...parsed,
        selected: parseBoolean(record.selected, "selected")
      };
}

function parseProductImportRowBody(body: ProductImportRowBody | null | undefined): {
  mapped: ProductImportDraft;
  selected?: boolean;
} {
  const record = parseRequestBody(body);
  const mapped = parseRequestBody(record.mapped);
  const parsed = {
    mapped: {
      name: parseString(mapped.name, "mapped.name"),
      sku: parseNullableString(mapped.sku),
      unit: parseString(mapped.unit, "mapped.unit"),
      quantity: parseNumber(mapped.quantity, "mapped.quantity"),
      buyingPrice: parseNullableNumber(mapped.buyingPrice, "mapped.buyingPrice"),
      sellingPrice: parseNullableNumber(mapped.sellingPrice, "mapped.sellingPrice")
    }
  };

  return record.selected === undefined
    ? parsed
    : {
        ...parsed,
        selected: parseBoolean(record.selected, "selected")
      };
}

function parseOptionalRowNumbers(value: unknown): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "selected_rows_invalid", "selectedRowNumbers must be an array.");
  }

  return value.map((item, index) => parsePositiveInteger(item, `selectedRowNumbers.${index}`));
}

function parseRuntimeTurnBody(body: RuntimeTurnBody | null | undefined): {
  agentProfile?: RuntimeAgentProfile;
  runtimeSessionId?: string;
  message: string;
  confirmationToken?: string;
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
  const parsed = {
    message: parseString(record.message, "message")
  };
  const agentProfile =
    record.agentProfile === undefined ? undefined : parseRuntimeAgentProfile(record.agentProfile);

  return {
    ...parsed,
    ...(agentProfile === undefined ? {} : { agentProfile }),
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken })
  };
}

function parseRuntimeAgentProfile(value: unknown): RuntimeAgentProfile {
  const record = parseRequestBody(value);
  const tools = record.tools;
  const contextScripts = record.contextScripts;
  const integrations = record.integrations;

  if (tools !== undefined && !Array.isArray(tools)) {
    throw new Cp2Error(400, "agent_profile_invalid", "agentProfile.tools must be an array.");
  }

  if (contextScripts !== undefined && !Array.isArray(contextScripts)) {
    throw new Cp2Error(
      400,
      "agent_profile_invalid",
      "agentProfile.contextScripts must be an array."
    );
  }

  if (integrations !== undefined && !Array.isArray(integrations)) {
    throw new Cp2Error(400, "agent_profile_invalid", "agentProfile.integrations must be an array.");
  }

  const instructions = parseString(record.instructions, "agentProfile.instructions");

  return {
    behavior: parseOptionalString(record.behavior) ?? instructions,
    contextScripts: (contextScripts ?? []).map((script, index) =>
      parseString(script, `agentProfile.contextScripts.${index}`)
    ),
    integrations: (integrations ?? []).map((integration, index) =>
      parseString(integration, `agentProfile.integrations.${index}`)
    ),
    knowledge: parseString(record.knowledge, "agentProfile.knowledge"),
    model: parseString(record.model, "agentProfile.model"),
    role: parseString(record.role, "agentProfile.role"),
    instructions,
    tools: (tools ?? []).map((tool, index) => parseString(tool, `agentProfile.tools.${index}`))
  };
}

function parseNotificationStatus(value: unknown): BusinessNotificationStatus {
  const status = parseString(value, "status");

  if (status === "unread" || status === "read" || status === "archived") {
    return status;
  }

  throw new Cp2Error(400, "notification_status_invalid", "Notification status is not supported.");
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

function parsePhoneContactNetworkBodies(
  value: PhoneContactNetworkBody[] | undefined
): PhoneContactNetworkInput[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "contacts_required", "contacts is required.");
  }

  return value.map((contact, index) => parseNetworkConnectionBody(contact, `contacts.${index}`));
}

function parseSocialProfileNetworkBodies(
  value: SocialProfileNetworkBody[] | undefined
): SocialProfileNetworkInput[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "profiles_required", "profiles is required.");
  }

  return value.map((profile, index) => {
    const parsed = parseNetworkConnectionBody(profile, `profiles.${index}`);
    const relationship = profile.relationship;

    if (
      relationship !== undefined &&
      relationship !== "followed" &&
      relationship !== "follower" &&
      relationship !== "interaction" &&
      relationship !== "message"
    ) {
      throw new Cp2Error(
        400,
        "network_relationship_invalid",
        "Social network relationship is not supported."
      );
    }

    return relationship === undefined
      ? parsed
      : {
          ...parsed,
          relationship
        };
  });
}

function parseNetworkConnectionBody(
  value: NetworkConnectionBody,
  name: string
): PhoneContactNetworkInput {
  const record = parseRequestBody(value);
  const parsed: PhoneContactNetworkInput = {
    name: parseString(record.name, `${name}.name`),
    phone: parseNullableString(record.phone),
    email: parseNullableString(record.email),
    providerSubject: parseNullableString(record.providerSubject),
    handle: parseNullableString(record.handle)
  };

  if (record.connections !== undefined) {
    parsed.connections = parseNestedNetworkConnectionBodies(
      record.connections,
      `${name}.connections`
    );
  }

  return parsed;
}

function parseNestedNetworkConnectionBodies(
  value: unknown,
  name: string
): PhoneContactNetworkInput[] {
  if (!Array.isArray(value)) {
    throw new Cp2Error(400, "network_connections_invalid", `${name} must be an array.`);
  }

  return value.map((connection, index) =>
    parseNetworkConnectionBody(connection as NetworkConnectionBody, `${name}.${index}`)
  );
}

function parseNetworkSocialProvider(value: string): SocialNetworkProvider {
  if (
    value === "facebook" ||
    value === "instagram" ||
    value === "whatsapp" ||
    value === "tiktok" ||
    value === "x" ||
    value === "linkedin" ||
    value === "google" ||
    value === "microsoft" ||
    value === "github" ||
    value === "apple"
  ) {
    return value;
  }

  throw new Cp2Error(400, "network_provider_invalid", "Social network provider is not supported.");
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

function parseRequestBody(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Cp2Error(400, "body_invalid", "Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function parseSokoMode(value: unknown): SokoMode {
  if (value === "marketplace" || value === "seller") {
    return value;
  }

  throw new Cp2Error(400, "mode_invalid", "mode must be marketplace or seller.");
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

function parseStringArray(value: unknown, name: string, maximumItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} is invalid.`);
  }
  return value.map((item, index) => parseString(item, `${name}[${index}]`));
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

function parseNullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Cp2Error(400, "value_invalid", "Expected a string value.");
  }

  return value;
}

function parseNumber(value: unknown, name: string): number {
  if (typeof value !== "number") {
    throw new Cp2Error(400, `${name}_required`, `${name} is required.`);
  }

  return value;
}

function parsePositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be a positive integer.`);
  }

  return value;
}

function parseNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be a non-negative integer.`);
  }

  return value;
}

function parseOptionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : parseNonNegativeInteger(value, name);
}

function parseIntegerString(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be a positive integer.`);
  }

  return parsed;
}

function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be a boolean.`);
  }

  return value;
}

function parseNullableNumber(value: unknown, name: string): number | null {
  if (value === null) {
    return null;
  }

  return parseNumber(value, name);
}

function parseIsoTimestamp(value: unknown, name: string): string {
  const timestamp = parseString(value, name);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Cp2Error(400, `${name}_invalid`, `${name} must be an ISO timestamp.`);
  }

  return timestamp;
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

function sendCp2Error(reply: FastifyReply, error: unknown) {
  if (error instanceof Cp2Error) {
    return reply.code(error.statusCode).send({
      code: error.code,
      message: error.message
    });
  }

  throw error;
}
