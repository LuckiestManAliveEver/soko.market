/**
 * Secret redaction for anything that might reach a log line, telemetry record, error diagnostic
 * or metric. Two layers: exact known secrets (the credential actually used for the request) are
 * always removed, and well-known key shapes are removed even when the caller did not know them
 * (e.g. a provider echoing a different key back in an error body).
 */
const keyPatterns: readonly RegExp[] = [
  // OpenAI-style (sk-..., sk-proj-...), Anthropic (sk-ant-...)
  /\bsk-[A-Za-z0-9_-]{8,}\b/gu,
  // Hugging Face
  /\bhf_[A-Za-z0-9]{8,}\b/gu,
  // GitHub
  /\bgh[pousr]_[A-Za-z0-9]{8,}\b/gu,
  // Authorization headers / bearer tokens embedded in text
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gu,
  // key=value / "key": "value" forms for common secret field names
  /("?(?:api[_-]?key|x-api-key|authorization|access[_-]?token|secret|password)"?\s*[:=]\s*"?)[^"\s,}]{4,}/giu
];

export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let result = text;
  for (const secret of knownSecrets) {
    if (secret.length >= 4) result = result.split(secret).join("[REDACTED]");
  }
  for (const pattern of keyPatterns) {
    result = result.replace(pattern, (match, prefix: unknown) =>
      typeof prefix === "string" && match.startsWith(prefix) && prefix !== match
        ? `${prefix}[REDACTED]`
        : "[REDACTED]"
    );
  }
  return result;
}

/** Deep-redacts a log/telemetry payload: known secret field names are dropped outright. */
export function redactRecord(
  value: Record<string, unknown>,
  knownSecrets: readonly string[] = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:api[_-]?key|secret|token|authorization|password|encrypted[_-]?secret)$/iu.test(key)) {
      out[key] = "[REDACTED]";
    } else if (typeof entry === "string") {
      out[key] = redactSecrets(entry, knownSecrets);
    } else if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      out[key] = redactRecord(entry as Record<string, unknown>, knownSecrets);
    } else {
      out[key] = entry;
    }
  }
  return out;
}
