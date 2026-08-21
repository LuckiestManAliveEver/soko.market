import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const suppliersRuntimeTools = {
  "supplier.create": {
    name: "supplier.create",
    description: "Create a new supplier contact.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "supplier:write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", required: true, description: "Supplier name." },
        phone: { type: "string", description: "Supplier phone number, if mentioned." }
      }
    },
    mcpExposable: false
  },
  "supplier.update": {
    name: "supplier.update",
    description: "Update an existing supplier contact's details.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "supplier:write",
    inputSchema: {
      type: "object",
      properties: {
        supplierName: { type: "string", required: true, description: "Supplier to update." },
        phone: { type: "string", description: "New phone number, if changing." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
