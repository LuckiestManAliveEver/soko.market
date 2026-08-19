export function normalizeRequiredText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeOptionalText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function nullableText(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized.length === 0 ? null : normalized;
}

export function isValidEmail(value: string | null | undefined): boolean {
  const normalized = normalizeOptionalText(value);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized);
}
