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

export type RuntimeToolName =
  | "products.list"
  | "invoices.list"
  | "product.create"
  | "customer.create"
  | "invoice.draft"
  | "payment.record"
  | "unknown.clarify";

export interface RuntimeToolDefinition {
  name: RuntimeToolName;
  risk: RuntimeToolRisk;
  requiresConfirmation: boolean;
  readOnly: boolean;
  requiredPermission: string;
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

export interface RuntimeModelOutputParseResult {
  ok: boolean;
  output: ParsedRuntimeModelOutput | null;
  errors: string[];
}

export const runtimeToolRegistry: Record<RuntimeToolName, RuntimeToolDefinition> = {
  "products.list": {
    name: "products.list",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "product:read"
  },
  "invoices.list": {
    name: "invoices.list",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "invoice:read"
  },
  "product.create": {
    name: "product.create",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write"
  },
  "customer.create": {
    name: "customer.create",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "customer:write"
  },
  "invoice.draft": {
    name: "invoice.draft",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "invoice:write"
  },
  "payment.record": {
    name: "payment.record",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "payment:write"
  },
  "unknown.clarify": {
    name: "unknown.clarify",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "business:read"
  }
};

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
    case "unknown.clarify":
      return valid();

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
