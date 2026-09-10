import type { FastifyInstance } from "fastify";
import { type Operation, type Entity } from "@soko/offline-runtime";
import { type Cp2Store, readSessionCookie } from "./store.js";
import { Cp2Error } from "./cp2-error.js";
import { parseRequestBody, parseString, sendCp2Error } from "./route-helpers.js";
export function registerOfflineRuntimeRoutes(app: FastifyInstance, store: Cp2Store): void {
  app.get<{ Params: { businessId: string } }>(
    "/businesses/:businessId/offline-runtime/snapshot",
    async (request, reply) => {
      try {
        if (process.env.OFFLINE_RUNTIME_ENABLED !== "true")
          throw new Cp2Error(
            403,
            "offline_install_disabled",
            "New offline installations are disabled."
          );
        return store.getOfflineRuntimeSnapshot(
          readSessionCookie(request.headers.cookie),
          request.params.businessId
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
  // Sync remains available when enrollment is disabled: existing devices must never be stranded.
  app.post<{ Body: { ops: unknown[] } }>("/sync/push", async (request, reply) => {
    try {
      const body = parseRequestBody(request.body);
      if (!Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > 100)
        throw new Cp2Error(400, "offline_batch_invalid", "Send between 1 and 100 operations.");
      const results = [];
      for (const raw of body.ops) {
        const operation = parseOperation(raw);
        const deviceId = request.headers["x-soko-device-id"];
        if (typeof deviceId !== "string" || deviceId !== operation.deviceId)
          throw new Cp2Error(
            403,
            "offline_device_mismatch",
            "Device identity does not match the operation."
          );
        results.push(
          store.pushOfflineOperation(readSessionCookie(request.headers.cookie), operation)
        );
      }
      return { results };
    } catch (error) {
      return sendCp2Error(reply, error);
    }
  });
  app.get<{ Querystring: { storeId: string; since?: string } }>(
    "/sync/pull",
    async (request, reply) => {
      try {
        return store.pullOfflineOperations(
          readSessionCookie(request.headers.cookie),
          parseString(request.query.storeId, "storeId"),
          request.query.since ?? null
        );
      } catch (error) {
        return sendCp2Error(reply, error);
      }
    }
  );
}
function parseOperation(raw: unknown): Operation {
  const record = parseRequestBody(raw);
  const strings = [
    "id",
    "accountId",
    "storeId",
    "deviceId",
    "opType",
    "collection",
    "entityLocalId",
    "createdAtLocal"
  ];
  for (const key of strings)
    if (parseString(record[key], key).length > 200)
      throw new Cp2Error(400, "offline_operation_invalid", "Operation field is too long.");
  if (
    !Number.isSafeInteger(record.localSeq) ||
    Number(record.localSeq) < 1 ||
    Number.isNaN(Date.parse(String(record.createdAtLocal)))
  )
    throw new Cp2Error(
      400,
      "offline_operation_invalid",
      "Invalid operation sequence or timestamp."
    );
  if (
    ![
      "catalogue.create",
      "catalogue.update",
      "inventory.adjust",
      "customers.create",
      "receipts.ocr.create",
      "orders.createInvoice",
      "orders.updateInvoice",
      "orders.confirmInvoice"
    ].includes(String(record.opType))
  )
    throw new Cp2Error(
      400,
      "offline_operation_unsupported",
      "This mutation is not supported offline."
    );
  const expected =
    record.opType === "customers.create"
      ? "customers"
      : record.opType === "receipts.ocr.create"
        ? "receiptOcrJobs"
        : record.opType === "orders.createInvoice" ||
            record.opType === "orders.updateInvoice" ||
            record.opType === "orders.confirmInvoice"
          ? "invoices"
          : "products";
  if (record.collection !== expected)
    throw new Cp2Error(
      400,
      "offline_collection_invalid",
      "Operation collection does not match its domain."
    );
  const payload = parseRequestBody(record.payload);
  const base = record.base === null ? null : (parseRequestBody(record.base) as Entity);
  const entityCloudId =
    record.entityCloudId === null ? null : parseString(record.entityCloudId, "entityCloudId");
  return { ...record, payload, base, entityCloudId } as unknown as Operation;
}
