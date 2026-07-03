import { createEvent, type BusinessEvent } from "@soko/event-core";
import type {
  BusinessRole,
  CustomerSummary,
  InventoryMovementSummary,
  ProductSummary,
  SupplierSummary
} from "@soko/shared-types";
import { invalid, type ValidationResult, valid } from "@soko/tool-core";

export interface BusinessActionDraft {
  actionType: string;
  actorId: string;
  aggregateId: string;
  aggregateType: string;
  requiresConfirmation: boolean;
}

export function validateBusinessActionDraft(draft: BusinessActionDraft): ValidationResult {
  const errors: string[] = [];

  if (draft.actionType.trim().length === 0) {
    errors.push("Action type is required.");
  }

  if (draft.actorId.trim().length === 0) {
    errors.push("Actor id is required.");
  }

  if (draft.aggregateId.trim().length === 0) {
    errors.push("Aggregate id is required.");
  }

  if (draft.aggregateType.trim().length === 0) {
    errors.push("Aggregate type is required.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function businessActionProposedEvent(input: {
  id: string;
  draft: BusinessActionDraft;
  occurredAt: string;
}): BusinessEvent<{ draft: BusinessActionDraft }> {
  return createEvent({
    id: input.id,
    type: "business_action.proposed",
    aggregateId: input.draft.aggregateId,
    aggregateType: input.draft.aggregateType,
    actorId: input.draft.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      draft: input.draft
    }
  });
}

export const businessRoles = ["owner", "manager", "sales_agent", "cashier", "view_only"] as const;

export type BusinessPermission =
  | "business:create"
  | "business:read"
  | "membership:read"
  | "membership:manage"
  | "product:read"
  | "product:write"
  | "customer:read"
  | "customer:write"
  | "supplier:read"
  | "supplier:write"
  | "inventory:adjust";

const rolePermissions: Record<BusinessRole, ReadonlySet<BusinessPermission>> = {
  owner: new Set([
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
  ]),
  manager: new Set([
    "business:read",
    "membership:read",
    "product:read",
    "product:write",
    "customer:read",
    "customer:write",
    "supplier:read",
    "supplier:write",
    "inventory:adjust"
  ]),
  sales_agent: new Set(["business:read", "product:read", "customer:read", "customer:write"]),
  cashier: new Set(["business:read", "product:read", "customer:read"]),
  view_only: new Set(["business:read", "product:read", "customer:read", "supplier:read"])
};

export function isBusinessRole(value: string): value is BusinessRole {
  return businessRoles.includes(value as BusinessRole);
}

export function roleCan(role: BusinessRole, permission: BusinessPermission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}

export interface ProductInput {
  name: string;
  sku?: string | null;
  unit?: string | null;
  quantity?: number;
}

export interface ContactRecordInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface StockAdjustmentInput {
  quantityAfter: number;
  reason?: string | null;
}

export interface NormalizedProductInput {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
}

export interface NormalizedContactRecordInput {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface NormalizedStockAdjustmentInput {
  quantityAfter: number;
  reason: string;
}

export function validateProductInput(input: ProductInput): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.name).length < 2) {
    errors.push("Product name must be at least 2 characters.");
  }

  if (!isValidQuantity(input.quantity ?? 0)) {
    errors.push("Product quantity must be a finite non-negative number.");
  }

  if (normalizeOptionalText(input.unit).length > 32) {
    errors.push("Product unit must be 32 characters or fewer.");
  }

  if (normalizeOptionalText(input.sku).length > 64) {
    errors.push("Product SKU must be 64 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateContactRecordInput(
  input: ContactRecordInput,
  label: string
): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.name).length < 2) {
    errors.push(`${label} name must be at least 2 characters.`);
  }

  if (normalizeOptionalText(input.phone).length > 32) {
    errors.push(`${label} phone must be 32 characters or fewer.`);
  }

  if (normalizeOptionalText(input.email).length > 0 && !isValidEmail(input.email)) {
    errors.push(`${label} email is invalid.`);
  }

  if (normalizeOptionalText(input.notes).length > 240) {
    errors.push(`${label} notes must be 240 characters or fewer.`);
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateStockAdjustmentInput(input: StockAdjustmentInput): ValidationResult {
  const errors: string[] = [];

  if (!isValidQuantity(input.quantityAfter)) {
    errors.push("Adjusted quantity must be a finite non-negative number.");
  }

  if (normalizeOptionalText(input.reason).length > 160) {
    errors.push("Stock adjustment reason must be 160 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function normalizeProductInput(input: ProductInput): NormalizedProductInput {
  return {
    name: normalizeRequiredText(input.name),
    sku: nullableText(input.sku),
    unit: normalizeOptionalText(input.unit) || "unit",
    quantity: input.quantity ?? 0
  };
}

export function normalizeContactRecordInput(
  input: ContactRecordInput
): NormalizedContactRecordInput {
  return {
    name: normalizeRequiredText(input.name),
    phone: nullableText(input.phone),
    email: nullableText(input.email)?.toLowerCase() ?? null,
    notes: nullableText(input.notes)
  };
}

export function normalizeStockAdjustmentInput(
  input: StockAdjustmentInput
): NormalizedStockAdjustmentInput {
  return {
    quantityAfter: input.quantityAfter,
    reason: normalizeOptionalText(input.reason) || "Manual stock adjustment"
  };
}

export function productCreatedEvent(input: {
  id: string;
  product: ProductSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ product: ProductSummary }> {
  return createEvent({
    id: input.id,
    type: "product.created",
    aggregateId: input.product.id,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      product: input.product
    }
  });
}

export function productUpdatedEvent(input: {
  id: string;
  product: ProductSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ product: ProductSummary }> {
  return createEvent({
    id: input.id,
    type: "product.updated",
    aggregateId: input.product.id,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      product: input.product
    }
  });
}

export function customerCreatedEvent(input: {
  id: string;
  customer: CustomerSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ customer: CustomerSummary }> {
  return createEvent({
    id: input.id,
    type: "customer.created",
    aggregateId: input.customer.id,
    aggregateType: "customer",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      customer: input.customer
    }
  });
}

export function customerUpdatedEvent(input: {
  id: string;
  customer: CustomerSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ customer: CustomerSummary }> {
  return createEvent({
    id: input.id,
    type: "customer.updated",
    aggregateId: input.customer.id,
    aggregateType: "customer",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      customer: input.customer
    }
  });
}

export function supplierCreatedEvent(input: {
  id: string;
  supplier: SupplierSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ supplier: SupplierSummary }> {
  return createEvent({
    id: input.id,
    type: "supplier.created",
    aggregateId: input.supplier.id,
    aggregateType: "supplier",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      supplier: input.supplier
    }
  });
}

export function supplierUpdatedEvent(input: {
  id: string;
  supplier: SupplierSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ supplier: SupplierSummary }> {
  return createEvent({
    id: input.id,
    type: "supplier.updated",
    aggregateId: input.supplier.id,
    aggregateType: "supplier",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      supplier: input.supplier
    }
  });
}

export function stockAdjustedEvent(input: {
  id: string;
  movement: InventoryMovementSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ movement: InventoryMovementSummary }> {
  return createEvent({
    id: input.id,
    type: "inventory.stock_adjusted",
    aggregateId: input.movement.productId,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      movement: input.movement
    }
  });
}

function normalizeRequiredText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeOptionalText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function nullableText(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized.length === 0 ? null : normalized;
}

function isValidQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidEmail(value: string | null | undefined): boolean {
  const normalized = normalizeOptionalText(value);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized);
}
