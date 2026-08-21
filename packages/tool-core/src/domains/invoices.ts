import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const invoicesRuntimeTools = {
  "invoice.draft": {
    name: "invoice.draft",
    description: "Draft a new invoice for a customer.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "invoice:write",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Canonical customer ID, when known." },
        customerName: { type: "string", required: true, description: "Customer to invoice." },
        quantity: { type: "number", description: "Composer hint from incomplete free text." },
        taxRate: { type: "number", description: "Invoice tax rate; defaults to zero." },
        items: {
          type: "array",
          required: true,
          description: "Invoice lines containing canonical productId, quantity, and unitPrice."
        }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
