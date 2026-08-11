import type { RuntimeParserIntent, RuntimeToolName } from "@soko/shared-types";

export const recallSchemaVersion = "soko-recall-v1" as const;

export type RecallDedupeOutcome = "NEW" | "MERGE" | "SUPERSEDE" | "IGNORE";

export interface RecallEscalationSignal {
  reason: string;
  localRuntime:
    "browser-webgpu" | "browser-wasm" | "native-llama-cpp" | "owner-node" | "server-local";
  localModelId?: string;
}

export interface RecallCandidate {
  title: string;
  taskType: RuntimeParserIntent;
  trigger: string;
  learnedBehavior: string;
  toolsOrCommands: RuntimeToolName[];
  failureAvoided: string;
  scope: "shop";
  confidence: number;
  evidence: "validated_cloud_fallback";
  supersedes: string | null;
}

export interface RecallEntry extends RecallCandidate {
  schemaVersion: typeof recallSchemaVersion;
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecallCandidateParseResult {
  ok: boolean;
  candidate: RecallCandidate | null;
  reason: string | null;
}

export interface RecallPersistenceDecision {
  outcome: RecallDedupeOutcome;
  entry: RecallEntry | null;
  replacedEntryId: string | null;
}

const runtimeTools = new Set<RuntimeToolName>([
  "products.list",
  "invoices.list",
  "product.create",
  "product.update",
  "product.delete",
  "product.stock_adjust",
  "product.field.add",
  "product.field.remove",
  "customer.create",
  "invoice.draft",
  "payment.record",
  "receipt.scan",
  "receipt.review",
  "receipt.confirm",
  "receipt.correct",
  "receipt.cancel",
  "receipt.lookup",
  "receipt.list",
  "document_import.confirm",
  "unknown.clarify"
]);

const identifierPattern =
  /(?:\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\b(?:bearer|password|passwd|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)/i;
const piiPattern =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:^|\D)\+?\d[\d\s().-]{7,}\d(?:\D|$)|\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]*?){13,19}\b)/i;
const privateReasoningPattern =
  /\b(?:chain[ -]of[ -]thought|hidden reasoning|private reasoning|scratchpad|internal monologue)\b/i;
const transientFactPattern =
  /(?:\b(?:customer|supplier|invoice|receipt|order)\s*(?:id|number|#|named)\b|\b(?:stock|quantity|balance|price)\s+(?:is|was|equals?)\s+\d|(?:\bKES\b|\bUSD\b|\bEUR\b|\$|€|£)\s*\d)/i;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export function recallDistillationInstruction(input: {
  intent: RuntimeParserIntent;
  escalation: RecallEscalationSignal;
}): string {
  return [
    "# Optional recall distillation",
    `A local attempt failed (${safeReason(input.escalation.reason)}) before this authorized cloud escalation.`,
    "Return the normal JSON response contract. Only when the successful answer contains a durable, reusable correction for a future local attempt, also include a top-level `recall` object with exactly these fields:",
    `{"title":"generic lesson title","taskType":"${input.intent}","trigger":"generic condition for applying it","learnedBehavior":"short reusable procedure","toolsOrCommands":["supported.tool"],"failureAvoided":"generic failure mode","scope":"shop","confidence":0.0,"evidence":"validated_cloud_fallback","supersedes":null}`,
    "Omit `recall` for one-off answers. Never put raw conversation text, names, contact details, identifiers, prices, stock levels, credentials, secrets, hidden reasoning, or unverified claims in recall. Current shop state, policy, permissions, and verified tools always override recall."
  ].join("\n");
}

export function withRecallDistillationInstruction(
  message: string,
  input: { intent: RuntimeParserIntent; escalation: RecallEscalationSignal }
): string {
  return `${message}\n\n${recallDistillationInstruction(input)}`;
}

export function parseRecallCandidateFromModelOutput(
  outputText: string,
  input: { intent: RuntimeParserIntent; fallbackReason: string }
): RecallCandidateParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return { ok: false, candidate: null, reason: "model_output_invalid" };
  }
  if (!isRecord(parsed) || parsed.recall === undefined) {
    return { ok: true, candidate: null, reason: "candidate_omitted" };
  }
  if (!isRecord(parsed.recall)) {
    return { ok: false, candidate: null, reason: "candidate_invalid" };
  }
  const raw = parsed.recall;
  const title = boundedText(raw.title, 120);
  const trigger = boundedText(raw.trigger, 400);
  const learnedBehavior = boundedText(raw.learnedBehavior, 900);
  const failureAvoided = boundedText(raw.failureAvoided, 240) ?? safeReason(input.fallbackReason);
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : null;
  const toolsOrCommands = Array.isArray(raw.toolsOrCommands)
    ? [...new Set(raw.toolsOrCommands.filter(isRuntimeToolName))].slice(0, 12)
    : [];
  const supersedes = raw.supersedes === null ? null : boundedText(raw.supersedes, 120);
  if (
    title === null ||
    trigger === null ||
    learnedBehavior === null ||
    confidence === null ||
    !Array.isArray(raw.toolsOrCommands) ||
    raw.toolsOrCommands.length > 12 ||
    !raw.toolsOrCommands.every(isRuntimeToolName) ||
    (raw.supersedes !== null && typeof raw.supersedes !== "string") ||
    raw.scope !== "shop" ||
    raw.evidence !== "validated_cloud_fallback" ||
    raw.taskType !== input.intent
  ) {
    return { ok: false, candidate: null, reason: "candidate_invalid" };
  }
  const candidate: RecallCandidate = {
    title,
    taskType: input.intent,
    trigger,
    learnedBehavior,
    toolsOrCommands,
    failureAvoided,
    scope: "shop",
    confidence,
    evidence: "validated_cloud_fallback",
    supersedes
  };
  const safetyRejection = recallSafetyRejection(candidate);
  if (safetyRejection !== null) return { ok: false, candidate: null, reason: safetyRejection };
  return { ok: true, candidate, reason: null };
}

export function recallSafetyRejection(candidate: RecallCandidate): string | null {
  const content = [
    candidate.title,
    candidate.trigger,
    candidate.learnedBehavior,
    candidate.failureAvoided,
    ...candidate.toolsOrCommands
  ].join("\n");
  if (identifierPattern.test(content)) return "secret_detected";
  if (piiPattern.test(content) || uuidPattern.test(content)) return "pii_detected";
  if (privateReasoningPattern.test(content)) return "private_reasoning_detected";
  if (transientFactPattern.test(content)) return "transient_fact_detected";
  if (candidate.confidence < 0.6) return "confidence_too_low";
  return null;
}

export function decideRecallPersistence(input: {
  candidate: RecallCandidate;
  existing: RecallEntry[];
  now: string;
  createId: () => string;
}): RecallPersistenceDecision {
  const explicit =
    input.candidate.supersedes === null
      ? undefined
      : input.existing.find((entry) => entry.id === input.candidate.supersedes);
  if (explicit !== undefined) {
    return {
      outcome: "SUPERSEDE",
      entry: createEntry(input.candidate, input.now, input.createId(), 1, explicit.id),
      replacedEntryId: explicit.id
    };
  }
  const closest = input.existing
    .filter((entry) => entry.taskType === input.candidate.taskType)
    .map((entry) => ({ entry, similarity: recallSimilarity(entry, input.candidate) }))
    .sort((left, right) => right.similarity - left.similarity)[0];
  if (closest === undefined || closest.similarity < 0.48) {
    return {
      outcome: "NEW",
      entry: createEntry(input.candidate, input.now, input.createId(), 1, null),
      replacedEntryId: null
    };
  }
  if (closest.similarity >= 0.9) {
    return { outcome: "IGNORE", entry: null, replacedEntryId: closest.entry.id };
  }
  if (input.candidate.confidence >= closest.entry.confidence + 0.2) {
    return {
      outcome: "SUPERSEDE",
      entry: createEntry(input.candidate, input.now, input.createId(), 1, closest.entry.id),
      replacedEntryId: closest.entry.id
    };
  }
  const merged: RecallEntry = {
    ...closest.entry,
    trigger: mergeText(closest.entry.trigger, input.candidate.trigger, 600),
    learnedBehavior: mergeText(
      closest.entry.learnedBehavior,
      input.candidate.learnedBehavior,
      1_200
    ),
    toolsOrCommands: [
      ...new Set([...closest.entry.toolsOrCommands, ...input.candidate.toolsOrCommands])
    ],
    failureAvoided: mergeText(closest.entry.failureAvoided, input.candidate.failureAvoided, 400),
    confidence: Math.max(closest.entry.confidence, input.candidate.confidence),
    version: closest.entry.version + 1,
    updatedAt: input.now
  };
  return { outcome: "MERGE", entry: merged, replacedEntryId: closest.entry.id };
}

export function serializeRecallEntry(entry: RecallEntry): string {
  const fields: Array<[string, unknown]> = [
    ["schema_version", entry.schemaVersion],
    ["id", entry.id],
    ["task_type", entry.taskType],
    ["scope", entry.scope],
    ["confidence", entry.confidence],
    ["evidence", entry.evidence],
    ["version", entry.version],
    ["created_at", entry.createdAt],
    ["updated_at", entry.updatedAt],
    ["supersedes", entry.supersedes],
    ["tools_or_commands", entry.toolsOrCommands]
  ];
  return [
    "---",
    ...fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
    `# ${entry.title}`,
    "",
    "## Trigger",
    entry.trigger,
    "",
    "## Learned behavior",
    entry.learnedBehavior,
    "",
    "## Failure avoided",
    entry.failureAvoided
  ].join("\n");
}

export function parseRecallEntry(content: string): RecallEntry | null {
  const match =
    /^---\n([\s\S]*?)\n---\n# ([^\n]+)\n\n## Trigger\n([\s\S]*?)\n\n## Learned behavior\n([\s\S]*?)\n\n## Failure avoided\n([\s\S]+)$/u.exec(
      content.trim()
    );
  if (match === null) return null;
  const metadata = new Map<string, unknown>();
  for (const line of match[1]!.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) return null;
    try {
      metadata.set(line.slice(0, separator), JSON.parse(line.slice(separator + 1).trim()));
    } catch {
      return null;
    }
  }
  const taskType = metadata.get("task_type");
  const tools = metadata.get("tools_or_commands");
  const confidence = metadata.get("confidence");
  const version = metadata.get("version");
  const supersedes = metadata.get("supersedes");
  const entry: RecallEntry = {
    schemaVersion: recallSchemaVersion,
    id: typeof metadata.get("id") === "string" ? (metadata.get("id") as string) : "",
    title: match[2]!.trim(),
    taskType: isRuntimeParserIntent(taskType) ? taskType : "unknown",
    trigger: match[3]!.trim(),
    learnedBehavior: match[4]!.trim(),
    toolsOrCommands: Array.isArray(tools) ? tools.filter(isRuntimeToolName) : [],
    failureAvoided: match[5]!.trim(),
    scope: "shop",
    confidence: typeof confidence === "number" ? confidence : 0,
    evidence: "validated_cloud_fallback",
    version: typeof version === "number" ? version : 0,
    createdAt:
      typeof metadata.get("created_at") === "string" ? (metadata.get("created_at") as string) : "",
    updatedAt:
      typeof metadata.get("updated_at") === "string" ? (metadata.get("updated_at") as string) : "",
    supersedes: typeof supersedes === "string" ? supersedes : null
  };
  if (
    metadata.get("schema_version") !== recallSchemaVersion ||
    metadata.get("scope") !== "shop" ||
    metadata.get("evidence") !== "validated_cloud_fallback" ||
    !isRuntimeParserIntent(taskType) ||
    !Array.isArray(tools) ||
    tools.length > 12 ||
    !tools.every(isRuntimeToolName) ||
    (supersedes !== null && typeof supersedes !== "string") ||
    entry.id.length === 0 ||
    entry.title.length === 0 ||
    entry.title.length > 120 ||
    entry.trigger.length === 0 ||
    entry.trigger.length > 600 ||
    entry.learnedBehavior.length === 0 ||
    entry.learnedBehavior.length > 1_200 ||
    entry.failureAvoided.length === 0 ||
    entry.failureAvoided.length > 400 ||
    !Number.isFinite(entry.confidence) ||
    entry.confidence > 1 ||
    !Number.isSafeInteger(entry.version) ||
    entry.version < 1 ||
    !Number.isFinite(Date.parse(entry.createdAt)) ||
    !Number.isFinite(Date.parse(entry.updatedAt)) ||
    recallSafetyRejection(entry) !== null
  ) {
    return null;
  }
  return entry;
}

export function recallSearchText(entry: RecallEntry): string {
  return [
    entry.title,
    entry.taskType.replaceAll("_", " "),
    entry.trigger,
    entry.learnedBehavior,
    entry.failureAvoided,
    ...entry.toolsOrCommands
  ].join(" ");
}

function createEntry(
  candidate: RecallCandidate,
  now: string,
  id: string,
  version: number,
  supersedes: string | null
): RecallEntry {
  return {
    ...candidate,
    schemaVersion: recallSchemaVersion,
    id,
    version,
    createdAt: now,
    updatedAt: now,
    supersedes
  };
}

function recallSimilarity(left: RecallCandidate, right: RecallCandidate): number {
  const leftTerms = terms(`${left.title} ${left.trigger} ${left.learnedBehavior}`);
  const rightTerms = terms(`${right.title} ${right.trigger} ${right.learnedBehavior}`);
  const intersection = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  return union === 0 ? 0 : intersection / union;
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? []);
}

function mergeText(left: string, right: string, maximumLength: number): string {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (normalizedLeft.toLowerCase().includes(normalizedRight.toLowerCase())) return normalizedLeft;
  if (normalizedRight.toLowerCase().includes(normalizedLeft.toLowerCase())) return normalizedRight;
  return `${normalizedLeft}\n- ${normalizedRight}`.slice(0, maximumLength).trim();
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 || normalized.length > maximumLength ? null : normalized;
}

function safeReason(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 80);
  return normalized.length === 0 ? "local_inference_failed" : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeToolName(value: unknown): value is RuntimeToolName {
  return typeof value === "string" && runtimeTools.has(value as RuntimeToolName);
}

function isRuntimeParserIntent(value: unknown): value is RuntimeParserIntent {
  return (
    value === "add_product" ||
    value === "add_customer" ||
    value === "create_invoice" ||
    value === "record_payment" ||
    value === "check_debt" ||
    value === "show_products" ||
    value === "show_invoices" ||
    value === "confirm_document_import" ||
    value === "unknown"
  );
}
