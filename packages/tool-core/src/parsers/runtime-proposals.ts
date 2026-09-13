import { runtimeToolRegistry } from "../registry/index.js";
import {
  invalid,
  valid,
  type ParseResult,
  type RuntimeToolName,
  type RuntimeToolProposal
} from "../contracts/runtime.js";

export function mcpSchemaForRuntimeTool(toolName: RuntimeToolName): {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
} {
  const definition = runtimeToolRegistry[toolName];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [field, fieldSchema] of Object.entries(definition.inputSchema.properties)) {
    properties[field] = { type: fieldSchema.type, description: fieldSchema.description };
    if (fieldSchema.required) required.push(field);
  }
  return {
    name: `soko.${definition.name}`,
    description: definition.description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      ...(required.length > 0 ? { required } : {}),
      properties
    },
    annotations: {
      readOnlyHint: definition.readOnly,
      destructiveHint: definition.risk === "critical"
    }
  };
}

/** Canonical structured-output contract shared by server and on-device model adapters. */
export function renderRuntimeModelOutputInstructions(
  allowedTools: readonly RuntimeToolName[]
): string {
  const tools = [...new Set(allowedTools)].join(", ");
  return [
    "Return only one JSON object. Do not include markdown or surrounding commentary.",
    'Allowed shapes: {"type":"tool","toolName":"products.list","input":{},"reason":"..."}',
    'or {"type":"clarification","message":"..."}',
    'or {"type":"response","message":"..."}.',
    `Allowed tools: ${tools || "none"}.`,
    "A tool proposal is only a request; the Soko server validates permissions and confirmation before execution."
  ].join("\n");
}

interface RuntimeModelFewShotExample {
  /** null = not gated by allowedTools (a clarification/response example, not a tool call). */
  toolName: RuntimeToolName | null;
  message: string;
  output: string;
}

const runtimeModelFewShotExamples: readonly RuntimeModelFewShotExample[] = [
  {
    toolName: "products.list",
    message: "show me my products",
    output:
      '{"type":"tool","toolName":"products.list","input":{},"reason":"List products for the active business."}'
  },
  {
    toolName: "product.create",
    message: "add sugar 10kg at 150 shillings",
    output:
      '{"type":"tool","toolName":"product.create","input":{"name":"Sugar","unit":"kg","quantity":10,"sellingPrice":150},"reason":"Draft a new product from the merchant message."}'
  },
  {
    toolName: "customer.update",
    message: "update Mary's phone to 0712345678",
    output:
      '{"type":"tool","toolName":"customer.update","input":{"customerName":"Mary","phone":"0712345678"},"reason":"Draft an update to the existing customer record."}'
  },
  {
    toolName: null,
    message: "add a new product",
    output: '{"type":"clarification","message":"What is the product name?"}'
  },
  {
    toolName: null,
    message: "can you file my tax returns with KRA",
    output:
      '{"type":"response","message":"I can\'t file taxes with KRA directly, but I can help track your tax records in-app."}'
  }
];

/**
 * Worked <input, output> examples for the model's structured-output contract - GPT-3 and
 * Chain-of-Thought's shared finding that a handful of in-context demonstrations measurably
 * improves structured-output correctness over an instruction alone. Only shown alongside
 * renderRuntimeModelOutputInstructions, whose contract these examples demonstrate; filtered to
 * the tools actually allowed for this request so an example never references a tool the model
 * isn't permitted to call. Deliberately small and fixed (not learned/optimized) - this is meant
 * as a light, cheap correctness aid, not a prompt-optimization pipeline.
 */
export function renderRuntimeModelFewShotExamples(
  allowedTools: readonly RuntimeToolName[]
): string {
  const allowed = new Set(allowedTools);
  const applicable = runtimeModelFewShotExamples.filter(
    (example) => example.toolName === null || allowed.has(example.toolName)
  );
  if (applicable.length === 0) return "";
  const rendered = applicable
    .map((example) => `Merchant: "${example.message}"\nYou: ${example.output}`)
    .join("\n\n");
  return `Worked examples of the exact output format (do not copy their content, only their shape):\n\n${rendered}`;
}

export function createRuntimeToolProposal(result: ParseResult): RuntimeToolProposal {
  switch (result.intent) {
    case "show_products":
      return {
        toolName: "products.list",
        input: {},
        reason: "List products for the active business.",
        validation: valid()
      };

    case "show_invoices":
      return {
        toolName: "invoices.list",
        input: {},
        reason: "List invoices for the active business.",
        validation: valid()
      };

    case "show_reports":
      return {
        toolName: "reports.summary",
        input: {},
        reason: "Get the report summary for the active business.",
        validation: valid()
      };

    case "show_notifications":
      return {
        toolName: "notifications.list",
        input: {},
        reason: "List notifications for the active business.",
        validation: valid()
      };

    case "add_product":
      return {
        toolName: "product.create",
        input: {
          name: result.slots.productName ?? "",
          unit: result.slots.unit ?? "unit",
          quantity: result.slots.quantity ?? 0,
          sellingPrice: result.slots.amount ?? null
        },
        reason: "Draft a product creation action from the merchant command.",
        validation:
          result.slots.productName === undefined
            ? invalid("Product name is required before a product can be drafted.")
            : valid()
      };

    case "update_product":
      return {
        toolName: "product.update",
        input: {
          productName: result.slots.productName ?? "",
          ...(result.slots.unit === undefined ? {} : { unit: result.slots.unit }),
          ...(result.slots.quantity === undefined ? {} : { quantity: result.slots.quantity }),
          ...(result.slots.amount === undefined ? {} : { sellingPrice: result.slots.amount })
        },
        reason: "Draft a product update action from the merchant command.",
        validation:
          result.slots.productName === undefined ? invalid("Which product should I edit?") : valid()
      };

    case "adjust_stock":
      return {
        toolName: "product.stock_adjust",
        input: {
          productName: result.slots.productName ?? "",
          quantity: result.slots.quantity ?? 0
        },
        reason: "Draft a stock adjustment action from the merchant command.",
        validation:
          result.slots.productName === undefined
            ? invalid("Which product stock should I adjust?")
            : result.slots.quantity === undefined
              ? invalid("What should the new quantity be?")
              : valid()
      };

    case "add_customer":
      return {
        toolName: "customer.create",
        input: {
          name: result.slots.customerName ?? "",
          ...(result.slots.phone === undefined ? {} : { phone: result.slots.phone })
        },
        reason: "Draft a customer creation action from the merchant command.",
        validation:
          result.slots.customerName === undefined
            ? invalid("Customer name is required before a customer can be drafted.")
            : valid()
      };

    case "update_customer":
      return {
        toolName: "customer.update",
        input: {
          customerName: result.slots.customerName ?? "",
          ...(result.slots.phone === undefined ? {} : { phone: result.slots.phone })
        },
        reason: "Draft a customer update action from the merchant command.",
        validation:
          result.slots.customerName === undefined
            ? invalid("Which customer should I edit?")
            : result.slots.phone === undefined
              ? invalid("What should the new phone number be?")
              : valid()
      };

    case "add_supplier":
      return {
        toolName: "supplier.create",
        input: {
          name: result.slots.supplierName ?? "",
          ...(result.slots.phone === undefined ? {} : { phone: result.slots.phone })
        },
        reason: "Draft a supplier creation action from the merchant command.",
        validation:
          result.slots.supplierName === undefined
            ? invalid("Supplier name is required before a supplier can be drafted.")
            : valid()
      };

    case "update_supplier":
      return {
        toolName: "supplier.update",
        input: {
          supplierName: result.slots.supplierName ?? "",
          ...(result.slots.phone === undefined ? {} : { phone: result.slots.phone })
        },
        reason: "Draft a supplier update action from the merchant command.",
        validation:
          result.slots.supplierName === undefined
            ? invalid("Which supplier should I edit?")
            : result.slots.phone === undefined
              ? invalid("What should the new phone number be?")
              : valid()
      };

    case "create_invoice":
      return {
        toolName: "invoice.draft",
        input: {
          customerName: result.slots.customerName ?? null,
          quantity: result.slots.quantity ?? null
        },
        reason: "Draft an invoice action from the merchant command.",
        validation: invalid("Invoice runtime draft needs product and price details.")
      };

    case "record_payment":
      return {
        toolName: "payment.record",
        input: {
          amount: result.slots.amount ?? null,
          customerName: result.slots.customerName ?? null
        },
        reason: "Draft a payment recording action from the merchant command.",
        validation: invalid("Payment runtime draft needs an invoice id and method.")
      };

    case "update_logistics":
      return {
        toolName: "logistics.update_status",
        input: {
          customerName: result.slots.customerName ?? null
        },
        reason: "Draft a logistics status update from the merchant command.",
        validation: invalid("Logistics runtime draft needs which delivery and the new status.")
      };

    case "check_debt":
      return {
        toolName: "payments.debtors",
        input: {},
        reason: "List canonical customer debt balances for the active business.",
        validation: valid()
      };

    case "unknown":
      return {
        toolName: "unknown.clarify",
        input: {},
        reason:
          result.nextAction.type === "clarify" ? result.nextAction.reason : "Clarify request.",
        validation: invalid(
          result.nextAction.type === "clarify"
            ? result.nextAction.question
            : "I need more details before I can plan that action."
        )
      };
  }
}
