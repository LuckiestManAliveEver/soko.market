import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BusinessPermission } from "@soko/business-core";
import type { AuthChannel } from "@soko/shared-types";
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

  return store;
}

function parseString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Cp2Error(400, `${name}_required`, `${name} is required.`);
  }

  return value;
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
  "inventory:adjust"
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
