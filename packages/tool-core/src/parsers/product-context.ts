import {
  invalid,
  valid,
  type ParseResult,
  type ParserSlots,
  type RuleIntent,
  type RuntimeToolProposal,
  type ValidationResult
} from "../contracts/runtime.js";
import { getNextAction, titleCase } from "./merchant-command.js";

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
    unit?: string;
    sku?: string;
    sellingPrice?: number;
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
        "add",
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
          unit: match.entities.unit ?? "unit",
          quantity: match.entities.quantity ?? 0,
          sellingPrice: match.entities.sellingPrice ?? null,
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
    case "PRODUCT_UPDATE": {
      const hasChange =
        match.entities.quantity !== undefined || match.entities.sellingPrice !== undefined;
      return {
        toolName: "product.update",
        input: {
          productName: match.entities.productName ?? "",
          ...(match.entities.quantity === undefined ? {} : { quantity: match.entities.quantity }),
          ...(match.entities.sellingPrice === undefined
            ? {}
            : { sellingPrice: match.entities.sellingPrice }),
          cardinality: match.cardinality,
          source: match.source
        },
        reason: `Product vocabulary routed edit-product intent from "${match.matchedPhrase}".`,
        validation:
          match.entities.productName === undefined
            ? invalid("Which product should I edit?")
            : hasChange
              ? valid()
              : invalid("Which product details should I change?")
      };
    }

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
            : match.entities.quantity === undefined
              ? invalid("What quantity change should I apply?")
              : valid()
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

  // Several built-in phrases (a bare "edit", "badilisha") match on the verb alone, with no
  // requirement that a product noun also be present - "edit supplier John" would otherwise be
  // misread as PRODUCT_EDIT with "supplier john" as the product name. Suppliers and customers have
  // no vocabulary of their own to route to instead, so a message naming a different domain noun
  // skips product matching entirely and falls through to the primary parser.
  if (
    /\b(supplier|suppliers|msambazaji|wasambazaji|customer|customers|client|clients|mteja|wateja)\b/u.test(
      normalizeContextText(input.message)
    )
  ) {
    return null;
  }

  return matchProductVocabulary(input.message, script);
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

    // The bare "add" entry supports compact inventory commands such as
    // "Add 20 crates of tomatoes at KSh 1,800". Do not let it capture ordinary prose such as
    // "Add a product after asking for missing details", which belongs to model planning.
    if (
      candidate.entry.intent === "PRODUCT_ADD" &&
      candidate.normalizedPhrase === "add" &&
      !/^add\s+\d+(?:\.\d+)?\b/u.test(normalizedMessage)
    ) {
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
  const priceMatch = remainingText.match(
    /\b(?:kes|ksh|sh|k)\s?(\d[\d,]*(?:\.\d+)?)\b|\b(\d[\d,]*(?:\.\d+)?)\s?(?:kes|ksh|sh|bob)\b/i
  );
  const priceValue = priceMatch?.[1] ?? priceMatch?.[2];

  if (priceValue !== undefined) {
    entities.sellingPrice = Number(priceValue.replace(/,/g, ""));
  }

  // A currency-tagged number ("ksh 150") must not also be read as a bare quantity, and its
  // currency word must not leak into the product name - remove the whole matched span first.
  const textWithoutPrice =
    priceMatch === null ? remainingText : remainingText.replace(priceMatch[0], " ");
  const quantityMatch = textWithoutPrice.match(/\b(\d+(?:\.\d+)?)\b/);

  if (quantityMatch?.[1] !== undefined) {
    entities.quantity = Number(quantityMatch[1]);
  }

  const skuMatch = textWithoutPrice.match(/\bsku\s*([a-z0-9-]+)\b/i);

  if (skuMatch?.[1] !== undefined) {
    entities.sku = skuMatch[1];
  }

  const unitMatch = textWithoutPrice.match(
    /\b(?:kg|kgs|packet|packets|crate|crates|box|boxes|pcs|pieces|bags?|units?)\b/i
  );

  if (unitMatch?.[0] !== undefined) {
    entities.unit = unitMatch[0].toLowerCase();
  }

  const cleaned = textWithoutPrice
    .replace(/\bsku\s*[a-z0-9-]+\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, "")
    .replace(/\b(?:kg|kgs|packet|packets|crate|crates|box|boxes|pcs|pieces|bags?|units?)\b/gi, "")
    .replace(/\b(?:kes|ksh|sh|bob)\b/gi, "")
    .replace(/^\s*of\s+/i, "")
    .replace(/\s+(?:at|for)\s*$/i, "")
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

export function normalizeContextText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/gu, "")
    .replace(/(?<=\d),(?=\d)/gu, "")
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
