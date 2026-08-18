import { routes } from "./routes";

import { type ActiveBusiness } from "./soko-application-shared";

export function isSokoId(value: unknown): value is string {
  return typeof value === "string" && /^\+?\d{1,3}-?[A-Za-z]\d{8}$/.test(value);
}

export function normalizeSokoId(value: string): string {
  return value.trim().replace(/^\+/, "").replace("-", "");
}

export function createFallbackSokoId(businessId: string, businessName: string): string {
  const seed = `${businessId}:${businessName}`;
  let hash = 0;

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return `254A${(hash % 100_000_000).toString().padStart(8, "0")}`;
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
