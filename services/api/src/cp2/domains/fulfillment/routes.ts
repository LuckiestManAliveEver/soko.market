/**
 * HTTP surface for corridor fulfillment Phase 1a (docs/architecture/corridor-fulfillment.md).
 * Routes only parse and delegate: Postgres-authoritative operations go to `FulfillmentService`,
 * in-memory business attributes (timezone, order weight) go to the Cp2Store. No fulfillment rule
 * lives here. Gram values cross this boundary only as decimal strings (A22); mutations accept an
 * optional `Idempotency-Key` header (A23).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Cp2Store, readSessionCookie } from "../../store.js";
import {
  parseBoolean,
  parseNullableString,
  parseRequestBody,
  parseString,
  readHeader,
  sendCp2Error,
  type BusinessParams
} from "../../route-helpers.js";
import type { FulfillmentService } from "./service.js";
import {
  parseApprovalDecisionBody,
  parseApprovalStatus,
  parseCorridorBody,
  parseCorridorPatch,
  parseDeliveryBody,
  parseManifestBody,
  parseManifestStatus,
  parseExpectedDefault,
  parsePolicyBody,
  parsePolicyRevisionBody,
  parseShopLocationBody,
  parseVehicleBody,
  parseVehiclePatch
} from "./input.js";

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

interface ManifestParams extends BusinessParams {
  manifestId: string;
}

interface ApprovalParams extends BusinessParams {
  approvalId: string;
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
          timezone: parseNullableString(body.timezone),
          ...(body.expectedTimezone === undefined
            ? {}
            : { expectedTimezone: parseNullableString(body.expectedTimezone) })
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
          vehicle: parseVehicleBody(body)
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
        return await fulfillment.updateVehicle({
          ...actor(request),
          vehicleId: request.params.vehicleId,
          patch: parseVehiclePatch(parseRequestBody(request.body))
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
          ...parseExpectedDefault(body),
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
          ...parsePolicyRevisionBody(parseRequestBody(request.body))
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
        return await fulfillment.captureShopLocation({
          ...actor(request),
          customerId: request.params.customerId,
          location: parseShopLocationBody(parseRequestBody(request.body))
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
        return await fulfillment.createCorridor({
          ...actor(request),
          corridor: parseCorridorBody(parseRequestBody(request.body))
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
        return await fulfillment.updateCorridor({
          ...actor(request),
          corridorId: request.params.corridorId,
          patch: parseCorridorPatch(parseRequestBody(request.body))
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

  // ---- Phase 1c: pools, order fulfillment, manifests -----------------------------------------

  app.get(
    "/businesses/:businessId/fulfillment/pools",
    async (request: FastifyRequest<{ Params: BusinessParams }>, reply) => {
      try {
        return await fulfillment.getActivePools(actor(request));
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/pools/:corridorId",
    async (request: FastifyRequest<{ Params: CorridorParams }>, reply) => {
      try {
        return await fulfillment.getCorridorPool({
          ...actor(request),
          corridorId: request.params.corridorId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/orders/:invoiceId",
    async (request: FastifyRequest<{ Params: InvoiceParams }>, reply) => {
      try {
        return await fulfillment.getOrderFulfillment({
          ...actor(request),
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/orders/:invoiceId/intake",
    async (request: FastifyRequest<{ Params: InvoiceParams }>, reply) => {
      try {
        return await fulfillment.intakeOrderForDispatcher({
          ...actor(request),
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/orders/:invoiceId/cancel",
    async (request: FastifyRequest<{ Params: InvoiceParams; Body: unknown }>, reply) => {
      try {
        const body =
          request.body === undefined || request.body === null ? {} : parseRequestBody(request.body);
        return await fulfillment.cancelOrderFulfillment({
          ...actor(request),
          invoiceId: request.params.invoiceId,
          reason: parseNullableString(body.reason)
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/manifests",
    async (
      request: FastifyRequest<{ Params: BusinessParams; Querystring: { status?: string } }>,
      reply
    ) => {
      try {
        const status = parseManifestStatus(request.query.status);
        return await fulfillment.listManifests({
          ...actor(request),
          ...(status === undefined ? {} : { status })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/manifests",
    async (request: FastifyRequest<{ Params: BusinessParams; Body: unknown }>, reply) => {
      try {
        return await fulfillment.createManifest({
          ...actor(request),
          ...parseManifestBody(parseRequestBody(request.body))
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/manifests/:manifestId",
    async (request: FastifyRequest<{ Params: ManifestParams }>, reply) => {
      try {
        return await fulfillment.getManifest({
          ...actor(request),
          manifestId: request.params.manifestId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/manifests/:manifestId/close",
    async (request: FastifyRequest<{ Params: ManifestParams }>, reply) => {
      try {
        return await fulfillment.closeManifest({
          ...actor(request),
          manifestId: request.params.manifestId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/manifests/:manifestId/depart",
    async (request: FastifyRequest<{ Params: ManifestParams }>, reply) => {
      try {
        return await fulfillment.departManifest({
          ...actor(request),
          manifestId: request.params.manifestId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/manifests/:manifestId/cancel",
    async (request: FastifyRequest<{ Params: ManifestParams; Body: unknown }>, reply) => {
      try {
        const body = parseRequestBody(request.body);
        return await fulfillment.cancelManifest({
          ...actor(request),
          manifestId: request.params.manifestId,
          reason: parseString(body.reason, "reason")
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/corridors/:corridorId/evaluate-dispatch",
    async (request: FastifyRequest<{ Params: CorridorParams }>, reply) => {
      try {
        return await fulfillment.evaluateDispatch({
          ...actor(request),
          corridorId: request.params.corridorId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.get(
    "/businesses/:businessId/fulfillment/dispatch-approvals",
    async (
      request: FastifyRequest<{
        Params: BusinessParams;
        Querystring: { status?: string };
      }>,
      reply
    ) => {
      try {
        const status = parseApprovalStatus(request.query.status);
        return await fulfillment.listDispatchApprovals({
          ...actor(request),
          ...(status === undefined ? {} : { status })
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/dispatch-approvals/:approvalId/decision",
    async (request: FastifyRequest<{ Params: ApprovalParams; Body: unknown }>, reply) => {
      try {
        return await fulfillment.decideDispatchApproval({
          ...actor(request),
          approvalId: request.params.approvalId,
          ...parseApprovalDecisionBody(parseRequestBody(request.body))
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/manifests/:manifestId/orders/:invoiceId/remove",
    async (request: FastifyRequest<{ Params: ManifestParams & { invoiceId: string } }>, reply) => {
      try {
        return await fulfillment.removeOrderFromManifest({
          ...actor(request),
          manifestId: request.params.manifestId,
          invoiceId: request.params.invoiceId
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );

  app.post(
    "/businesses/:businessId/fulfillment/manifests/:manifestId/stops/:stopId/delivery",
    async (
      request: FastifyRequest<{ Params: ManifestParams & { stopId: string }; Body: unknown }>,
      reply
    ) => {
      try {
        return await fulfillment.recordDelivery({
          ...actor(request),
          manifestId: request.params.manifestId,
          stopId: request.params.stopId,
          ...parseDeliveryBody(parseRequestBody(request.body))
        });
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}
