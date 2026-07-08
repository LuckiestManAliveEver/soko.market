import { describe, expect, it } from "vitest";
import {
  businessActionProposedEvent,
  calculateInvoicePaymentStatus,
  createInvoicePreview,
  createInvoicePaymentSummary,
  createSupplierImportPreview,
  customerCreatedEvent,
  documentImportConfirmedEvent,
  invoiceConfirmedEvent,
  normalizeProductInput,
  paymentRecordedEvent,
  productCreatedEvent,
  roleCan,
  stockAdjustedEvent,
  validateBusinessActionDraft,
  validateDocumentImportSource,
  validateInvoiceInput,
  validatePaymentInput,
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
    expect(
      normalizeProductInput({
        name: " Maize   Flour ",
        quantity: 2,
        buyingPrice: 80,
        sellingPrice: null
      })
    ).toMatchObject({
      name: "Maize Flour",
      unit: "unit",
      quantity: 2,
      buyingPrice: 80,
      sellingPrice: null
    });
    expect(validateProductInput({ name: "x", quantity: -1 }).ok).toBe(false);
    expect(validateProductInput({ name: "Rice", buyingPrice: Number.NaN }).ok).toBe(false);
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
      buyingPrice: null,
      sellingPrice: null,
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
      buyingPrice: null,
      sellingPrice: null,
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

  it("validates CP8 payment inputs and permissions", () => {
    expect(
      validatePaymentInput({
        invoiceId: "invoice-1",
        amount: 25,
        method: "cash"
      })
    ).toEqual({
      ok: true,
      errors: []
    });
    expect(
      validatePaymentInput({
        invoiceId: "",
        amount: 0,
        method: "cash"
      }).ok
    ).toBe(false);
    expect(roleCan("owner", "payment:write")).toBe(true);
    expect(roleCan("manager", "payment:write")).toBe(true);
    expect(roleCan("cashier", "payment:write")).toBe(true);
    expect(roleCan("sales_agent", "payment:write")).toBe(false);
    expect(roleCan("sales_agent", "payment:read")).toBe(true);
  });

  it("calculates CP8 settlement status and creates immutable payment events", () => {
    const invoice = {
      id: "invoice-1",
      businessId: "business-1",
      invoiceNumber: "INV-00001",
      status: "confirmed" as const,
      customerId: "customer-1",
      customerName: "Amina",
      items: [],
      subtotal: 100,
      taxRate: 0,
      taxTotal: 0,
      total: 100,
      confirmedAt: "2026-07-03T00:00:00.000Z",
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z"
    };
    const payment = {
      id: "payment-1",
      businessId: "business-1",
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      method: "cash" as const,
      amount: 40,
      reference: null,
      note: null,
      actorId: "owner-1",
      createdAt: "2026-07-03T00:00:00.000Z"
    };
    const summary = createInvoicePaymentSummary({
      invoice,
      payments: [payment]
    });
    const event = paymentRecordedEvent({
      id: "event-payment",
      payment,
      invoicePayment: summary,
      actorId: "owner-1",
      occurredAt: "2026-07-03T00:00:00.000Z"
    });

    expect(calculateInvoicePaymentStatus({ invoiceTotal: 100, paidTotal: 0 })).toBe("unpaid");
    expect(summary).toMatchObject({
      paidTotal: 40,
      balanceDue: 60,
      status: "partially_paid"
    });
    expect(calculateInvoicePaymentStatus({ invoiceTotal: 100, paidTotal: 100 })).toBe("paid");
    expect(event.type).toBe("payment.recorded");
    expect(Object.isFrozen(event.payload.payment)).toBe(true);
    expect(Object.isFrozen(event.payload.invoicePayment)).toBe(true);
  });

  it("previews CP9 supplier CSV imports without confirmed writes", () => {
    const preview = createSupplierImportPreview({
      content:
        "name,phone,email,notes\nWholesale Depot,+254700000010,SUPPLY@example.com,Main\nx,,bad-email,Fix"
    });

    expect(validateDocumentImportSource({ fileName: "suppliers.csv", content: "name\nA" })).toEqual(
      {
        ok: true,
        errors: []
      }
    );
    expect(validateDocumentImportSource({ fileName: "suppliers.txt", content: "name\nA" }).ok).toBe(
      false
    );
    expect(preview.fieldMapping).toMatchObject({
      name: "name",
      phone: "phone",
      email: "email",
      notes: "notes"
    });
    expect(preview.rows[0]).toMatchObject({
      rowNumber: 1,
      selected: true,
      mapped: {
        name: "Wholesale Depot",
        email: "supply@example.com"
      },
      errors: []
    });
    expect(preview.rows[1].selected).toBe(false);
    expect(preview.rows[1].errors.length).toBeGreaterThan(0);
  });

  it("creates immutable CP9 import lifecycle events", () => {
    const importJob = {
      id: "import-1",
      businessId: "business-1",
      source: {
        id: "source-1",
        businessId: "business-1",
        fileName: "suppliers.csv",
        contentType: "text/csv",
        sizeBytes: 16,
        checksum: "checksum",
        createdAt: "2026-07-03T00:00:00.000Z"
      },
      target: "supplier" as const,
      status: "confirmed" as const,
      fieldMapping: {
        name: "name" as const
      },
      rows: [],
      confirmedCount: 1,
      errorMessage: null,
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
      confirmedAt: "2026-07-03T00:00:00.000Z"
    };
    const event = documentImportConfirmedEvent({
      id: "event-import",
      importJob,
      actorId: "owner-1",
      occurredAt: "2026-07-03T00:00:00.000Z"
    });

    expect(event.type).toBe("document_import.confirmed");
    expect(event.risk).toBe("medium");
    expect(Object.isFrozen(event.payload.importJob)).toBe(true);
  });
});
