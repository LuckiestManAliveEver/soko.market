import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const networkRuntimeTools = {
  "network.route": {
    name: "network.route",
    description: "Request an agent-mediated route to a matching second-degree network contact.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:read",
    inputSchema: {
      type: "object",
      properties: {
        requestText: {
          type: "string",
          required: true,
          description: "The owner's original network-discovery request."
        },
        targetNodeId: {
          type: "string",
          description: "Optional canonical network node identifier."
        }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
