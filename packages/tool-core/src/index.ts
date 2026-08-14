import type { EventRiskLevel } from "@soko/event-core";

export interface ToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  risk: EventRiskLevel;
  requiresConfirmation: boolean;
  validate(input: TInput): ValidationResult;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function valid(): ValidationResult {
  return { ok: true, errors: [] };
}

export function invalid(...errors: string[]): ValidationResult {
  return { ok: false, errors };
}

export type RuleIntent =
  | "add_product"
  | "add_customer"
  | "create_invoice"
  | "record_payment"
  | "check_debt"
  | "show_products"
  | "show_invoices"
  | "unknown";

export type ParserNextAction =
  | {
      type: "navigate";
      view: "products" | "invoices" | "payments";
      reason: string;
    }
  | {
      type: "draft";
      reason: string;
    }
  | {
      type: "clarify";
      question: string;
      reason: string;
    };

export interface ParserSlots {
  amount?: number;
  customerName?: string;
  productName?: string;
  quantity?: number;
  unit?: string;
}

export interface ParseResult {
  confidence: number;
  intent: RuleIntent;
  nextAction: ParserNextAction;
  normalizedInput: string;
  slots: ParserSlots;
}

export type RuntimeToolRisk = "low" | "medium" | "high" | "critical";

export interface ToolExecutionContext {
  accountId: string;
  userId: string;
  businessId: string;
  runtimeSessionId: string;
  permissions: string[];
  idempotencyKey: string;
  confirmed: boolean;
}

export interface AgentTool<TInput extends Record<string, unknown>, TOutput> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredPermission: string;
  riskLevel: "read" | "write" | "destructive";
  execute(context: ToolExecutionContext, input: TInput): Promise<TOutput>;
}

export type RuntimeToolName =
  | "products.list"
  | "invoices.list"
  | "product.create"
  | "product.update"
  | "product.delete"
  | "product.stock_adjust"
  | "product.field.add"
  | "product.field.remove"
  | "customer.create"
  | "invoice.draft"
  | "payment.record"
  | "receipt.scan"
  | "receipt.review"
  | "receipt.confirm"
  | "receipt.correct"
  | "receipt.cancel"
  | "receipt.lookup"
  | "receipt.list"
  | "document_import.confirm"
  | "messaging.send"
  | "unknown.clarify";

/**
 * Deliberately a minimal, hand-rollable subset of JSON Schema - not a validation-library
 * dependency - so it can be handed directly to an MCP `inputSchema` field (see
 * services/api/src/mcp/routes.ts, which already writes plain objects in this exact shape) and so
 * mcpSchemaForRuntimeTool() below needs no translation step.
 */
export type RuntimeToolInputFieldType = "string" | "number" | "boolean" | "array" | "object";

export interface RuntimeToolInputFieldSchema {
  type: RuntimeToolInputFieldType;
  /**
   * Documentation/MCP metadata only. validateRuntimeToolInputShape() below deliberately does NOT
   * enforce this - each tool's proposal builder (createRuntimeToolProposal and friends) already
   * enforces required fields with a specific, situation-aware clarification question ("Which
   * product should I delete?") that is better UX than a generic schema error, and is exercised by
   * existing tests (see cp10RuntimeEvalCommands). Duplicating that check here in a second place
   * would risk the two disagreeing.
   */
  required?: boolean;
  description: string;
}

export interface RuntimeToolInputSchema {
  type: "object";
  properties: Record<string, RuntimeToolInputFieldSchema>;
}

export interface RuntimeToolDefinition {
  name: RuntimeToolName;
  description: string;
  risk: RuntimeToolRisk;
  requiresConfirmation: boolean;
  readOnly: boolean;
  requiredPermission: string;
  inputSchema: RuntimeToolInputSchema;
  /**
   * Whether this tool is safe to expose through the MCP surface as its own callable tool. Every
   * entry below is currently false: today's MCP surface (services/api/src/mcp/routes.ts) only
   * exposes a small, separately-curated set of read tools plus the generic
   * soko.runtime_turn/soko.confirm_runtime_action pair, which routes natural-language messages
   * through this exact same registry and createRuntimeTurn pipeline rather than calling any of
   * these tool names directly. This field exists so a future, deliberate decision to expose a
   * specific tool directly is a one-line, reviewable change instead of an accidental default.
   */
  mcpExposable: boolean;
}

export interface RuntimeToolProposal {
  toolName: RuntimeToolName;
  input: Record<string, unknown>;
  reason: string;
  validation: ValidationResult;
}

export type RuntimeModelOutputKind = "tool" | "clarification" | "response";

export interface ParsedRuntimeModelOutput {
  kind: RuntimeModelOutputKind;
  proposal: RuntimeToolProposal;
}

export type ReceiptContextScriptIntent =
  | "RECEIPT_SCAN"
  | "RECEIPT_REVIEW"
  | "RECEIPT_CONFIRM"
  | "RECEIPT_CORRECT"
  | "RECEIPT_CANCEL"
  | "RECEIPT_LOOKUP"
  | "RECEIPT_LIST"
  | "RECEIPT_CONTACT_MATCH"
  | "RECEIPT_SUPPLIER_MATCH"
  | "RECEIPT_SALES_AGENT_MATCH"
  | "RECEIPT_CONTACT_LINK"
  | "RECEIPT_CONTACT_CREATE"
  | "RECEIPT_CONTACT_REVIEW";

export interface ReceiptContextScriptMatch {
  scriptId: "receipt_ocr_commands" | "receipt_contact_matching";
  intent: ReceiptContextScriptIntent;
  matchedPhrase: string;
  confidence: number;
  source: "default";
  clarificationRequired: boolean;
  entities: {
    supplierName?: string;
    itemName?: string;
    dateRange?: string;
  };
}

export const receiptContactMatchingContextScript = {
  script: "receipt_contact_matching",
  version: 1,
  priority: "required",
  enabled: true,
  runtime: {
    run_after: ["receipt_ocr_commands"],
    run_before_model: true,
    require_structured_result: true
  },
  sources: [
    "phone_contacts",
    "google_contacts",
    "meta_contacts",
    "instagram_contacts",
    "linkedin_contacts",
    "x_contacts",
    "whatsapp_contacts",
    "manual_contacts",
    "confirmed_suppliers",
    "confirmed_sales_agents"
  ],
  normalization: {
    phones: {
      format: "E164",
      default_country: "shop_country"
    },
    names: {
      lowercase: true,
      collapse_spaces: true,
      preserve_original: true
    },
    emails: {
      lowercase: true,
      validate: true
    }
  },
  thresholds: {
    auto_select: 0.95,
    confirmation_required: 0.8,
    reject_below: 0.5
  },
  safety: {
    never_overwrite_exact_identifier_match: true,
    never_create_contact_without_confirmation: true,
    never_merge_contacts_without_confirmation: true
  }
} as const;

export interface RuntimeModelOutputParseResult {
  ok: boolean;
  output: ParsedRuntimeModelOutput | null;
  errors: string[];
}

export type ProductContextScriptIntent =
  | "PRODUCT_LOOKUP"
  | "PRODUCT_LIST"
  | "PRODUCT_ADD"
  | "PRODUCT_EDIT"
  | "PRODUCT_UPDATE"
  | "PRODUCT_DELETE"
  | "PRODUCT_STOCK_ADJUST"
  | "PRODUCT_FIELD_ADD"
  | "PRODUCT_FIELD_REMOVE";

export type ProductContextScriptCardinality = "single" | "multiple" | "unknown";
export type ProductContextScriptLanguage = "en" | "sw" | "sheng" | "custom";
export type ProductContextScriptEntrySource = "default" | "custom";

export interface ProductVocabularyEntry {
  phrase: string;
  language: ProductContextScriptLanguage;
  intent: ProductContextScriptIntent;
  entity: "product" | "product_field";
  cardinality: ProductContextScriptCardinality;
  priority: number;
  enabled: boolean;
  tenantId: string | null;
  source: ProductContextScriptEntrySource;
}

export interface ProductVocabularyContextScript {
  script: "product_vocabulary";
  version: 1;
  priority: "required";
  enabled: boolean;
  resolution: {
    runBeforeModel: true;
    fallbackToModel: true;
    minimumConfidence: number;
  };
  entries: ProductVocabularyEntry[];
  lastUpdated: string;
}

export interface ProductContextScriptMatch {
  matched: boolean;
  scriptId: "product-vocabulary";
  intent: ProductContextScriptIntent;
  entity: "product" | "product_field";
  cardinality: ProductContextScriptCardinality;
  confidence: number;
  matchedPhrase: string;
  remainingText: string;
  entities: {
    productName?: string;
    fieldName?: string;
    quantity?: number;
    sku?: string;
  };
  source: "context_script";
  requiresConfirmation: boolean;
  clarificationRequired: boolean;
  fallbackReason: string | null;
}

export interface ProductContextScriptMetrics {
  contextScriptMatchRate: number;
  modelFallbackRate: number;
  clarificationRate: number;
  falseMatchCorrections: number;
  perIntentUsage: Partial<Record<ProductContextScriptIntent, number>>;
}

const productVocabularyUpdatedAt = "2026-07-10T00:00:00.000Z";

const defaultProductVocabularyDefinitions: Array<{
  intent: ProductContextScriptIntent;
  entity: ProductVocabularyEntry["entity"];
  phrases: Partial<Record<ProductContextScriptLanguage, string[]>>;
  cardinality?: ProductContextScriptCardinality;
}> = [
  {
    intent: "PRODUCT_LOOKUP",
    entity: "product",
    phrases: {
      en: [
        "find product",
        "find products",
        "search product",
        "search products",
        "look up product",
        "look up products"
      ],
      sw: ["tafuta bidhaa"]
    }
  },
  {
    intent: "PRODUCT_LIST",
    entity: "product",
    phrases: {
      en: [
        "product",
        "products",
        "item",
        "items",
        "stock",
        "stocks",
        "goods",
        "catalogue",
        "catalog",
        "menu",
        "inventory",
        "show product",
        "show products",
        "show stock",
        "list product",
        "list products",
        "list stock",
        "available products",
        "what do I sell"
      ],
      sw: ["bidhaa", "bidhaa zangu", "onyesha bidhaa", "orodha ya bidhaa", "bidhaa zilizopo"],
      sheng: ["stock iko aje"]
    }
  },
  {
    intent: "PRODUCT_ADD",
    entity: "product",
    phrases: {
      en: [
        "add product",
        "add products",
        "add item",
        "add items",
        "create product",
        "create products",
        "create item",
        "new product",
        "new products",
        "new item",
        "record product",
        "record stock",
        "add stock",
        "enter product",
        "enter products"
      ],
      sw: ["ongeza bidhaa", "ingiza bidhaa", "weka bidhaa", "sajili bidhaa", "ongeza stock"]
    }
  },
  {
    intent: "PRODUCT_EDIT",
    entity: "product",
    phrases: {
      en: [
        "edit",
        "edit product",
        "edit products",
        "edit item",
        "edit items",
        "modify product",
        "modify products",
        "modify item",
        "update product",
        "update products",
        "update item",
        "change product",
        "change products",
        "correct product",
        "correct item",
        "revise product",
        "rename product",
        "alter product"
      ],
      sw: [
        "hariri bidhaa",
        "badilisha",
        "badilisha bidhaa",
        "rekebisha bidhaa",
        "sahihisha bidhaa",
        "update bidhaa"
      ]
    }
  },
  {
    intent: "PRODUCT_DELETE",
    entity: "product",
    phrases: {
      en: [
        "delete product",
        "delete products",
        "delete these products",
        "delete item",
        "delete items",
        "remove product",
        "remove products",
        "remove these products",
        "remove item",
        "remove items",
        "erase product",
        "discard product",
        "clear product",
        "clear products",
        "permanently remove product"
      ],
      sw: ["futa bidhaa", "ondoa bidhaa", "toa bidhaa", "delete bidhaa"]
    }
  },
  {
    intent: "PRODUCT_STOCK_ADJUST",
    entity: "product",
    phrases: {
      en: [
        "adjust stock",
        "change quantity",
        "update quantity",
        "add quantity",
        "reduce quantity",
        "increase stock",
        "decrease stock",
        "stock adjustment",
        "correct stock"
      ],
      sw: ["rekebisha stock", "ongeza idadi", "punguza idadi"]
    }
  },
  {
    intent: "PRODUCT_FIELD_ADD",
    entity: "product_field",
    phrases: {
      en: [
        "add field",
        "add product field",
        "create field",
        "new field",
        "add attribute",
        "add column"
      ],
      sw: ["ongeza sehemu", "ongeza field"]
    }
  },
  {
    intent: "PRODUCT_FIELD_REMOVE",
    entity: "product_field",
    phrases: {
      en: [
        "remove field",
        "delete field",
        "remove product field",
        "delete product field",
        "remove attribute",
        "remove column"
      ],
      sw: ["futa sehemu", "ondoa field"]
    }
  }
];

export const defaultProductVocabularyContextScript: ProductVocabularyContextScript = {
  script: "product_vocabulary",
  version: 1,
  priority: "required",
  enabled: true,
  resolution: {
    runBeforeModel: true,
    fallbackToModel: true,
    minimumConfidence: 0.82
  },
  entries: defaultProductVocabularyDefinitions.flatMap((definition) =>
    Object.entries(definition.phrases).flatMap(([language, phrases]) =>
      (phrases ?? []).map((phrase, index) => ({
        phrase,
        language: language as ProductContextScriptLanguage,
        intent: definition.intent,
        entity: definition.entity,
        cardinality: inferCardinality(phrase, definition.cardinality),
        priority: 100 - index,
        enabled: true,
        tenantId: null,
        source: "default" as const
      }))
    )
  ),
  lastUpdated: productVocabularyUpdatedAt
};

export const runtimeToolRegistry: Record<RuntimeToolName, RuntimeToolDefinition> = {
  "products.list": {
    name: "products.list",
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
    description: "List invoices for the active business.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "invoice:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "product.create": {
    name: "product.create",
    description: "Create a new catalogue product with a name, unit, and starting quantity.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", required: true, description: "Product name." },
        unit: {
          type: "string",
          required: true,
          description: "Stock-keeping unit, e.g. \"kg\" or \"unit\"."
        },
        quantity: { type: "number", description: "Starting stock quantity." }
      }
    },
    mcpExposable: false
  },
  "product.update": {
    name: "product.update",
    description: "Update an existing catalogue product's details.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string", required: true, description: "Product to update." }
      }
    },
    mcpExposable: false
  },
  "product.delete": {
    name: "product.delete",
    description: "Permanently delete a catalogue product.",
    risk: "critical",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string", required: true, description: "Product to delete." }
      }
    },
    mcpExposable: false
  },
  "product.stock_adjust": {
    name: "product.stock_adjust",
    description: "Adjust a catalogue product's on-hand stock quantity.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string", required: true, description: "Product to adjust." },
        quantity: {
          type: "number",
          required: true,
          description: "New quantity or quantity delta."
        }
      }
    },
    mcpExposable: false
  },
  "product.field.add": {
    name: "product.field.add",
    description: "Add a custom field to the product schema.",
    risk: "medium",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        fieldName: { type: "string", required: true, description: "Custom field name to add." }
      }
    },
    mcpExposable: false
  },
  "product.field.remove": {
    name: "product.field.remove",
    description: "Remove a custom field from the product schema.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        fieldName: { type: "string", required: true, description: "Custom field name to remove." }
      }
    },
    mcpExposable: false
  },
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
        name: { type: "string", required: true, description: "Customer name." }
      }
    },
    mcpExposable: false
  },
  "invoice.draft": {
    name: "invoice.draft",
    description: "Draft a new invoice for a customer.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "invoice:write",
    inputSchema: {
      type: "object",
      properties: {
        customerName: { type: "string", required: true, description: "Customer to invoice." },
        quantity: { type: "number", description: "Quantity of the invoiced item." }
      }
    },
    mcpExposable: false
  },
  "payment.record": {
    name: "payment.record",
    description: "Record a payment against an invoice or customer balance.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "payment:write",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", required: true, description: "Payment amount." },
        customerName: { type: "string", required: true, description: "Paying customer." }
      }
    },
    mcpExposable: false
  },
  "receipt.scan": {
    name: "receipt.scan",
    description: "Start OCR scanning of an uploaded purchase receipt.",
    risk: "medium",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "receipt.review": {
    name: "receipt.review",
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
    description: "Confirm a reviewed purchase receipt, writing it into purchase history.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        ocrJobId: { type: "string", required: true, description: "Receipt scan to confirm." }
      }
    },
    mcpExposable: false
  },
  "receipt.correct": {
    name: "receipt.correct",
    description: "Correct a previously confirmed purchase receipt.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "import:write",
    inputSchema: {
      type: "object",
      properties: {
        ocrJobId: { type: "string", required: true, description: "Receipt scan to correct." }
      }
    },
    mcpExposable: false
  },
  "receipt.cancel": {
    name: "receipt.cancel",
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
    description: "List all purchase receipts for the active business.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "import:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "document_import.confirm": {
    name: "document_import.confirm",
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
  },
  "messaging.send": {
    name: "messaging.send",
    description: "Send a message to a customer over a connected channel.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "customer:write",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", required: true, description: "Message body." },
        customerId: { type: "string", description: "Recipient customer id." },
        customerName: { type: "string", description: "Recipient customer name." },
        conversationId: { type: "string", description: "Existing conversation to reply in." },
        provider: { type: "string", description: "Channel provider (e.g. sms, email)." },
        mailboxId: { type: "string", description: "Connected mailbox to send from." },
        subject: { type: "string", description: "Message subject, for email-like channels." },
        replyToMessageId: { type: "string", description: "Message being replied to." },
        attachments: { type: "array", description: "Attachments to include, e.g. an invoice." }
      }
    },
    mcpExposable: false
  },
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
};

/** Adapts a canonical Soko tool definition into an MCP `tools/list` entry, for tools that opt in
 * via mcpExposable. Not currently called anywhere in this codebase (see mcpExposable's comment
 * above) - provided so a future, deliberate MCP exposure decision does not need to hand-write a
 * schema that already exists here. */
export function mcpSchemaForRuntimeTool(toolName: RuntimeToolName): {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
} {
  const definition = runtimeToolRegistry[toolName];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [field, fieldSchema] of Object.entries(definition.inputSchema.properties)) {
    properties[field] = { type: fieldSchema.type, description: fieldSchema.description };
    if (fieldSchema.required) required.push(field);
  }
  return {
    name: `soko.${definition.name}`,
    description: definition.description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      ...(required.length > 0 ? { required } : {}),
      properties
    },
    annotations: {
      readOnlyHint: definition.readOnly,
      destructiveHint: definition.risk === "critical"
    }
  };
}

/** Canonical structured-output contract shared by server and on-device model adapters. */
export function renderRuntimeModelOutputInstructions(
  allowedTools: readonly RuntimeToolName[]
): string {
  const tools = [...new Set(allowedTools)].join(", ");
  return [
    "Return only one JSON object. Do not include markdown or surrounding commentary.",
    'Allowed shapes: {"type":"tool","toolName":"products.list","input":{},"reason":"..."}',
    'or {"type":"clarification","message":"..."}',
    'or {"type":"response","message":"..."}.',
    `Allowed tools: ${tools || "none"}.`,
    "A tool proposal is only a request; the Soko server validates permissions and confirmation before execution."
  ].join("\n");
}

export function createRuntimeToolProposal(result: ParseResult): RuntimeToolProposal {
  switch (result.intent) {
    case "show_products":
      return {
        toolName: "products.list",
        input: {},
        reason: "List products for the active business.",
        validation: valid()
      };

    case "show_invoices":
      return {
        toolName: "invoices.list",
        input: {},
        reason: "List invoices for the active business.",
        validation: valid()
      };

    case "add_product":
      return {
        toolName: "product.create",
        input: {
          name: result.slots.productName ?? "",
          unit: result.slots.unit ?? "unit",
          quantity: result.slots.quantity ?? 0
        },
        reason: "Draft a product creation action from the merchant command.",
        validation:
          result.slots.productName === undefined
            ? invalid("Product name is required before a product can be drafted.")
            : valid()
      };

    case "add_customer":
      return {
        toolName: "customer.create",
        input: {
          name: result.slots.customerName ?? ""
        },
        reason: "Draft a customer creation action from the merchant command.",
        validation:
          result.slots.customerName === undefined
            ? invalid("Customer name is required before a customer can be drafted.")
            : valid()
      };

    case "create_invoice":
      return {
        toolName: "invoice.draft",
        input: {
          customerName: result.slots.customerName ?? null,
          quantity: result.slots.quantity ?? null
        },
        reason: "Draft an invoice action from the merchant command.",
        validation: invalid("Invoice runtime draft needs product and price details.")
      };

    case "record_payment":
      return {
        toolName: "payment.record",
        input: {
          amount: result.slots.amount ?? null,
          customerName: result.slots.customerName ?? null
        },
        reason: "Draft a payment recording action from the merchant command.",
        validation: invalid("Payment runtime draft needs an invoice id and method.")
      };

    case "check_debt":
    case "unknown":
      return {
        toolName: "unknown.clarify",
        input: {},
        reason:
          result.nextAction.type === "clarify" ? result.nextAction.reason : "Clarify request.",
        validation: invalid(
          result.nextAction.type === "clarify"
            ? result.nextAction.question
            : "I need more details before I can plan that action."
        )
      };
  }
}

export function createRuntimeToolProposalFromProductContextScript(
  match: ProductContextScriptMatch
): RuntimeToolProposal {
  switch (match.intent) {
    case "PRODUCT_LOOKUP":
    case "PRODUCT_LIST":
      return {
        toolName: "products.list",
        input: {
          ...(match.entities.productName === undefined
            ? {}
            : { query: match.entities.productName }),
          cardinality: match.cardinality,
          source: match.source
        },
        reason: `Product vocabulary matched "${match.matchedPhrase}" before model fallback.`,
        validation: valid()
      };

    case "PRODUCT_ADD":
      return {
        toolName: "product.create",
        input: {
          name:
            match.entities.productName === undefined ? "" : titleCase(match.entities.productName),
          unit: "unit",
          quantity: match.entities.quantity ?? 0,
          cardinality: match.cardinality,
          source: match.source
        },
        reason: `Product vocabulary routed add-product intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.productName === undefined
            ? invalid("Which product should I draft?")
            : valid()
      };

    case "PRODUCT_EDIT":
    case "PRODUCT_UPDATE":
      return {
        toolName: "product.update",
        input: {
          productName: match.entities.productName ?? "",
          cardinality: match.cardinality,
          source: match.source
        },
        reason: `Product vocabulary routed edit-product intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.productName === undefined
            ? invalid("Which product should I edit?")
            : invalid("Which product details should I change?")
      };

    case "PRODUCT_DELETE":
      return {
        toolName: "product.delete",
        input: {
          productName: match.entities.productName ?? "",
          cardinality: match.cardinality,
          source: match.source
        },
        reason: `Product vocabulary routed delete-product intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.productName === undefined
            ? invalid(
                match.cardinality === "multiple"
                  ? "Which products should I delete?"
                  : "Which product should I delete?"
              )
            : valid()
      };

    case "PRODUCT_STOCK_ADJUST":
      return {
        toolName: "product.stock_adjust",
        input: {
          productName: match.entities.productName ?? "",
          quantity: match.entities.quantity ?? null,
          cardinality: match.cardinality,
          source: match.source
        },
        reason: `Product vocabulary routed stock-adjustment intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.productName === undefined
            ? invalid("Which product stock should I adjust?")
            : invalid("What quantity change should I apply?")
      };

    case "PRODUCT_FIELD_ADD":
      return {
        toolName: "product.field.add",
        input: {
          fieldName: match.entities.fieldName ?? "",
          source: match.source
        },
        reason: `Product vocabulary routed add-field intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.fieldName === undefined
            ? invalid("Which product field should I add?")
            : valid()
      };

    case "PRODUCT_FIELD_REMOVE":
      return {
        toolName: "product.field.remove",
        input: {
          fieldName: match.entities.fieldName ?? "",
          source: match.source
        },
        reason: `Product vocabulary routed remove-field intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.fieldName === undefined
            ? invalid("Which product field should I remove?")
            : valid()
      };
  }
}

export function parseProductContextScriptCommand(input: {
  message: string;
  tenantId?: string | null;
  contextScripts?: string[];
}): ProductContextScriptMatch | null {
  const script = buildProductVocabularyContextScript({
    tenantId: input.tenantId ?? null,
    contextScripts: input.contextScripts ?? []
  });

  if (!script.enabled) {
    return null;
  }

  return matchProductVocabulary(input.message, script);
}

export function parseReceiptContextScriptCommand(input: {
  message: string;
  tenantId?: string | null;
  contextScripts?: string[];
}): ReceiptContextScriptMatch | null {
  const enabled =
    input.contextScripts === undefined ||
    input.contextScripts.length === 0 ||
    input.contextScripts.some((script) => script.includes("receipt_ocr_commands"));

  if (!enabled) {
    return null;
  }

  const normalized = normalizeContextText(input.message);
  const exactMatches: Array<{
    phrases: string[];
    intent: ReceiptContextScriptIntent;
  }> = [
    {
      intent: "RECEIPT_SCAN",
      phrases: [
        "upload receipt",
        "scan receipt",
        "upload this receipt",
        "scan this receipt",
        "skani risiti"
      ]
    },
    {
      intent: "RECEIPT_REVIEW",
      phrases: ["review receipt", "show receipt ocr", "check receipt scan"]
    },
    {
      intent: "RECEIPT_CONFIRM",
      phrases: ["confirm receipt", "save receipt", "save purchase receipt"]
    },
    {
      intent: "RECEIPT_CORRECT",
      phrases: ["correct receipt", "fix receipt", "edit receipt"]
    },
    {
      intent: "RECEIPT_CANCEL",
      phrases: ["cancel receipt", "discard receipt", "delete receipt scan"]
    },
    {
      intent: "RECEIPT_LOOKUP",
      phrases: ["which supplier sold", "find receipt", "lookup receipt", "search receipts"]
    },
    {
      intent: "RECEIPT_LIST",
      phrases: ["show receipts", "list receipts", "show purchase receipts"]
    },
    {
      intent: "RECEIPT_CONTACT_MATCH",
      phrases: [
        "match this receipt to a supplier",
        "match receipt contacts",
        "link this receipt to my contacts",
        "linganisha risiti na supplier",
        "unganisha risiti na contacts",
        "match hii receipt na supplier",
        "link hii risiti na phonebook"
      ]
    },
    {
      intent: "RECEIPT_SUPPLIER_MATCH",
      phrases: [
        "find the supplier from this receipt",
        "find this supplier in my phonebook",
        "tafuta supplier wa risiti",
        "tafuta supplier kwa contacts"
      ]
    },
    {
      intent: "RECEIPT_SALES_AGENT_MATCH",
      phrases: ["identify the sales agent", "tambua sales agent", "tafuta sales agent kwa contacts"]
    },
    {
      intent: "RECEIPT_CONTACT_CREATE",
      phrases: [
        "save supplier from receipt",
        "create supplier from this receipt",
        "tengeneza supplier kutoka risiti"
      ]
    },
    {
      intent: "RECEIPT_CONTACT_REVIEW",
      phrases: ["show receipts from this contact", "review receipt contacts"]
    }
  ];

  for (const definition of exactMatches) {
    const matchedPhrase = definition.phrases.find((phrase) => normalized.includes(phrase));

    if (matchedPhrase !== undefined) {
      return {
        scriptId: "receipt_ocr_commands",
        intent: definition.intent,
        matchedPhrase,
        confidence: 0.94,
        source: "default",
        clarificationRequired:
          definition.intent === "RECEIPT_SCAN" && !normalized.includes("receipt"),
        entities: extractReceiptEntities(normalized)
      };
    }
  }

  return null;
}

export function receiptContextScriptMatchToParseResult(
  match: ReceiptContextScriptMatch
): ParseResult {
  return {
    confidence: match.confidence,
    intent:
      match.intent === "RECEIPT_LIST" || match.intent === "RECEIPT_LOOKUP"
        ? "show_invoices"
        : "unknown",
    nextAction: match.clarificationRequired
      ? {
          type: "clarify",
          question: "Attach or take a receipt photo before I scan it.",
          reason: "Receipt OCR command matched but no receipt attachment was provided."
        }
      : {
          type: "draft",
          reason: `Receipt OCR context script routed ${match.intent}.`
        },
    normalizedInput: normalizeContextText(match.matchedPhrase),
    slots: {}
  };
}

export function createRuntimeToolProposalFromReceiptContextScript(
  match: ReceiptContextScriptMatch
): RuntimeToolProposal {
  const baseInput = {
    source: match.source,
    supplierName: match.entities.supplierName ?? null,
    itemName: match.entities.itemName ?? null,
    dateRange: match.entities.dateRange ?? null
  };

  switch (match.intent) {
    case "RECEIPT_SCAN":
      return {
        toolName: "receipt.scan",
        input: baseInput,
        reason: `Receipt OCR commands matched "${match.matchedPhrase}" before model fallback.`,
        validation: invalid("Attach or take a receipt photo before I scan it.")
      };

    case "RECEIPT_REVIEW":
      return {
        toolName: "receipt.review",
        input: baseInput,
        reason: `Receipt OCR commands routed review from "${match.matchedPhrase}".`,
        validation: valid()
      };

    case "RECEIPT_CONFIRM":
      return {
        toolName: "receipt.confirm",
        input: baseInput,
        reason: `Receipt OCR commands routed confirmation from "${match.matchedPhrase}".`,
        validation: invalid("Which receipt scan should I confirm?")
      };

    case "RECEIPT_CORRECT":
      return {
        toolName: "receipt.correct",
        input: baseInput,
        reason: `Receipt OCR commands routed correction from "${match.matchedPhrase}".`,
        validation: invalid("Which receipt field should I correct?")
      };

    case "RECEIPT_CANCEL":
      return {
        toolName: "receipt.cancel",
        input: baseInput,
        reason: `Receipt OCR commands routed cancellation from "${match.matchedPhrase}".`,
        validation: invalid("Which receipt scan should I cancel?")
      };

    case "RECEIPT_LOOKUP":
      return {
        toolName: "receipt.lookup",
        input: baseInput,
        reason: `Receipt OCR commands routed lookup from "${match.matchedPhrase}".`,
        validation: valid()
      };

    case "RECEIPT_LIST":
    case "RECEIPT_CONTACT_MATCH":
    case "RECEIPT_SUPPLIER_MATCH":
    case "RECEIPT_SALES_AGENT_MATCH":
    case "RECEIPT_CONTACT_LINK":
    case "RECEIPT_CONTACT_CREATE":
    case "RECEIPT_CONTACT_REVIEW":
      return {
        toolName:
          match.intent === "RECEIPT_LIST" || match.intent === "RECEIPT_CONTACT_REVIEW"
            ? "receipt.list"
            : "receipt.review",
        input: baseInput,
        reason: `Receipt contact context routed ${match.intent} from "${match.matchedPhrase}".`,
        validation: valid()
      };
  }
}

export function productContextScriptMatchToParseResult(
  match: ProductContextScriptMatch
): ParseResult {
  const intent = productContextIntentToRuleIntent(match.intent);
  const slots: ParserSlots = {};

  if (match.entities.productName !== undefined) {
    slots.productName = titleCase(match.entities.productName);
  }

  if (match.entities.quantity !== undefined) {
    slots.quantity = match.entities.quantity;
  }

  return {
    confidence: match.confidence,
    intent,
    nextAction: match.clarificationRequired
      ? {
          type: "clarify",
          question: contextScriptClarification(match),
          reason: "Product vocabulary matched but required arguments are missing."
        }
      : getNextAction(intent === "unknown" ? "show_products" : intent),
    normalizedInput: normalizeContextText(match.matchedPhrase),
    slots
  };
}

export function parseRuntimeModelOutput(outputText: string): RuntimeModelOutputParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    return {
      ok: false,
      output: null,
      errors: ["Local model returned malformed JSON."]
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      output: null,
      errors: ["Local model output must be a JSON object."]
    };
  }

  const kind = parsed.type;

  if (kind === "tool") {
    const toolName = parsed.toolName;
    const input = parsed.input;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : "Local model proposed a runtime tool.";

    if (!isRuntimeToolName(toolName)) {
      return {
        ok: false,
        output: null,
        errors: ["Local model proposed an unsupported runtime tool."]
      };
    }

    const toolInput = isRecord(input) ? input : {};

    return {
      ok: true,
      output: {
        kind: "tool",
        proposal: {
          toolName,
          input: toolInput,
          reason,
          validation: validateRuntimeToolInput(toolName, toolInput)
        }
      },
      errors: []
    };
  }

  if (kind === "clarification") {
    const message = parseModelMessage(
      parsed.message,
      "I need more details before I can plan that."
    );

    return {
      ok: true,
      output: {
        kind: "clarification",
        proposal: {
          toolName: "unknown.clarify",
          input: {},
          reason: "Local model requested clarification.",
          validation: invalid(message)
        }
      },
      errors: []
    };
  }

  if (kind === "response") {
    const message = parseModelMessage(
      parsed.message,
      "I can help with products, invoices, payments, and imports."
    );

    return {
      ok: true,
      output: {
        kind: "response",
        proposal: {
          toolName: "unknown.clarify",
          input: {},
          reason: message,
          validation: valid()
        }
      },
      errors: []
    };
  }

  return {
    ok: false,
    output: null,
    errors: ["Local model output type must be tool, clarification, or response."]
  };
}

export function validateRuntimeToolInput(
  toolName: RuntimeToolName,
  input: Record<string, unknown>
): ValidationResult {
  switch (toolName) {
    case "products.list":
    case "invoices.list":
    case "receipt.review":
    case "receipt.lookup":
    case "receipt.list":
    case "unknown.clarify":
      return valid();

    case "receipt.scan":
      return invalid("Attach or take a receipt photo before I scan it.");

    case "receipt.confirm":
      return typeof input.ocrJobId === "string" && input.ocrJobId.trim().length > 0
        ? valid()
        : invalid("Which receipt scan should I confirm?");

    case "receipt.correct":
      return typeof input.ocrJobId === "string" && input.ocrJobId.trim().length > 0
        ? valid()
        : invalid("Which receipt field should I correct?");

    case "receipt.cancel":
      return typeof input.ocrJobId === "string" && input.ocrJobId.trim().length > 0
        ? valid()
        : invalid("Which receipt scan should I cancel?");

    case "document_import.confirm":
      return typeof input.importJobId === "string" && input.importJobId.trim().length > 0
        ? valid()
        : invalid("Which document import should I add?");

    case "messaging.send": {
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
      const conversationId =
        typeof input.conversationId === "string" ? input.conversationId.trim() : "";
      const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
      const provider = typeof input.provider === "string" ? input.provider.trim() : "";
      const subject = typeof input.subject === "string" ? input.subject.trim() : "";
      const errors: string[] = [];
      if (text.length === 0 || text.length > 4000) {
        errors.push("A message between 1 and 4000 characters is required.");
      }
      if (customerId === "" && conversationId === "" && customerName === "") {
        errors.push("Choose a canonical customer or conversation before sending.");
      }
      if (provider === "email" && (subject.length === 0 || subject.length > 200)) {
        errors.push("Email requires a subject between 1 and 200 characters.");
      }
      if (input.attachments !== undefined) {
        if (!Array.isArray(input.attachments) || input.attachments.length > 3) {
          errors.push("Email supports at most three trusted attachment references.");
        } else if (
          input.attachments.some(
            (attachment) =>
              attachment === null ||
              typeof attachment !== "object" ||
              (attachment as Record<string, unknown>).resourceType !== "invoice" ||
              typeof (attachment as Record<string, unknown>).resourceId !== "string"
          )
        ) {
          errors.push("Email attachments must reference trusted invoice resources.");
        }
      }
      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.create": {
      const errors: string[] = [];
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const unit = typeof input.unit === "string" ? input.unit.trim() : "";
      const quantity = Number(input.quantity ?? 0);

      if (name.length === 0) {
        errors.push("Product name is required before a product can be drafted.");
      }

      if (unit.length === 0) {
        errors.push("Product unit is required before a product can be drafted.");
      }

      if (!Number.isFinite(quantity) || quantity < 0) {
        errors.push("Product quantity must be a non-negative number.");
      }

      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.update": {
      const productName = typeof input.productName === "string" ? input.productName.trim() : "";
      const errors: string[] = [];

      if (productName.length === 0) {
        errors.push("Which product should I edit?");
      }

      errors.push("Which product details should I change?");

      return invalid(...errors);
    }

    case "product.delete": {
      const productName = typeof input.productName === "string" ? input.productName.trim() : "";
      const productIds = Array.isArray(input.productIds) ? input.productIds : [];

      return productName.length === 0 && productIds.length === 0
        ? invalid("Which product should I delete?")
        : valid();
    }

    case "product.stock_adjust": {
      const productName = typeof input.productName === "string" ? input.productName.trim() : "";
      const quantity = Number(input.quantity);
      const errors: string[] = [];

      if (productName.length === 0) {
        errors.push("Which product stock should I adjust?");
      }

      if (!Number.isFinite(quantity)) {
        errors.push("What quantity change should I apply?");
      }

      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.field.add": {
      const fieldName = typeof input.fieldName === "string" ? input.fieldName.trim() : "";

      return fieldName.length === 0 ? invalid("Which product field should I add?") : valid();
    }

    case "product.field.remove": {
      const fieldName = typeof input.fieldName === "string" ? input.fieldName.trim() : "";

      return fieldName.length === 0 ? invalid("Which product field should I remove?") : valid();
    }

    case "customer.create": {
      const name = typeof input.name === "string" ? input.name.trim() : "";

      return name.length === 0
        ? invalid("Customer name is required before a customer can be drafted.")
        : valid();
    }

    case "invoice.draft":
      return invalid("Invoice runtime draft needs product and price details.");

    case "payment.record":
      return invalid("Payment runtime draft needs an invoice id and method.");
  }
}

export function shouldUseStructuredFallback(
  result: ParseResult,
  previousClarificationCount: number
): boolean {
  return result.nextAction.type === "clarify" && previousClarificationCount >= 2;
}

interface IntentRule {
  intent: Exclude<RuleIntent, "unknown">;
  keywords: string[];
  phrases: string[];
  weight: number;
}

const highConfidenceThreshold = 0.44;
const lowConfidenceThreshold = 0.42;

const intentRules: IntentRule[] = [
  {
    intent: "show_products",
    keywords: ["products", "product", "bidhaa", "stock", "inventory"],
    phrases: [
      "show products",
      "list products",
      "open products",
      "show stock",
      "list stock",
      "onyesha bidhaa"
    ],
    weight: 1
  },
  {
    intent: "show_invoices",
    keywords: ["invoices", "invoice", "ankara", "bills", "sales"],
    phrases: [
      "show invoices",
      "list invoices",
      "open invoices",
      "show sales",
      "list sales",
      "onyesha ankara",
      "invoice list"
    ],
    weight: 1
  },
  {
    intent: "add_product",
    keywords: [
      "add",
      "ongeza",
      "new",
      "stock",
      "product",
      "bidhaa",
      "item",
      "weka",
      "packet",
      "packets",
      "bag",
      "bags",
      "cement"
    ],
    phrases: [
      "add product",
      "add packet",
      "add packets",
      "add bag",
      "add bags",
      "add stock",
      "new product",
      "new item",
      "stock product",
      "ongeza bidhaa",
      "ongeza product",
      "ongeza stock",
      "weka bidhaa"
    ],
    weight: 1.08
  },
  {
    intent: "add_customer",
    keywords: ["add", "ongeza", "new", "customer", "client", "mteja", "mpya"],
    phrases: [
      "add customer",
      "new customer",
      "ongeza mteja",
      "ongeza customer",
      "add client",
      "add mteja",
      "new client",
      "new mteja",
      "mteja mpya"
    ],
    weight: 1.08
  },
  {
    intent: "create_invoice",
    keywords: ["invoice", "ankara", "bill", "sell", "sale", "uza", "create", "make"],
    phrases: [
      "create invoice",
      "make invoice",
      "new invoice",
      "andika ankara",
      "invoice customer",
      "create bill"
    ],
    weight: 1
  },
  {
    intent: "record_payment",
    keywords: ["payment", "paid", "pay", "malipo", "amelipa", "mpesa", "cash", "received"],
    phrases: [
      "record payment",
      "mark paid",
      "received payment",
      "ame lipa",
      "malipo ya",
      "customer paid",
      "mpesa"
    ],
    weight: 1
  },
  {
    intent: "check_debt",
    keywords: ["debt", "deni", "owes", "owe", "balance", "baki", "credit"],
    phrases: [
      "check debt",
      "show debt",
      "ana deni",
      "customer balance",
      "owes how much",
      "baki ya"
    ],
    weight: 1
  }
];

const commandWords = new Set([
  "add",
  "andika",
  "create",
  "for",
  "invoice",
  "list",
  "make",
  "new",
  "open",
  "ongeza",
  "record",
  "show",
  "stock",
  "the",
  "to",
  "weka"
]);

export function parseMerchantCommand(input: string): ParseResult {
  const normalizedInput = normalizeInput(input);

  if (normalizedInput.length === 0) {
    return createUnknownResult(normalizedInput, "Type a command first.");
  }

  const scores = intentRules.map((rule) => ({
    intent: rule.intent,
    score: scoreRule(normalizedInput, rule)
  }));
  scores.sort((left, right) => right.score - left.score);

  const best = scores[0];
  const second = scores[1];
  const confidence =
    best === undefined
      ? 0
      : Math.min(0.99, roundConfidence(best.score - (second?.score ?? 0) * 0.25));

  if (
    best === undefined ||
    best.score < lowConfidenceThreshold ||
    confidence < lowConfidenceThreshold
  ) {
    return createUnknownResult(
      normalizedInput,
      "I could not match that to a Soko command. Try products, customers, invoices, payments, or debt."
    );
  }

  const intent = best.intent;
  const slots = extractSlots(normalizedInput, intent);

  if (confidence < highConfidenceThreshold) {
    return {
      confidence,
      intent,
      nextAction: {
        type: "clarify",
        question: `Did you mean ${formatIntent(intent)}?`,
        reason: "Parser confidence is below the action threshold."
      },
      normalizedInput,
      slots
    };
  }

  const missingSlotQuestion = getMissingSlotQuestion(intent, slots);

  if (missingSlotQuestion !== undefined) {
    return {
      confidence,
      intent,
      nextAction: {
        type: "clarify",
        question: missingSlotQuestion,
        reason: "A required slot is missing."
      },
      normalizedInput,
      slots
    };
  }

  return {
    confidence,
    intent,
    nextAction: getNextAction(intent),
    normalizedInput,
    slots
  };
}

function createUnknownResult(normalizedInput: string, question: string): ParseResult {
  return {
    confidence: 0,
    intent: "unknown",
    nextAction: {
      type: "clarify",
      question,
      reason: "No supported intent matched."
    },
    normalizedInput,
    slots: {}
  };
}

export function buildProductVocabularyContextScript(input: {
  tenantId: string | null;
  contextScripts: string[];
}): ProductVocabularyContextScript {
  const customEntries = input.contextScripts.flatMap((script, scriptIndex) =>
    parseProductVocabularyScriptEntries(script, input.tenantId, scriptIndex)
  );

  return {
    ...defaultProductVocabularyContextScript,
    entries: [...customEntries, ...defaultProductVocabularyContextScript.entries],
    lastUpdated:
      customEntries.length === 0
        ? defaultProductVocabularyContextScript.lastUpdated
        : new Date(0).toISOString()
  };
}

export function validateProductVocabularyContextScript(
  script: ProductVocabularyContextScript
): ValidationResult {
  const errors: string[] = [];

  if (script.script !== "product_vocabulary") {
    errors.push("Context script must be product_vocabulary.");
  }

  if (script.version !== 1) {
    errors.push("Product vocabulary script version must be 1.");
  }

  if (script.priority !== "required") {
    errors.push("Product vocabulary script priority must be required.");
  }

  if (!script.resolution.runBeforeModel) {
    errors.push("Product vocabulary must run before model fallback.");
  }

  if (script.resolution.minimumConfidence < 0.5 || script.resolution.minimumConfidence > 1) {
    errors.push("Minimum confidence must be between 0.5 and 1.");
  }

  for (const [index, entry] of script.entries.entries()) {
    if (entry.phrase.trim().length === 0) {
      errors.push(`Vocabulary entry ${index + 1} phrase is required.`);
    }

    if (!isProductContextIntent(entry.intent)) {
      errors.push(`Vocabulary entry ${index + 1} has an unsupported intent.`);
    }
  }

  return errors.length === 0 ? valid() : invalid(...errors);
}

function matchProductVocabulary(
  message: string,
  script: ProductVocabularyContextScript
): ProductContextScriptMatch | null {
  const normalizedMessage = normalizeContextText(message);

  if (normalizedMessage.length === 0) {
    return null;
  }

  const entries = script.entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      entry,
      normalizedPhrase: normalizeContextText(entry.phrase)
    }))
    .filter((candidate) => candidate.normalizedPhrase.length > 0)
    .sort((left, right) => {
      const sourcePriority =
        sourceRank(right.entry.source) - sourceRank(left.entry.source) ||
        (right.entry.tenantId === null ? 0 : 1) - (left.entry.tenantId === null ? 0 : 1);

      if (sourcePriority !== 0) {
        return sourcePriority;
      }

      return (
        right.normalizedPhrase.split(" ").length - left.normalizedPhrase.split(" ").length ||
        right.entry.priority - left.entry.priority ||
        right.normalizedPhrase.length - left.normalizedPhrase.length
      );
    });

  for (const candidate of entries) {
    const position = findVocabularyPhrasePosition(normalizedMessage, candidate.normalizedPhrase);

    if (position === null) {
      continue;
    }

    if (candidate.entry.intent === "PRODUCT_DELETE" && hasDestructiveNegation(normalizedMessage)) {
      return null;
    }

    const remainingText = extractRemainingText(
      normalizedMessage,
      position,
      candidate.normalizedPhrase
    );
    const resolvedIntent =
      candidate.entry.intent === "PRODUCT_LOOKUP" && remainingText.length === 0
        ? "PRODUCT_LIST"
        : candidate.entry.intent;
    const cardinality =
      detectCardinality(normalizedMessage, candidate.entry.phrase) ?? candidate.entry.cardinality;
    const entities = extractProductContextEntities(
      remainingText,
      resolvedIntent,
      candidate.entry.entity
    );

    return {
      matched: true,
      scriptId: "product-vocabulary",
      intent: resolvedIntent,
      entity: candidate.entry.entity,
      cardinality,
      confidence: candidate.entry.source === "custom" ? 0.98 : 0.96,
      matchedPhrase: candidate.entry.phrase,
      remainingText,
      entities,
      source: "context_script",
      requiresConfirmation: productContextRequiresConfirmation(resolvedIntent),
      clarificationRequired: productContextNeedsClarification(resolvedIntent, entities),
      fallbackReason: null
    };
  }

  return null;
}

function parseProductVocabularyScriptEntries(
  script: string,
  tenantId: string | null,
  scriptIndex: number
): ProductVocabularyEntry[] {
  const trimmed = script.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const jsonEntries = parseProductVocabularyJsonEntries(trimmed, tenantId);

  if (jsonEntries !== null) {
    return jsonEntries;
  }

  return trimmed
    .split(/\r?\n/)
    .map((line, lineIndex) => parseLegacyVocabularyLine(line, tenantId, scriptIndex, lineIndex))
    .filter((entry): entry is ProductVocabularyEntry => entry !== null);
}

function parseProductVocabularyJsonEntries(
  script: string,
  tenantId: string | null
): ProductVocabularyEntry[] | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(script);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (parsed.script !== "product_vocabulary") {
    return null;
  }

  const entries = parsed.entries;

  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    const phrase = typeof entry.phrase === "string" ? entry.phrase.trim() : "";
    const intent = typeof entry.intent === "string" ? entry.intent : "";

    if (phrase.length === 0 || !isProductContextIntent(intent)) {
      return [];
    }

    return [
      {
        phrase,
        language: isProductContextLanguage(entry.language) ? entry.language : "custom",
        intent,
        entity: intent.includes("FIELD") ? "product_field" : "product",
        cardinality: isProductContextCardinality(entry.cardinality)
          ? entry.cardinality
          : inferCardinality(phrase),
        priority: typeof entry.priority === "number" ? entry.priority : 200 - index,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
        tenantId,
        source: "custom" as const
      }
    ];
  });
}

function parseLegacyVocabularyLine(
  line: string,
  tenantId: string | null,
  scriptIndex: number,
  lineIndex: number
): ProductVocabularyEntry | null {
  const markdownLine = line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^`{1,3}|`{1,3}$/g, "")
    .trim();
  const parts = markdownLine.split("=>").map((part) => part.trim());
  const phrasePart = parts[0] ?? "";
  const commandPart = parts[1] ?? "";

  if (phrasePart.length === 0 || commandPart.length === 0) {
    return null;
  }

  const languageMatch = phrasePart.match(/^([a-z]{2}|sheng):\s*(.+)$/i);
  const phrase = (languageMatch?.[2] ?? phrasePart).trim();
  const command = normalizeContextText(commandPart);
  const intent = commandToProductContextIntent(command);

  if (intent === null) {
    return null;
  }

  return {
    phrase,
    language:
      languageMatch?.[1]?.toLowerCase() === "sw"
        ? "sw"
        : languageMatch?.[1]?.toLowerCase() === "sheng"
          ? "sheng"
          : languageMatch?.[1]?.toLowerCase() === "en"
            ? "en"
            : "custom",
    intent,
    entity: intent.includes("FIELD") ? "product_field" : "product",
    cardinality: inferCardinality(phrase),
    priority: 300 - scriptIndex * 20 - lineIndex,
    enabled: true,
    tenantId,
    source: "custom"
  };
}

function commandToProductContextIntent(command: string): ProductContextScriptIntent | null {
  if (/\b(remove|delete|fute?|ondoa|toa)\b.*\b(field|sehemu|column|attribute)\b/.test(command)) {
    return "PRODUCT_FIELD_REMOVE";
  }

  if (/\b(add|create|new|ongeza)\b.*\b(field|sehemu|column|attribute)\b/.test(command)) {
    return "PRODUCT_FIELD_ADD";
  }

  if (/\b(delete|remove|erase|discard|clear|futa|ondoa|toa)\b/.test(command)) {
    return "PRODUCT_DELETE";
  }

  if (/\b(adjust|quantity|increase|decrease|reduce|punguza|idadi)\b/.test(command)) {
    return "PRODUCT_STOCK_ADJUST";
  }

  if (
    /\b(edit|update|modify|change|correct|rename|hariri|badilisha|rekebisha|sahihisha)\b/.test(
      command
    )
  ) {
    return command.includes("update") ? "PRODUCT_UPDATE" : "PRODUCT_EDIT";
  }

  if (/\b(add|create|new|record|enter|ongeza|ingiza|weka|sajili)\b/.test(command)) {
    return "PRODUCT_ADD";
  }

  if (
    /\b(show|list|find|search|look|product|products|stock|bidhaa|catalogue|catalog|menu)\b/.test(
      command
    )
  ) {
    return "PRODUCT_LIST";
  }

  return null;
}

function findVocabularyPhrasePosition(
  normalizedMessage: string,
  normalizedPhrase: string
): { start: number; end: number } | null {
  if (normalizedMessage === normalizedPhrase) {
    return { start: 0, end: normalizedPhrase.length };
  }

  if (normalizedMessage.startsWith(`${normalizedPhrase} `)) {
    return { start: 0, end: normalizedPhrase.length };
  }

  const phraseWithBoundaries = new RegExp(`(^|\\s)${escapeRegExp(normalizedPhrase)}(\\s|$)`);
  const match = normalizedMessage.match(phraseWithBoundaries);

  if (match === null || match.index === undefined) {
    return null;
  }

  const prefixLength = match[1]?.length ?? 0;
  const start = match.index + prefixLength;

  if (start > 0 && !isAllowedLeadingContext(normalizedMessage.slice(0, start).trim())) {
    return null;
  }

  return {
    start,
    end: start + normalizedPhrase.length
  };
}

function isAllowedLeadingContext(value: string): boolean {
  return value.length === 0 || /^(please|pls|kindly|tafadhali|naomba)$/.test(value);
}

function extractRemainingText(
  normalizedMessage: string,
  position: { start: number; end: number },
  normalizedPhrase: string
): string {
  const after = normalizedMessage.slice(position.end).trim();

  if (after.length > 0) {
    return stripEntityFillers(after);
  }

  const before = normalizedMessage.slice(0, position.start).trim();

  if (before.length === 0 || before === normalizedPhrase) {
    return "";
  }

  return stripEntityFillers(before);
}

function stripEntityFillers(value: string): string {
  return value
    .replace(/^(called|named|for|ya|the|these|this|hizi|hii)\s+/u, "")
    .replace(/\s+(please|pls|tafadhali)$/u, "")
    .trim();
}

function extractProductContextEntities(
  remainingText: string,
  intent: ProductContextScriptIntent,
  entity: ProductVocabularyEntry["entity"]
): ProductContextScriptMatch["entities"] {
  const entities: ProductContextScriptMatch["entities"] = {};
  const quantityMatch = remainingText.match(/\b(\d+(?:\.\d+)?)\b/);

  if (quantityMatch?.[1] !== undefined) {
    entities.quantity = Number(quantityMatch[1]);
  }

  const skuMatch = remainingText.match(/\bsku\s*([a-z0-9-]+)\b/i);

  if (skuMatch?.[1] !== undefined) {
    entities.sku = skuMatch[1];
  }

  const cleaned = remainingText
    .replace(/\bsku\s*[a-z0-9-]+\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (entity === "product_field") {
    if (cleaned.length > 0) {
      entities.fieldName = cleaned;
    }
    return entities;
  }

  if (cleaned.length > 0 && intent !== "PRODUCT_LIST") {
    entities.productName = cleaned;
  }

  return entities;
}

function detectCardinality(
  normalizedMessage: string,
  phrase: string
): ProductContextScriptCardinality | null {
  if (/\b(these|many|all|products|items|goods|stocks|hizi|zote)\b/u.test(normalizedMessage)) {
    return "multiple";
  }

  if (/\b(this|one|single|product|item|hii)\b/u.test(normalizedMessage)) {
    return "single";
  }

  return inferCardinality(phrase);
}

function inferCardinality(
  phrase: string,
  fallback: ProductContextScriptCardinality = "unknown"
): ProductContextScriptCardinality {
  const normalized = normalizeContextText(phrase);

  if (/\b(products|items|stocks|goods|zangu|zilizopo|these|hizi|zote)\b/u.test(normalized)) {
    return "multiple";
  }

  if (/\b(product|item|stock|bidhaa)\b/u.test(normalized)) {
    return "single";
  }

  return fallback;
}

function productContextRequiresConfirmation(intent: ProductContextScriptIntent): boolean {
  return [
    "PRODUCT_ADD",
    "PRODUCT_EDIT",
    "PRODUCT_UPDATE",
    "PRODUCT_DELETE",
    "PRODUCT_STOCK_ADJUST",
    "PRODUCT_FIELD_ADD",
    "PRODUCT_FIELD_REMOVE"
  ].includes(intent);
}

function productContextNeedsClarification(
  intent: ProductContextScriptIntent,
  entities: ProductContextScriptMatch["entities"]
): boolean {
  if (intent === "PRODUCT_DELETE") {
    return entities.productName === undefined;
  }

  if (intent === "PRODUCT_ADD") {
    return entities.productName === undefined;
  }

  if (intent === "PRODUCT_EDIT" || intent === "PRODUCT_UPDATE") {
    return entities.productName === undefined;
  }

  if (intent === "PRODUCT_STOCK_ADJUST") {
    return entities.productName === undefined || entities.quantity === undefined;
  }

  if (intent === "PRODUCT_FIELD_ADD" || intent === "PRODUCT_FIELD_REMOVE") {
    return entities.fieldName === undefined;
  }

  return false;
}

function contextScriptClarification(match: ProductContextScriptMatch): string {
  if (match.intent === "PRODUCT_DELETE") {
    return match.cardinality === "multiple"
      ? "Which products should I delete?"
      : "Which product should I delete?";
  }

  if (match.intent === "PRODUCT_ADD") {
    return "Which product should I draft?";
  }

  if (match.intent === "PRODUCT_STOCK_ADJUST") {
    return "Which product and quantity should I adjust?";
  }

  if (match.intent === "PRODUCT_FIELD_ADD") {
    return "Which product field should I add?";
  }

  if (match.intent === "PRODUCT_FIELD_REMOVE") {
    return "Which product field should I remove?";
  }

  return "Which product should I edit?";
}

function productContextIntentToRuleIntent(intent: ProductContextScriptIntent): RuleIntent {
  switch (intent) {
    case "PRODUCT_LOOKUP":
    case "PRODUCT_LIST":
      return "show_products";
    case "PRODUCT_ADD":
      return "add_product";
    case "PRODUCT_EDIT":
    case "PRODUCT_UPDATE":
    case "PRODUCT_DELETE":
    case "PRODUCT_STOCK_ADJUST":
    case "PRODUCT_FIELD_ADD":
    case "PRODUCT_FIELD_REMOVE":
      return "show_products";
  }
}

function hasDestructiveNegation(normalizedMessage: string): boolean {
  return [
    "do not",
    "dont",
    "don't",
    "never",
    "usifute",
    "sitaki kufuta",
    "not delete",
    "dont remove",
    "don't remove",
    "not remove"
  ].some((phrase) => normalizedMessage.includes(normalizeContextText(phrase)));
}

function normalizeContextText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/gu, "")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceRank(source: ProductContextScriptEntrySource): number {
  return source === "custom" ? 2 : 1;
}

function isProductContextIntent(value: unknown): value is ProductContextScriptIntent {
  return (
    typeof value === "string" &&
    [
      "PRODUCT_LOOKUP",
      "PRODUCT_LIST",
      "PRODUCT_ADD",
      "PRODUCT_EDIT",
      "PRODUCT_UPDATE",
      "PRODUCT_DELETE",
      "PRODUCT_STOCK_ADJUST",
      "PRODUCT_FIELD_ADD",
      "PRODUCT_FIELD_REMOVE"
    ].includes(value)
  );
}

function isProductContextLanguage(value: unknown): value is ProductContextScriptLanguage {
  return typeof value === "string" && ["en", "sw", "sheng", "custom"].includes(value);
}

function isProductContextCardinality(value: unknown): value is ProductContextScriptCardinality {
  return typeof value === "string" && ["single", "multiple", "unknown"].includes(value);
}

function extractReceiptEntities(normalizedMessage: string): ReceiptContextScriptMatch["entities"] {
  const supplierMatch = normalizedMessage.match(/(?:for|from|supplier)\s+([a-z0-9\s.-]{2,48})/u);
  const itemMatch = normalizedMessage.match(
    /sold me\s+([a-z0-9\s.-]{2,48}?)(?:\s+(?:last|this|on)|\?|$)/u
  );
  const dateRange = normalizedMessage.includes("last week")
    ? "last_week"
    : normalizedMessage.includes("today")
      ? "today"
      : normalizedMessage.includes("yesterday")
        ? "yesterday"
        : null;

  return {
    ...(supplierMatch?.[1] === undefined
      ? {}
      : { supplierName: titleCase(supplierMatch[1].trim()) }),
    ...(itemMatch?.[1] === undefined ? {} : { itemName: itemMatch[1].trim() }),
    ...(dateRange === null ? {} : { dateRange })
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeToolName(value: unknown): value is RuntimeToolName {
  return typeof value === "string" && value in runtimeToolRegistry;
}

function parseModelMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function getNextAction(intent: Exclude<RuleIntent, "unknown">): ParserNextAction {
  if (intent === "show_products") {
    return {
      type: "navigate",
      view: "products",
      reason: "Read-only product navigation is safe in CP4."
    };
  }

  if (intent === "show_invoices") {
    return {
      type: "navigate",
      view: "invoices",
      reason: "Read-only invoice navigation is safe."
    };
  }

  if (intent === "check_debt") {
    return {
      type: "navigate",
      view: "payments",
      reason: "Debt checking routes to the payment placeholder until CP8."
    };
  }

  return {
    type: "draft",
    reason: "State-changing commands remain drafts until deterministic validation and confirmation."
  };
}

function getMissingSlotQuestion(intent: RuleIntent, slots: ParserSlots): string | undefined {
  if (intent === "add_product" && slots.productName === undefined) {
    return "Which product should I draft?";
  }

  if (intent === "add_customer" && slots.customerName === undefined) {
    return "What is the customer name?";
  }

  if (intent === "create_invoice" && slots.customerName === undefined) {
    return "Who is this invoice for?";
  }

  if (intent === "record_payment" && slots.amount === undefined) {
    return "How much was paid?";
  }

  return undefined;
}

function extractSlots(input: string, intent: RuleIntent): ParserSlots {
  const slots: ParserSlots = {};
  const quantityMatch = input.match(/\b(\d+(?:\.\d+)?)\b/);
  const amountMatch = input.match(
    /\b(?:kes|ksh|sh|k)\s?(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s?(?:kes|ksh|sh|bob)\b/
  );

  if (quantityMatch?.[1] !== undefined) {
    slots.quantity = Number(quantityMatch[1]);
  }

  const amountValue = amountMatch?.[1] ?? amountMatch?.[2];

  if (amountValue !== undefined) {
    slots.amount = Number(amountValue);
  }

  if (intent === "add_product") {
    const productName = extractNamedValue(input, [
      "product",
      "bidhaa",
      "stock",
      "item",
      "of",
      "ya"
    ]);
    const unit = extractUnit(input);

    if (productName !== undefined) {
      slots.productName = productName;
    }

    if (unit !== undefined) {
      slots.unit = unit;
    }
  }

  if (intent === "add_customer" || intent === "create_invoice" || intent === "check_debt") {
    const customerName = extractNamedValue(input, ["customer", "client", "mteja", "for", "ya"]);

    if (customerName !== undefined) {
      slots.customerName = customerName;
    }
  }

  if (intent === "record_payment") {
    const customerName = extractNamedValue(input, ["from", "customer", "client", "mteja", "kwa"]);

    if (customerName !== undefined) {
      slots.customerName = customerName;
    }

    if (slots.amount === undefined && slots.quantity !== undefined) {
      slots.amount = slots.quantity;
    }
  }

  return stripUndefinedSlots(slots);
}

function extractNamedValue(input: string, markers: string[]): string | undefined {
  const words = input.split(" ");
  const markerIndex = words.findIndex((word) => markers.includes(word));
  const startIndex = markerIndex >= 0 ? markerIndex + 1 : 0;
  const candidates = words
    .slice(startIndex)
    .filter((word) => !commandWords.has(word))
    .filter((word) => !/^\d+(?:\.\d+)?$/.test(word))
    .filter((word) => !["kes", "ksh", "sh", "bob", "paid", "payment", "malipo"].includes(word));

  if (candidates.length === 0) {
    return undefined;
  }

  return titleCase(candidates.slice(0, 4).join(" "));
}

function extractUnit(input: string): string | undefined {
  const unitMatch = input.match(
    /\b(?:kg|kgs|packet|packets|crate|crates|box|boxes|pcs|pieces|bags?)\b/
  );
  return unitMatch?.[0];
}

function scoreRule(input: string, rule: IntentRule): number {
  const phraseScore = rule.phrases.reduce(
    (score, phrase) => (input.includes(phrase) ? score + 0.72 : score),
    0
  );
  const keywordHits = rule.keywords.filter((keyword) => input.includes(keyword)).length;
  const keywordScore = keywordHits * 0.24;

  return (phraseScore + keywordScore) * rule.weight;
}

function normalizeInput(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function stripUndefinedSlots(slots: ParserSlots): ParserSlots {
  return Object.fromEntries(
    Object.entries(slots).filter(([, value]) => value !== undefined)
  ) as ParserSlots;
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatIntent(intent: RuleIntent): string {
  return intent.replaceAll("_", " ");
}
