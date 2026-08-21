import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const customersRuntimeTools = {
  "customer.create": {
    name: "customer.create",
    description: "Create a new customer record.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "customer:write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", required: true, description: "Customer name." },
        phone: { type: "string", description: "Customer phone number, if mentioned." }
      }
    },
    mcpExposable: false
  },
  "customer.update": {
    name: "customer.update",
    description: "Update an existing customer's details.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "customer:write",
    inputSchema: {
      type: "object",
      properties: {
        customerName: { type: "string", required: true, description: "Customer to update." },
        phone: { type: "string", description: "New phone number, if changing." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
