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
  type Cp2Store
} from "./store.js";

export interface Cp2RouteOptions {
  store?: Cp2Store;
}

interface OtpRequestBody {
  channel?: string;
  destination?: string;
}

interface OtpVerifyBody {
  challengeId?: string;
  code?: string;
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

interface ProductParams extends BusinessParams {
  productId: string;
}

interface CustomerParams extends BusinessParams {
  customerId: string;
}

interface SupplierParams extends BusinessParams {
  supplierId: string;
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
}

interface ContactRecordBody {
  name?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
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

interface SupplierImportRowBody {
  mapped?: Partial<SupplierImportDraft>;
  selected?: boolean;
}

interface SupplierImportConfirmBody {
  selectedRowNumbers?: number[];
}

interface RuntimeTurnBody {
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

  app.post(
    "/auth/otp/request",
    async (request: FastifyRequest<{ Body: OtpRequestBody }>, reply) => {
      try {
        const channel = parseAuthChannel(request.body.channel);
        const destination = parseString(request.body.destination, "destination");
        return store.requestOtp({ channel, destination });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post("/auth/otp/verify", async (request: FastifyRequest<{ Body: OtpVerifyBody }>, reply) => {
    try {
      const challengeId = parseString(request.body.challengeId, "challengeId");
      const code = parseString(request.body.code, "code");
      const result = store.verifyOtp({ challengeId, code });
      reply.header("set-cookie", serializeSessionCookie(result.session.id));
      return result;
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
    quantity: record.quantity === undefined ? 0 : parseNumber(record.quantity, "quantity")
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

  return {
    ...parsed,
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken })
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
