import {
  normalizeProductInput,
  validateProductInput,
  normalizeContactRecordInput,
  validateContactRecordInput,
  validateStockAdjustmentInput,
  type ProductInput,
  type ContactRecordInput,
  type StockAdjustmentInput
} from "@soko/business-core";
import type { LocalDatabase } from "../db/client.js";
import { recordOperation } from "../sync/writer.js";
import {
  OfflineError,
  type Scope,
  type Collection,
  type Entity,
  type RuntimePin
} from "../types.js";
import type { SokoProvider } from "./types.js";

export const localReads: Record<string, Collection> = {
  "catalogue.list": "products",
  "customers.list": "customers",
  "invoices.list": "invoices",
  "orders.list": "orders",
  "catalogue.fields": "productFields"
};
const writes = ["catalogue.create", "catalogue.update", "inventory.adjust", "customers.create"];
export class LocalProvider implements SokoProvider {
  readonly name = "local";
  constructor(
    private db: LocalDatabase,
    private scope: Scope,
    private infer?: (pin: RuntimePin, args: unknown) => Promise<unknown>
  ) {}
  supports(op: string): boolean {
    return (
      Object.hasOwn(localReads, op) || writes.includes(op) || (op === "agent.infer" && !!this.infer)
    );
  }
  async isAvailable(): Promise<boolean> {
    const state = await this.db.read(this.scope);
    return state.installed && state.offlineModeActive;
  }
  async call<T>(op: string, args: unknown): Promise<T> {
    const state = await this.db.read(this.scope);
    if (!state.installed || !state.offlineModeActive)
      throw new OfflineError("PROVIDER_UNAVAILABLE", "The offline runtime is not active.");
    if (op === "agent.infer") {
      if (!state.pin?.active || !this.infer)
        throw new OfflineError(
          "MODEL_NOT_INSTALLED",
          "No compatible pinned model is installed on this device."
        );
      return (await this.infer(state.pin, args)) as T;
    }
    const collection = localReads[op];
    if (collection) {
      const rows = state.rows
        .filter((row) => row.collection === collection)
        .map((row) => row.payload);
      return (
        op === "catalogue.fields"
          ? (rows[0] ?? { businessId: this.scope.storeId, fields: [] })
          : rows
      ) as T;
    }
    const input = (args ?? {}) as { id?: string; body?: Record<string, unknown> };
    const body = input.body ?? {};
    const id = input.id ?? crypto.randomUUID();
    if (op === "catalogue.create" || op === "catalogue.update") {
      const product = body as unknown as ProductInput;
      validate(validateProductInput(product));
      return (await recordOperation(
        this.db,
        this.scope,
        { opType: op, collection: "products", entityLocalId: id, payload: body },
        (current, operation) => {
          const existing = current.rows.find((row) => row.local_id === operation.entityLocalId);
          if (op === "catalogue.update" && !existing)
            throw new Error("This product is not in the downloaded snapshot.");
          return {
            ...existing?.payload,
            ...normalizeProductInput(product),
            id: existing?.payload.id ?? id,
            businessId: this.scope.storeId,
            primaryMediaId: existing?.payload.primaryMediaId ?? null,
            createdAt: existing?.payload.createdAt ?? operation.createdAtLocal,
            updatedAt: operation.createdAtLocal
          };
        }
      )) as T;
    }
    if (op === "customers.create") {
      const customer = body as unknown as ContactRecordInput;
      validate(validateContactRecordInput(customer, "Customer"));
      return (await recordOperation(
        this.db,
        this.scope,
        { opType: op, collection: "customers", entityLocalId: id, payload: body },
        (_current, operation) => ({
          ...normalizeContactRecordInput(customer),
          id,
          businessId: this.scope.storeId,
          linkedAccountId: null,
          createdAt: operation.createdAtLocal,
          updatedAt: operation.createdAtLocal
        })
      )) as T;
    }
    if (op === "inventory.adjust") {
      validate(validateStockAdjustmentInput(body as unknown as StockAdjustmentInput));
      let quantityBefore = 0;
      let movementId = "";
      const product = await recordOperation(
        this.db,
        this.scope,
        { opType: op, collection: "products", entityLocalId: id, payload: body },
        (current, operation): Entity => {
          const existing = current.rows.find((row) => row.local_id === operation.entityLocalId);
          if (!existing) throw new Error("This product is not in the downloaded snapshot.");
          quantityBefore = Number(existing.payload.quantity);
          movementId = operation.id;
          return {
            ...existing.payload,
            quantity: body.quantityAfter,
            updatedAt: operation.createdAtLocal
          };
        }
      );
      return {
        product,
        movement: {
          id: movementId,
          businessId: this.scope.storeId,
          productId: product.id,
          type: "manual_adjustment",
          quantityBefore,
          quantityAfter: product.quantity,
          delta: Number(product.quantity) - quantityBefore,
          reason: body.reason ?? "Manual stock count",
          actorId: this.scope.deviceId,
          createdAt: product.updatedAt
        }
      } as T;
    }
    throw new OfflineError("OPERATION_UNAVAILABLE", "This action needs an online connection.");
  }
}
function validate(result: { ok: boolean; errors: string[] }): void {
  if (!result.ok) throw new OfflineError("VALIDATION_FAILED", result.errors.join(" "));
}
