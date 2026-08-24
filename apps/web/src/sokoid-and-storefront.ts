import { routes } from "./routes";

import { type ActiveBusiness } from "./soko-application-shared";

export function isSokoId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    /^soko\.[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/iu.test(trimmed) ||
    /^\+?\d{1,3}-?[A-Za-z]\d{8}$/u.test(trimmed)
  );
}

export function normalizeSokoId(value: string): string {
  const trimmed = value.trim();
  if (/^soko\./iu.test(trimmed)) return trimmed.toLowerCase();
  return trimmed.replace(/^\+/u, "").replace(/-/gu, "").toUpperCase();
}

export function createFallbackSokoId(businessId: string, businessName: string): string {
  const handle = createSokoHandle(businessName);
  if (handle.length > 0) return `soko.${handle}`;

  const seed = businessId;
  let hash = 0;

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return `soko.store-${hash.toString(36)}`;
}

function createSokoHandle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/gu, "");
}

export function createPublicStorefrontAgentId(business: ActiveBusiness): string {
  if (isSokoId(business.sokoId)) {
    return business.sokoId;
  }

  return createFallbackSokoId(business.id, business.name);
}

export function createPublicStorefrontUrl(business: ActiveBusiness): string {
  return createStorefrontUrl(createPublicStorefrontAgentId(business));
}

export function createStorefrontUrl(agentId: string): string {
  const trimmedAgentId = agentId.trim();
  const normalizedAgentId = isSokoId(trimmedAgentId)
    ? normalizeSokoId(trimmedAgentId)
    : trimmedAgentId;
  const localOrigins = ["localhost", "127.0.0.1", "0.0.0.0"];

  if (localOrigins.includes(window.location.hostname)) {
    return `${window.location.origin}${routes.publicAgent(normalizedAgentId)}`;
  }

  return `https://soko.market${routes.publicAgent(normalizedAgentId)}`;
}
