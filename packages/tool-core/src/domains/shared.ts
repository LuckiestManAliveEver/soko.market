import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const sharedRuntimeTools = {
  "unknown.clarify": {
    name: "unknown.clarify",
    description: "No actionable tool was identified; ask the user a clarifying question.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "business:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
