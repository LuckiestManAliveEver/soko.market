import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const paymentsRuntimeTools = {
  "payments.debtors": {
    name: "payments.debtors",
    description: "List customers with outstanding balances for the active business.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "payment:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "payment.record": {
    name: "payment.record",
    description: "Record a payment against an invoice or customer balance.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "payment:write",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", required: true, description: "Confirmed invoice to pay." },
        amount: { type: "number", required: true, description: "Payment amount." },
        method: {
          type: "string",
          required: true,
          description: "cash, bank_transfer, mobile_money_manual, card_manual, or other_manual."
        },
        customerName: { type: "string", description: "Paying customer, for composer hints." },
        reference: { type: "string", description: "External payment reference, if any." },
        note: { type: "string", description: "Optional payment note." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
