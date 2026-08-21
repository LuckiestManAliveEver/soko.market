import type { BusinessSummary } from "@soko/shared-types";
import { Cp2Error } from "./cp2-error.js";
import { createPublicAgentId } from "./public-identifiers.js";
import { normalizeStorefrontLookupId } from "./text-normalization.js";

export function requirePublicStorefrontBusiness(
  businesses: Map<string, BusinessSummary>,
  quarantinedBusinessIds: Set<string>,
  agentId: string
): BusinessSummary {
  const storefrontId = normalizeStorefrontLookupId(agentId);
  const business = [...businesses.values()].find((candidate) => {
    const sokoId = normalizeStorefrontLookupId(candidate.sokoId);
    const legacyAgentId = normalizeStorefrontLookupId(createPublicAgentId(candidate));
    return sokoId === storefrontId || legacyAgentId === storefrontId;
  });
  if (business === undefined || quarantinedBusinessIds.has(business.id)) {
    throw new Cp2Error(404, "storefront_not_found", "Storefront was not found.");
  }
  return business;
}
