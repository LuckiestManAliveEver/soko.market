import { routes } from "./routes";

import { type ActiveBusiness } from "./soko-application-shared";

export function isSokoId(value: unknown): value is string {
  return (
    typeof value === "string" && /^soko\.[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/iu.test(value.trim())
  );
}

export function normalizeSokoId(value: string): string {
  return value.trim().toLowerCase();
}

export function createPublicStorefrontUrl(business: ActiveBusiness): string {
  return createStorefrontUrl(normalizeSokoId(business.sokoId));
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
