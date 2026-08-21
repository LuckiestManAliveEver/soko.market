import { Cp2Error } from "./cp2-error.js";

export function normalizeEmailIdentity(value: string): string {
  const normalized = value.trim();
  const at = normalized.lastIndexOf("@");
  if (
    at <= 0 ||
    at === normalized.length - 1 ||
    normalized.length > 254 ||
    /\s/u.test(normalized)
  ) {
    throw new Cp2Error(400, "EMAIL_INVALID_RECIPIENT", "Email address is invalid.");
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1).toLowerCase();
  if (
    local.length > 64 ||
    !/^[^@<>(),;:\\"[\]]+$/u.test(local) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/u.test(domain)
  ) {
    throw new Cp2Error(400, "EMAIL_INVALID_RECIPIENT", "Email address is invalid.");
  }
  return `${local}@${domain}`;
}
