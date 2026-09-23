/**
 * HTTP surface for corridor fulfillment Phase 1a (docs/architecture/corridor-fulfillment.md).
 * Routes only parse and delegate: Postgres-authoritative operations go to `FulfillmentService`,
 * in-memory business attributes (timezone, order weight) go to the Cp2Store. No fulfillment rule
 * lives here. Gram values cross this boundary only as decimal strings (A22); mutations accept an
 * optional `Idempotency-Key` header (A23).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DispatchPolicyInput } from "@soko/business-core";
import {
  GramsFormatError,
  parseNullableGrams,
  parsePositiveGrams,
  type DispatchFallbackAction,
  type DispatchOverflowStrategy
} from "@soko/shared-types";
import { Cp2Error } from "../../cp2-error.js";
import { type Cp2Store, readSessionCookie } from "../../store.js";
import {
  parseBoolean,
  parseNonNegativeInteger,
  parseNullableString,
  parseNumber,
  parsePositiveInteger,
  parseRequestBody,
  parseString,
  readHeader,
  sendCp2Error,
  type BusinessParams
} from "../../route-helpers.js";
import type { FulfillmentService, VehiclePatchInput } from "./service.js";

interface VehicleParams extends BusinessParams {
  vehicleId: string;
}

interface PolicyParams extends BusinessParams {
  policyId: string;
}

interface ShopParams extends BusinessParams {
  customerId: string;
}

interface CorridorParams extends BusinessParams {
  corridorId: string;
}

interface InvoiceParams extends BusinessParams {
  invoiceId: string;
}

interface IncludeQuery {
  include?: string;
}

export function registerFulfillmentRoutes(
  app: FastifyInstance,
  store: Cp2Store,
  fulfillment: FulfillmentService
): void {
  const actor = (request: FastifyRequest<{ Params: BusinessParams }>) => ({
    sessionId: readSessionCookie(request.headers.cookie),
    businessId: request.params.businessId,
    idempotencyKey: readHeader(request, "idempotency-key")
  });

  app.get(
    "/businesses/:businessId/fulfillment/settings",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return store.getFulfillmentSettings({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/fulfillment/settings",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return store.updateBusinessTimezone({
          sessionId: readSessionCookie(request.headers.cookie),
          businessId: request.params.businessId,
          timezone: parseNullableString(body.timezone)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/invoices/:invoiceId/fulfillment-weight",
    async (request: FastifyRequest<{ Params: InvoiceParams }>, reply) => {
      try {
        return store.getOrderFulfillmentWeight({
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
    "/businesses/:businessId/fulfillment/vehicles",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: IncludeQuery }>,
      reply
    ) => {
      try {
        return await fulfillment.listVehicles({
          ...actor(request),
          includeInactive: request.query.include === "inactive"
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/vehicles",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.createVehicle({
          ...actor(request),
          vehicle: {
            name: parseString(body.name, "name"),
            registration: parseNullableString(body.registration),
            capacityGrams: parseGramsField(body.capacityGrams, "capacityGrams", true),
            active: body.active === undefined ? true : parseBoolean(body.active, "active")
          }
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/fulfillment/vehicles/:vehicleId",
    async (request: FastifyRequest<{ Params: VehicleParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        const patch: VehiclePatchInput = {
          ...(body.name === undefined ? {} : { name: parseString(body.name, "name") }),
          ...(body.registration === undefined
            ? {}
            : { registration: parseNullableString(body.registration) }),
          ...(body.capacityGrams === undefined
            ? {}
            : { capacityGrams: parseGramsField(body.capacityGrams, "capacityGrams", true) }),
          ...(body.active === undefined ? {} : { active: parseBoolean(body.active, "active") })
        };
        return await fulfillment.updateVehicle({
          ...actor(request),
          vehicleId: request.params.vehicleId,
          patch
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/policies",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: IncludeQuery }>,
      reply
    ) => {
      try {
        return await fulfillment.listDispatchPolicies({
          ...actor(request),
          includeHistory: request.query.include === "history"
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/policies",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.createDispatchPolicy({
          ...actor(request),
          policy: parsePolicyBody(body),
          makeBusinessDefault:
            body.makeBusinessDefault === undefined
              ? false
              : parseBoolean(body.makeBusinessDefault, "makeBusinessDefault")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/policies/:policyId/revisions",
    async (request: FastifyRequest<{ Params: PolicyParams; Body: unknown }>, reply) => {
      try {
        return await fulfillment.reviseDispatchPolicy({
          ...actor(request),
          policyId: request.params.policyId,
          policy: parsePolicyBody(parseRequestBody(request.body))
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/default-policy",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return await fulfillment.getEffectiveDefaultPolicy(actor(request));
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/fulfillment/default-policy",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.setDefaultDispatchPolicy({
          ...actor(request),
          policyId: parseString(body.policyId, "policyId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/shops/:customerId/location",
    async (request: FastifyRequest<{ Params: ShopParams }>, reply) => {
      try {
        return await fulfillment.getShopLocation({
          ...actor(request),
          customerId: request.params.customerId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/fulfillment/shops/:customerId/location",
    async (request: FastifyRequest<{ Params: ShopParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.captureShopLocation({
          ...actor(request),
          customerId: request.params.customerId,
          location: {
            latitude: parseNumber(body.latitude, "latitude"),
            longitude: parseNumber(body.longitude, "longitude"),
            accuracyMeters:
              body.accuracyMeters === undefined || body.accuracyMeters === null
                ? null
                : parseNumber(body.accuracyMeters, "accuracyMeters")
          }
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/shops/:customerId/location/history",
    async (request: FastifyRequest<{ Params: ShopParams }>, reply) => {
      try {
        return await fulfillment.listShopLocationHistory({
          ...actor(request),
          customerId: request.params.customerId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  // ---- Phase 1b: corridors and resolution provenance ------------------------------------------

  app.get(
    "/businesses/:businessId/fulfillment/corridors",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: IncludeQuery }>,
      reply
    ) => {
      try {
        return await fulfillment.listCorridors({
          ...actor(request),
          includeInactive: request.query.include === "inactive"
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/corridors",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.createCorridor({
          ...actor(request),
          corridor: {
            name: parseString(body.name, "name"),
            originLabel: parseString(body.originLabel, "originLabel"),
            destinationLabel: parseString(body.destinationLabel, "destinationLabel"),
            // Validated (and its length computed) by the pure geometry module, never trusted.
            routeGeometry: body.routeGeometry,
            ...(body.priority === undefined
              ? {}
              : { priority: parseNonNegativeInteger(body.priority, "priority") }),
            ...(body.policyOverrideId === undefined
              ? {}
              : { policyOverrideId: parseNullableString(body.policyOverrideId) }),
            ...(body.active === undefined ? {} : { active: parseBoolean(body.active, "active") })
          }
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/corridors/:corridorId",
    async (request: FastifyRequest<{ Params: CorridorParams }>, reply) => {
      try {
        return await fulfillment.getCorridor({
          ...actor(request),
          corridorId: request.params.corridorId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.patch(
    "/businesses/:businessId/fulfillment/corridors/:corridorId",
    async (request: FastifyRequest<{ Params: CorridorParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        if (body.routeGeometry !== undefined) {
          throw new Cp2Error(
            400,
            "corridor_geometry_separate",
            "Change route geometry with PUT .../geometry so it gets a new geometry version."
          );
        }
        return await fulfillment.updateCorridor({
          ...actor(request),
          corridorId: request.params.corridorId,
          patch: {
            ...(body.name === undefined ? {} : { name: parseString(body.name, "name") }),
            ...(body.originLabel === undefined
              ? {}
              : { originLabel: parseString(body.originLabel, "originLabel") }),
            ...(body.destinationLabel === undefined
              ? {}
              : { destinationLabel: parseString(body.destinationLabel, "destinationLabel") }),
            ...(body.priority === undefined
              ? {}
              : { priority: parseNonNegativeInteger(body.priority, "priority") }),
            ...(body.policyOverrideId === undefined
              ? {}
              : { policyOverrideId: parseNullableString(body.policyOverrideId) }),
            ...(body.active === undefined ? {} : { active: parseBoolean(body.active, "active") })
          }
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.put(
    "/businesses/:businessId/fulfillment/corridors/:corridorId/geometry",
    async (request: FastifyRequest<{ Params: CorridorParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.updateCorridorGeometry({
          ...actor(request),
          corridorId: request.params.corridorId,
          routeGeometry: body.routeGeometry
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/corridors/:corridorId/geometry-versions",
    async (request: FastifyRequest<{ Params: CorridorParams }>, reply) => {
      try {
        return await fulfillment.listCorridorGeometryVersions({
          ...actor(request),
          corridorId: request.params.corridorId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/shops/:customerId/corridor-match",
    async (request: FastifyRequest<{ Params: ShopParams }>, reply) => {
      try {
        return await fulfillment.resolveCorridorForShop({
          ...actor(request),
          customerId: request.params.customerId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/orders/:invoiceId/corridor",
    async (request: FastifyRequest<{ Params: InvoiceParams }>, reply) => {
      try {
        return await fulfillment.getResolutionStatus({
          ...actor(request),
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/orders/:invoiceId/corridor/resolve",
    async (request: FastifyRequest<{ Params: InvoiceParams }>, reply) => {
      try {
        return await fulfillment.resolveCorridorForOrder({
          ...actor(request),
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/orders/:invoiceId/corridor/assign",
    async (request: FastifyRequest<{ Params: InvoiceParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.assignCorridorManually({
          ...actor(request),
          invoiceId: request.params.invoiceId,
          corridorId: parseString(body.corridorId, "corridorId")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}

function parseGramsField(value: unknown, field: string, positive: true): bigint;
function parseGramsField(value: unknown, field: string, positive: false): bigint | null;
function parseGramsField(value: unknown, field: string, positive: boolean): bigint | null {
  try {
    return positive ? parsePositiveGrams(value, field) : parseNullableGrams(value, field);
  } catch (error) {
    if (error instanceof GramsFormatError) {
      throw new Cp2Error(400, "grams_invalid", error.message, false, { field });
    }
    throw error;
  }
}

function parsePolicyBody(body: Record<string, unknown>): DispatchPolicyInput {
  const fallback = body.underThresholdFallback ?? [];
  if (!Array.isArray(fallback) || !fallback.every((entry) => typeof entry === "string")) {
    throw new Cp2Error(
      400,
      "fallback_invalid",
      "underThresholdFallback must be an array of fallback action names."
    );
  }
  return {
    name: parseString(body.name, "name"),
    targetLoadGrams: parseGramsField(body.targetLoadGrams, "targetLoadGrams", true),
    minimumDispatchLoadGrams: parseGramsField(
      body.minimumDispatchLoadGrams,
      "minimumDispatchLoadGrams",
      false
    ),
    maxDiversionMeters: parsePositiveInteger(body.maxDiversionMeters, "maxDiversionMeters"),
    cutoffLocalTime: parseString(body.cutoffLocalTime, "cutoffLocalTime"),
    maxWaitHours: parsePositiveInteger(body.maxWaitHours, "maxWaitHours"),
    fulfillmentLeadDays: parseNonNegativeInteger(body.fulfillmentLeadDays, "fulfillmentLeadDays"),
    underThresholdFallback: fallback as DispatchFallbackAction[],
    overflowStrategy: parseString(
      body.overflowStrategy ?? "NEXT_MANIFEST",
      "overflowStrategy"
    ) as DispatchOverflowStrategy
  };
}
