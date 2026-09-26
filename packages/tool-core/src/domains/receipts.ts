import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const receiptsRuntimeTools = {
  "receipt.scan": {
    name: "receipt.scan",
    hub: { module: "receipts", label: { en: "Scan a receipt", sw: "Changanua risiti" } },
    description: "Start OCR scanning of an uploaded purchase receipt.",
    risk: "medium",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        extractedText: {
          type: "string",
          required: true,
          description: "Trusted OCR text extracted from the attached receipt."
        },
        fileName: { type: "string", description: "Original receipt file name." },
        contentType: { type: "string", description: "Original receipt MIME type." }
      }
    },
    mcpExposable: false
  },
  "receipt.review": {
    name: "receipt.review",
    hub: {
      module: "receipts",
      label: { en: "Review scanned receipts", sw: "Kagua risiti zilizochanganuliwa" }
    },
    description: "Review previously scanned purchase receipts pending confirmation.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "import:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "receipt.confirm": {
    name: "receipt.confirm",
    hub: { module: "receipts", label: { en: "Confirm a receipt", sw: "Thibitisha risiti" } },
    description: "Confirm a reviewed purchase receipt, writing it into purchase history.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        ocrJobId: { type: "string", required: true, description: "Receipt scan to confirm." },
        supplierId: { type: "string", description: "Canonical supplier selected in review." },
        salesAgentId: { type: "string", description: "Canonical sales agent selected in review." },
        createSupplier: {
          type: "boolean",
          description: "Create the extracted supplier if unmatched."
        },
        createSalesAgent: {
          type: "boolean",
          description: "Create the extracted sales agent if unmatched."
        }
      }
    },
    mcpExposable: false
  },
  "receipt.correct": {
    name: "receipt.correct",
    hub: { module: "receipts", label: { en: "Correct a receipt", sw: "Sahihisha risiti" } },
    description: "Correct a previously confirmed purchase receipt.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        ocrJobId: {
          type: "string",
          required: true,
          description: "Pending receipt scan to correct."
        },
        extractedText: {
          type: "string",
          required: true,
          description: "Corrected OCR text to parse again."
        }
      }
    },
    mcpExposable: false
  },
  "receipt.cancel": {
    name: "receipt.cancel",
    hub: { module: "receipts", label: { en: "Cancel a receipt", sw: "Ghairi risiti" } },
    description: "Cancel a pending purchase receipt scan.",
    risk: "medium",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        ocrJobId: { type: "string", required: true, description: "Receipt scan to cancel." }
      }
    },
    mcpExposable: false
  },
  "receipt.lookup": {
    name: "receipt.lookup",
    hub: { module: "receipts", label: { en: "Find a receipt", sw: "Tafuta risiti" } },
    description: "Look up purchase receipts by supplier or item name.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "import:read",
    inputSchema: {
      type: "object",
      properties: {
        supplierName: { type: "string", description: "Filter by supplier name." },
        itemName: { type: "string", description: "Filter by line-item name." }
      }
    },
    mcpExposable: false
  },
  "receipt.list": {
    name: "receipt.list",
    hub: { module: "receipts", label: { en: "Purchase receipts", sw: "Risiti za ununuzi" } },
    description: "List all purchase receipts for the active business.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "import:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
