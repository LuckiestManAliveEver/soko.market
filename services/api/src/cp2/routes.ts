import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  ProductImportDraft,
  SocialNetworkProvider,
  SupplierImportDraft,
  TaxCountryCode,
  SyncMutationPayload,
  SyncMutationType,
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
  type Cp2Store,
  type OtpChallengeDelivery,
  type PhoneContactNetworkInput,
  type RuntimeAgentProfile,
  type SocialProfileNetworkInput
} from "./store.js";
import { createOtpProviderFromEnvironment, type OtpProvider } from "./otp-provider.js";
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

export interface Cp2RouteOptions {
  otpProvider?: OtpProvider;
  store?: Cp2Store;
}

interface OtpRequestBody {
  channel?: string;
  contact?: string;
  destination?: string;
  method?: string;
}

interface OtpVerifyBody {
  challengeId?: string;
  code?: string;
  contact?: string;
  method?: string;
  otp?: string;
}

interface SocialAuthBody {
  displayName?: string;
  email?: string;
  provider?: string;
}

interface OAuthStartBody {
  provider?: string;
  redirectUri?: string;
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

interface PinBody {
  pin?: string;
}

interface PinLoginBody extends PinBody {
  channel?: string;
  contact?: string;
  destination?: string;
  method?: string;
}

interface CreateBusinessBody {
  name?: string;
  language?: string;
}

interface RoleCheckBody {
  businessId?: string;
  role?: string;
  permission?: string;
}

interface BusinessParams {
  businessId: string;
}

interface StorefrontParams {
  agentId: string;
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
}

interface ProductCatalogueImportBody {
  fileName?: string;
  contentType?: string | null;
  content?: string;
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
  otpCode?: string;
  pin?: string;
}

interface ShopDeletionParams extends BusinessParams {
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
  const otpProvider = options.otpProvider ?? createOtpProviderFromEnvironment();

  app.post(
    "/auth/otp/request",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        const channel = parseAuthChannel(request.body.method ?? request.body.channel);
        const destination = parseString(
          request.body.contact ?? request.body.destination,
          "contact"
        );
        const otp = store.requestOtp({ channel, destination });

        if (otpProvider.canHandle(channel)) {
          await otpProvider.requestOtp({
            channel,
            destination: otp.destination
          });
        }

        if (
          otpProvider.exposesDevOtp ||
          !otpProvider.verifiesExternally ||
          !otpProvider.canHandle(channel)
        ) {
          return otp;
        }

        return {
          challengeId: otp.challengeId,
          destination: otp.destination,
          expiresAt: otp.expiresAt
        };
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/otp/verify", async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
    try {
      const code = parseString(request.body.otp ?? request.body.code, "otp");
      const challenge =
        request.body.challengeId === undefined
          ? store.getOtpChallengeDeliveryByContact({
              channel: parseAuthChannel(request.body.method),
              destination: parseString(request.body.contact, "contact")
            })
          : store.getOtpChallengeDelivery(parseString(request.body.challengeId, "challengeId"));
      const result =
        otpProvider.verifiesExternally && otpProvider.canHandle(challenge.channel)
          ? await verifyProviderOtp(store, otpProvider, challenge.challengeId, challenge, code)
          : store.verifyOtp({ challengeId: challenge.challengeId, code });
      reply.header("set-cookie", serializeSessionCookie(result.session.id));
      return result;
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });

  app.get("/auth/oauth/providers", async () => ({
    providers: listOAuthProviders()
  }));

  app.post(
    "/auth/oauth/start",
    async (request: FastifyRequest<{ Body: OAuthStartBody }>, reply) => {
      try {
        const provider = parseOAuthProvider(request.body.provider);
        const providerConfig = getOAuthProviderConfig(provider);

        if (!providerConfig.implemented) {
          throw new Cp2Error(
            501,
            "oauth_provider_not_implemented",
            `${providerConfig.displayName} sign-in is not implemented yet.`
          );
        }

        if (!isOAuthProviderConfigured(providerConfig)) {
          throw new Cp2Error(
            503,
            "oauth_provider_unconfigured",
            `${providerConfig.displayName} sign-in is not configured.`
          );
        }

        const redirectUri =
          parseOptionalString(request.body.redirectUri) ?? defaultOAuthRedirectUri(request);
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
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/oauth/callback",
    async (request: FastifyRequest<{ Body: OAuthCallbackBody }>, reply) => {
      try {
        const provider = parseOAuthProvider(request.body.provider);
        const state = parseString(request.body.state, "state");
        const csrfToken = parseString(request.body.csrfToken, "csrfToken");
        const providerConfig = getOAuthProviderConfig(provider);

        if (!providerConfig.implemented) {
          throw new Cp2Error(
            501,
            "oauth_provider_not_implemented",
            `${providerConfig.displayName} sign-in is not implemented yet.`
          );
        }

        const exchangeData = store.getOAuthExchangeData({
          provider,
          state,
          csrfToken
        });
        const bodyTokens = parseOptionalOAuthTokens(request.body.tokens);
        const tokens =
          bodyTokens ??
          (await exchangeOAuthCode({
            provider: providerConfig,
            code: parseString(request.body.code, "code"),
            codeVerifier: exchangeData.codeVerifier,
            redirectUri: exchangeData.redirectUri
          }));
        const profile =
          request.body.profile === undefined
            ? await fetchOAuthProfile({ provider: providerConfig, tokens })
            : parseOAuthProfileBody(request.body.profile);
        const result = store.completeOAuthCallback({
          provider,
          state,
          csrfToken,
          profile,
          tokens
        });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/auth/social/login",
    async (request: FastifyRequest<{ Body: SocialAuthBody }>, reply) => {
      try {
        const displayName = parseOptionalString(request.body.displayName);
        const result = store.authenticateSocialProfile({
          email: parseString(request.body.email, "email"),
          provider: parseSocialProvider(request.body.provider),
          ...(displayName === undefined ? {} : { displayName })
        });
        reply.header("set-cookie", serializeSessionCookie(result.session.id));
        return result;
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
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

  app.get("/session", async (request, reply) => {
    const session = store.getSession(readSessionCookie(request.headers.cookie));

    if (session === null) {
      return reply.code(401).send({
        code: "auth_required",
        message: "Authentication is required."
      });
    }

    return session;
  });

  app.post("/auth/logout", async (request, reply) => {
    const revoked = store.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", clearSessionCookie());
    return {
      revoked
    };
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
        parseNetworkSocialProvider(request.params.provider);
        // TODO: connect provider OAuth tokens to provider-specific graph/contact APIs.
        return reply.code(501).send({
          code: "network_provider_sync_not_implemented",
          message: "Network provider synchronization is not implemented yet."
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
        language
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
    async (_request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      // TODO: persist configurable catalogue field structure per business.
      return reply.code(501).send({
        code: "product_fields_not_implemented",
        message: "Product field management is not implemented yet."
      });
    }
  );

  app.post(
    "/businesses/:businessId/products/fields",
    async (
      _request: FastifyRequest<{ Params: BusinessParams; Body: ProductFieldStructureBody }>,
      reply
    ) => {
      // TODO: validate and persist configurable catalogue field structure per business.
      return reply.code(501).send({
        code: "product_fields_not_implemented",
        message: "Product field management is not implemented yet."
      });
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
        return store.createReceiptOCRJob({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          sourceFileName: body.fileName,
          contentType: body.contentType,
          extractedText: body.extractedText,
          fileSizeBytes: body.fileSizeBytes,
          fileSignature: body.fileSignature
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
        const result = store.finalizeShopDeletion({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          requestId: request.params.requestId,
          pin: parseString(request.body.pin, "pin"),
          otpCode: parseString(request.body.otpCode, "otpCode"),
          acknowledgement: parseBoolean(request.body.acknowledgement, "acknowledgement"),
          ...(idempotencyKey === undefined ? {} : { idempotencyKey })
        });
        reply.header("set-cookie", clearSessionCookie());
        return result;
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
        return store.createSupplierCsvImport({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          source: parseSupplierCsvImportBody(request.body)
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
        return store.createProductCatalogueImport({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          source: parseProductCatalogueImportBody(request.body)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

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

async function verifyProviderOtp(
  store: Cp2Store,
  otpProvider: OtpProvider,
  challengeId: string,
  challenge: OtpChallengeDelivery,
  code: string
) {
  const isApproved = await otpProvider.verifyOtp({
    channel: challenge.channel,
    destination: challenge.destination,
    code
  });

  if (!isApproved) {
    throw new Cp2Error(401, "otp_invalid", "OTP code is invalid.");
  }

  return store.verifyExternallyApprovedOtp({ challengeId });
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

function parseSocialProvider(value: string | undefined): string {
  if (
    value === "google" ||
    value === "facebook" ||
    value === "apple" ||
    value === "github" ||
    value === "microsoft" ||
    value === "linkedin"
  ) {
    return value;
  }

  throw new Cp2Error(400, "provider_invalid", "Social provider is not supported.");
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
  const origin = request.headers.origin ?? "http://127.0.0.1:5173";
  const url = new URL("/auth/oauth/callback", origin);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
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

function parseSupplierCsvImportBody(body: SupplierCsvImportBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    fileName: parseString(record.fileName, "fileName"),
    contentType: parseNullableString(record.contentType),
    content: parseString(record.content, "content")
  };
}

function parseProductCatalogueImportBody(body: ProductCatalogueImportBody | null | undefined) {
  const record = parseRequestBody(body);

  return {
    fileName: parseString(record.fileName, "fileName"),
    contentType: parseNullableString(record.contentType),
    content: parseString(record.content, "content")
  };
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
    record.runtimeSessionId === undefined
      ? undefined
      : parseString(record.runtimeSessionId, "runtimeSessionId");
  const confirmationToken =
    record.confirmationToken === undefined
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
