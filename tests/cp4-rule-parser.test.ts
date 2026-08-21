import { describe, expect, it } from "vitest";
import {
  createRuntimeToolProposal,
  parseMerchantCommand,
  parseProductContextScriptCommand,
  shouldUseStructuredFallback
} from "../packages/tool-core/src";
import { cp4EvalCommands } from "./ai-eval/cp4-commands";

describe("CP4 rule parser", () => {
  it("keeps at least 50 internal evaluation commands", () => {
    expect(cp4EvalCommands.length).toBeGreaterThanOrEqual(50);
  });

  it("meets the parser accuracy threshold for product and customer commands", () => {
    const productAndCustomerCommands = cp4EvalCommands.filter(
      (command) =>
        command.expectedIntent === "add_product" || command.expectedIntent === "add_customer"
    );
    const correct = productAndCustomerCommands.filter(
      (command) => parseMerchantCommand(command.text).intent === command.expectedIntent
    );

    expect(correct.length / productAndCustomerCommands.length).toBeGreaterThanOrEqual(0.8);
  });

  it("parses the full CP4 evaluation set with structured intent and next action", () => {
    const results = cp4EvalCommands.map((command) => ({
      command,
      result: parseMerchantCommand(command.text)
    }));
    const correctIntent = results.filter(
      ({ command, result }) => result.intent === command.expectedIntent
    );
    const correctAction = results.filter(
      ({ command, result }) => result.nextAction.type === command.expectedNextAction
    );

    expect(correctIntent.length / cp4EvalCommands.length).toBeGreaterThanOrEqual(0.8);
    expect(correctAction.length / cp4EvalCommands.length).toBeGreaterThanOrEqual(0.8);
    expect(results[0]?.result).toMatchObject({
      confidence: expect.any(Number),
      intent: expect.any(String),
      nextAction: expect.objectContaining({
        type: expect.any(String)
      }),
      normalizedInput: expect.any(String),
      slots: expect.any(Object)
    });
  });

  it("routes safe read commands without mutating business records", () => {
    expect(parseMerchantCommand("show products")).toMatchObject({
      intent: "show_products",
      nextAction: {
        type: "navigate",
        view: "products"
      }
    });
    expect(parseMerchantCommand("show invoices")).toMatchObject({
      intent: "show_invoices",
      nextAction: {
        type: "navigate",
        view: "invoices"
      }
    });
    expect(parseMerchantCommand("show reports")).toMatchObject({
      intent: "show_reports",
      nextAction: {
        type: "navigate",
        view: "reports"
      }
    });
    expect(parseMerchantCommand("show notifications")).toMatchObject({
      intent: "show_notifications",
      nextAction: {
        type: "navigate",
        view: "notifications"
      }
    });
  });

  it("keeps state-changing commands as drafts only", () => {
    expect(parseMerchantCommand("add product sugar")).toMatchObject({
      intent: "add_product",
      nextAction: {
        type: "draft"
      },
      slots: {
        productName: "Sugar"
      }
    });
    expect(parseMerchantCommand("create invoice for Mary")).toMatchObject({
      intent: "create_invoice",
      nextAction: {
        type: "draft"
      },
      slots: {
        customerName: "Mary"
      }
    });
    expect(parseMerchantCommand("record payment KES 500 from Mary")).toMatchObject({
      intent: "record_payment",
      nextAction: {
        type: "draft"
      },
      slots: {
        amount: 500
      }
    });
    expect(parseMerchantCommand("mark delivered for Mary")).toMatchObject({
      intent: "update_logistics",
      nextAction: {
        type: "draft"
      },
      slots: {
        customerName: "Mary"
      }
    });
  });

  it("asks for clarification for missing slots and low-confidence commands", () => {
    expect(parseMerchantCommand("add product")).toMatchObject({
      intent: "add_product",
      nextAction: {
        type: "clarify",
        question: "Which product should I draft?"
      }
    });
    expect(parseMerchantCommand("hello there")).toMatchObject({
      intent: "unknown",
      nextAction: {
        type: "clarify"
      }
    });
  });

  it("routes edit and stock-adjustment commands to their own intents, distinct from add_product (Phase 4a)", () => {
    expect(parseMerchantCommand("edit product sugar")).toMatchObject({
      intent: "update_product",
      slots: { productName: "Sugar" }
    });
    expect(parseMerchantCommand("adjust stock sugar 40")).toMatchObject({
      intent: "adjust_stock",
      slots: { productName: "Sugar", quantity: 40 }
    });
    expect(parseMerchantCommand("adjust stock")).toMatchObject({
      intent: "adjust_stock",
      nextAction: { type: "clarify", question: "Which product stock should I adjust?" }
    });
    expect(parseMerchantCommand("adjust stock sugar")).toMatchObject({
      intent: "adjust_stock",
      nextAction: { type: "clarify", question: "What should the new quantity be?" }
    });
  });

  it("captures a currency-tagged price without also mistaking it for a quantity (Phase 4a)", () => {
    // Before this fix, "ksh 150" was read as BOTH quantity=150 and price=150 - a single number
    // in the message must not be double-counted as two different fields.
    const created = parseMerchantCommand("add product sugar ksh 150");
    expect(created.slots).toMatchObject({ productName: "Sugar", amount: 150 });
    expect(created.slots.quantity).toBeUndefined();
    expect(createRuntimeToolProposal(created)).toMatchObject({
      toolName: "product.create",
      input: { name: "Sugar", quantity: 0, sellingPrice: 150 }
    });

    const updated = parseMerchantCommand("update product sugar ksh 200");
    expect(createRuntimeToolProposal(updated)).toMatchObject({
      toolName: "product.update",
      input: { productName: "Sugar", sellingPrice: 200 }
    });
    expect(createRuntimeToolProposal(updated).input.quantity).toBeUndefined();
  });

  it("routes supplier commands to their own intents, and never through the product vocabulary (Phase 4b)", () => {
    // The product vocabulary's bare "edit"/"badilisha" phrases match on the verb alone - without
    // the supplier exclusion guard, this would resolve to PRODUCT_EDIT with "supplier john" read
    // as a product name instead of falling through to the primary parser's update_supplier intent.
    expect(
      parseProductContextScriptCommand({ message: "edit supplier John Doe 0798765432" })
    ).toBeNull();
    expect(parseProductContextScriptCommand({ message: "add supplier Jane" })).toBeNull();

    expect(parseMerchantCommand("add supplier John Doe 0712345678")).toMatchObject({
      intent: "add_supplier",
      slots: { supplierName: "John Doe", phone: "0712345678" }
    });
    expect(
      createRuntimeToolProposal(parseMerchantCommand("add supplier John Doe 0712345678"))
    ).toMatchObject({
      toolName: "supplier.create",
      input: { name: "John Doe", phone: "0712345678" }
    });

    expect(parseMerchantCommand("edit supplier John Doe 0798765432")).toMatchObject({
      intent: "update_supplier",
      slots: { supplierName: "John Doe", phone: "0798765432" }
    });
    // The phone number must not also be misread as a quantity - same class of double-counting bug
    // fixed for currency-tagged product prices in Phase 4a.
    expect(
      parseMerchantCommand("edit supplier John Doe 0798765432").slots.quantity
    ).toBeUndefined();

    expect(parseMerchantCommand("add supplier")).toMatchObject({
      nextAction: { type: "clarify", question: "What is the supplier name?" }
    });
    expect(parseMerchantCommand("update supplier John")).toMatchObject({
      nextAction: { type: "clarify", question: "What should the new phone number be?" }
    });
  });

  it("routes customer edit commands to their own intent, and never through the product vocabulary (Phase 4c)", () => {
    expect(
      parseProductContextScriptCommand({ message: "edit customer Mary Wanjiru 0700111222" })
    ).toBeNull();
    expect(parseProductContextScriptCommand({ message: "add customer Jane" })).toBeNull();

    expect(parseMerchantCommand("add customer Mary Wanjiru 0722334455")).toMatchObject({
      intent: "add_customer",
      slots: { customerName: "Mary Wanjiru", phone: "0722334455" }
    });
    expect(
      createRuntimeToolProposal(parseMerchantCommand("add customer Mary Wanjiru 0722334455"))
    ).toMatchObject({
      toolName: "customer.create",
      input: { name: "Mary Wanjiru", phone: "0722334455" }
    });

    expect(parseMerchantCommand("edit customer Mary Wanjiru 0700111222")).toMatchObject({
      intent: "update_customer",
      slots: { customerName: "Mary Wanjiru", phone: "0700111222" }
    });
    expect(
      parseMerchantCommand("edit customer Mary Wanjiru 0700111222").slots.quantity
    ).toBeUndefined();

    // Product commands are unaffected by the customer/supplier exclusion guard.
    expect(parseProductContextScriptCommand({ message: "edit product sugar" })).toMatchObject({
      intent: "PRODUCT_EDIT"
    });
  });

  it("uses structured fallback only after repeated clarification results", () => {
    const result = parseMerchantCommand("hello there");

    expect(shouldUseStructuredFallback(result, 0)).toBe(false);
    expect(shouldUseStructuredFallback(result, 1)).toBe(false);
    expect(shouldUseStructuredFallback(result, 2)).toBe(true);
    expect(shouldUseStructuredFallback(parseMerchantCommand("show products"), 2)).toBe(false);
  });
});
