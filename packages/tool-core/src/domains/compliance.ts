import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const complianceRuntimeTools = {
  "compliance.review": {
    name: "compliance.review",
    description: "Read the active business's canonical security and compliance review.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "compliance:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
