import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BusinessPermission } from "@soko/business-core";
import type {
  AuthChannel,
  MessageHandoffChannel,
  MessageHandoffStatus,
  NativeSmsResultCode,
  ShopPresenceStatus,
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
  OwnerInferenceNodeMessage
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
  type Cp2Store
} from "./store.js";
import {
  parseBoolean,
  parseContactRecordBody,
  parseIntegerString,
  parseIsoTimestamp,
  parseNonNegativeInteger,
  parseNullableString,
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
  type CustomerParams,
  type StorefrontParams
} from "./route-helpers.js";
import {
  parseLogisticsBody,
  parseLogisticsStatusBody,
  registerLogisticsRoutes
} from "./domains/logistics/routes.js";
import { registerNotificationsRoutes } from "./domains/notifications/routes.js";
import { registerPasskeysRoutes } from "./domains/passkeys/routes.js";
import { registerNetworkRoutes } from "./domains/network/routes.js";
import { registerSuppliersRoutes } from "./domains/suppliers/routes.js";
import { registerDocumentImportsRoutes } from "./domains/document-imports/routes.js";
import { registerCommerceRoutes } from "./domains/commerce/routes.js";
import { defaultOAuthRedirectUri, registerOAuthRoutes } from "./domains/oauth/routes.js";
import { registerComplianceRoutes } from "./domains/compliance/routes.js";
import {
  parseInvoiceBody,
  parsePaymentBody,
  parseProductBody,
  parseStockAdjustmentBody,
  registerSalesRoutes
} from "./domains/sales/routes.js";
import {
  parseRuntimeTurnBody,
  registerAgentRuntimeRoutes,
  type RuntimeTurnBody
} from "./domains/agent-runtime/routes.js";
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

interface SyncPullQuery {
  cursor?: string;
  limit?: string;
}

interface OwnerNodePresenceQuery {
  tenantId?: string;
  agentId?: string;
  modelId?: string;
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

interface PublicStorefrontMessageBody {
  capabilityToken?: string;
  body?: string;
  attachmentNames?: string[];
}

interface PublicStorefrontSessionBody {
  visitorId?: string;
  displayName?: string | null;
}

interface SyncQueueParams extends BusinessParams {
  syncItemId: string;
}

interface SyncMutationBody {
  idempotencyKey?: string;
  mutationType?: string;
  clientCreatedAt?: string;
  payload?: unknown;
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

  registerOAuthRoutes(app, store, oauthAllowedRedirectOrigins);

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

  registerAgentRuntimeRoutes(app, store, githubModelCatalog, huggingFaceModelCatalog);

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

  registerSalesRoutes(app, store);

  registerSuppliersRoutes(app, store, binaryUploadPipeline, receiptOCRProcessor);

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

  registerComplianceRoutes(app, store);

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

  registerDocumentImportsRoutes(app, store, binaryUploadPipeline, receiptOCRProcessor);

  registerCommerceRoutes(app, store, binaryUploadPipeline, receiptOCRProcessor);

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

function parseAccountDeletionBody(body: AccountDeletionBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    confirmation: parseString(record.confirmation, "confirmation"),
    reason: parseNullableString(record.reason)
  };
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

