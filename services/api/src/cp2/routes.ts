import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isPaymentMethod, type BusinessPermission } from "@soko/business-core";
import type {
  AuthChannel,
  BusinessNotificationStatus,
  SupplierImportDraft,
  SyncMutationPayload,
  SyncMutationType
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
  "import:read",
  "import:write",
  "report:read",
  "notification:read",
  "notification:write"
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
