import {
  invalid,
  valid,
  type ParseResult,
  type RuntimeToolProposal
} from "../contracts/runtime.js";
import { titleCase } from "./merchant-command.js";
import { normalizeContextText } from "./product-context.js";

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
