import { describe, expect, it } from "vitest";
import {
  businessActionProposedEvent,
  createInvoicePreview,
  customerCreatedEvent,
  invoiceConfirmedEvent,
  normalizeProductInput,
  productCreatedEvent,
  roleCan,
  stockAdjustedEvent,
  validateBusinessActionDraft,
  validateInvoiceInput,
  validateProductInput,
  validateStockAdjustmentInput
} from "../packages/business-core/src";

describe("business core foundation", () => {
  it("validates a business action draft deterministically", () => {
    expect(
      validateBusinessActionDraft({
        actionType: "foundation.check",
        actorId: "owner-1",
        aggregateId: "foundation-1",
        aggregateType: "foundation",
        requiresConfirmation: false
      })
    ).toEqual({
      ok: true,
      errors: []
    });
  });

  it("creates immutable business events", () => {
    const event = businessActionProposedEvent({
      id: "00000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-02T00:00:00.000Z",
      draft: {
        actionType: "foundation.check",
        actorId: "owner-1",
        aggregateId: "foundation-1",
        aggregateType: "foundation",
        requiresConfirmation: false
      }
    });

    expect(event.type).toBe("business_action.proposed");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.draft)).toBe(true);
  });

  it("validates CP5 product and stock inputs", () => {
    expect(
      validateProductInput({
        name: " Maize Flour ",
        unit: "packet",
        quantity: 12
      })
    ).toEqual({
      ok: true,
      errors: []
    });
    expect(normalizeProductInput({ name: " Maize   Flour ", quantity: 2 })).toMatchObject({
      name: "Maize Flour",
      unit: "unit",
      quantity: 2
    });
    expect(validateProductInput({ name: "x", quantity: -1 }).ok).toBe(false);
    expect(validateStockAdjustmentInput({ quantityAfter: Number.NaN }).ok).toBe(false);
  });

  it("maps CP5 write permissions to owner and manager roles only where intended", () => {
    expect(roleCan("owner", "product:write")).toBe(true);
    expect(roleCan("manager", "inventory:adjust")).toBe(true);
    expect(roleCan("sales_agent", "customer:write")).toBe(true);
    expect(roleCan("cashier", "product:write")).toBe(false);
    expect(roleCan("view_only", "customer:write")).toBe(false);
  });

  it("creates immutable CP5 business events", () => {
    const product = {
      id: "product-1",
      businessId: "business-1",
      name: "Maize Flour",
      sku: null,
      unit: "packet",
      quantity: 4,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    const customer = {
      id: "customer-1",
      businessId: "business-1",
      name: "Amina",
      phone: null,
      email: null,
      notes: null,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    const movement = {
      id: "movement-1",
      businessId: "business-1",
      productId: product.id,
      type: "manual_adjustment" as const,
      quantityBefore: 4,
      quantityAfter: 7,
      delta: 3,
      reason: "Counted shelf stock",
      actorId: "owner-1",
      createdAt: "2026-07-02T00:00:00.000Z"
    };

    const productEvent = productCreatedEvent({
      id: "event-product",
      product,
      actorId: "owner-1",
      occurredAt: "2026-07-02T00:00:00.000Z"
    });
    const customerEvent = customerCreatedEvent({
      id: "event-customer",
      customer,
      actorId: "owner-1",
      occurredAt: "2026-07-02T00:00:00.000Z"
    });
    const movementEvent = stockAdjustedEvent({
      id: "event-movement",
      movement,
      actorId: "owner-1",
      occurredAt: "2026-07-02T00:00:00.000Z"
    });

    expect(productEvent.type).toBe("product.created");
    expect(customerEvent.type).toBe("customer.created");
    expect(movementEvent.type).toBe("inventory.stock_adjusted");
    expect(Object.isFrozen(productEvent.payload.product)).toBe(true);
    expect(Object.isFrozen(movementEvent.payload.movement)).toBe(true);
  });

  it("calculates CP6 invoice totals and validates invoice inputs deterministically", () => {
    const product = {
      id: "product-1",
      businessId: "business-1",
      name: "Maize Flour",
      sku: null,
      unit: "packet",
      quantity: 10,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    const preview = createInvoicePreview({
      businessId: "business-1",
      products: [product],
      invoice: {
        customerName: "Amina",
        taxRate: 0.16,
        items: [
          {
            productId: product.id,
            quantity: 2,
            unitPrice: 125.5
          }
        ]
      }
    });

    expect(preview).toMatchObject({
      subtotal: 251,
      taxRate: 0.16,
      taxTotal: 40.16,
      total: 291.16
    });
    expect(validateInvoiceInput({ items: [] }).ok).toBe(false);
    expect(
      validateInvoiceInput({
        taxRate: 1.5,
        items: [{ productId: product.id, quantity: 1, unitPrice: 10 }]
      }).ok
    ).toBe(false);
    expect(
      validateInvoiceInput({
        items: [{ productId: product.id, quantity: 0, unitPrice: 10 }]
      }).ok
    ).toBe(false);
  });

  it("creates immutable CP6 invoice events", () => {
    const invoice = {
      id: "invoice-1",
      businessId: "business-1",
      invoiceNumber: "INV-00001",
      status: "confirmed" as const,
      customerId: null,
      customerName: "Amina",
      items: [
        {
          id: "item-1",
          invoiceId: "invoice-1",
          productId: "product-1",
          productName: "Maize Flour",
          quantity: 2,
          unitPrice: 125.5,
          lineTotal: 251
        }
      ],
      subtotal: 251,
      taxRate: 0.16,
      taxTotal: 40.16,
      total: 291.16,
      confirmedAt: "2026-07-03T00:00:00.000Z",
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z"
    };
    const event = invoiceConfirmedEvent({
      id: "event-invoice",
      invoice,
      actorId: "owner-1",
      occurredAt: "2026-07-03T00:00:00.000Z"
    });

    expect(event.type).toBe("invoice.confirmed");
    expect(event.risk).toBe("high");
    expect(Object.isFrozen(event.payload.invoice)).toBe(true);
  });
});
