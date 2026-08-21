import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const coreReadsRuntimeTools = {
  "products.list": {
    name: "products.list",
    description: "List or search the active business's canonical product catalogue.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "product:read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional free-text search over product names." }
      }
    },
    mcpExposable: false
  },
  "invoices.list": {
    name: "invoices.list",
    description: "List invoices for the active business.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "invoice:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "reports.summary": {
    name: "reports.summary",
    description: "Get the active business's sales, inventory, and knowledge report summary.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "report:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "notifications.list": {
    name: "notifications.list",
    description: "List the active business's alerts and notifications.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "notification:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
