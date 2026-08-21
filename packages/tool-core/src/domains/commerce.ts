import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const commerceRuntimeTools = {
  "commerce.search": {
    name: "commerce.search",
    description: "Search the canonical unified buy feed across catalogues and contact statuses.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "business:read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional item search text." }
      }
    },
    mcpExposable: false
  },
  "commerce.checkout": {
    name: "commerce.checkout",
    description: "Create canonical requested-order handoffs for structured unified-cart items.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "business:read",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          required: true,
          description: "One to 100 canonical unified-buy result items with quantities."
        },
        sellerConversationId: {
          type: "string",
          description: "Optional conversation that receives the checkout handoff card."
        }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
