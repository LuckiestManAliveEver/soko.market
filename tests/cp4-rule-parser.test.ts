import { describe, expect, it } from "vitest";
import { parseMerchantCommand, shouldUseStructuredFallback } from "../packages/tool-core/src";
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

  it("uses structured fallback only after repeated clarification results", () => {
    const result = parseMerchantCommand("hello there");

    expect(shouldUseStructuredFallback(result, 0)).toBe(false);
    expect(shouldUseStructuredFallback(result, 1)).toBe(false);
    expect(shouldUseStructuredFallback(result, 2)).toBe(true);
    expect(shouldUseStructuredFallback(parseMerchantCommand("show products"), 2)).toBe(false);
  });
});
