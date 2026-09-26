import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const coreReadsRuntimeTools = {
  "products.list": {
    name: "products.list",
    hub: { module: "catalog", label: { en: "See products", sw: "Angalia bidhaa" } },
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
    hub: { module: "orders", label: { en: "See orders", sw: "Angalia oda" } },
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
    hub: { module: "insights", label: { en: "Business summary", sw: "Muhtasari wa biashara" } },
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
    hub: { module: "insights", label: { en: "Alerts", sw: "Arifa" } },
    description: "List the active business's alerts and notifications.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "notification:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
