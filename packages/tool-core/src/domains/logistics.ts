import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const logisticsRuntimeTools = {
  "logistics.update_status": {
    name: "logistics.update_status",
    description: "Update a delivery or pickup record's fulfillment status.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "logistics:write",
    inputSchema: {
      type: "object",
      properties: {
        logisticsId: { type: "string", required: true, description: "Delivery record to update." },
        status: { type: "string", required: true, description: "New fulfillment status." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
