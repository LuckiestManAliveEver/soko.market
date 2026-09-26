import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const importsRuntimeTools = {
  "document_import.confirm": {
    name: "document_import.confirm",
    hub: { module: "receipts", label: { en: "Confirm an import", sw: "Thibitisha uingizaji" } },
    description: "Confirm a pending document import job (product catalogue or supplier list).",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        importJobId: { type: "string", required: true, description: "Import job to confirm." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
