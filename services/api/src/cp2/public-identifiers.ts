import type { BusinessSummary, OAuthProvider } from "@soko/shared-types";

export function createPublicAgentId(business: BusinessSummary): string {
  const seed = `${business.id}-${business.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return seed.length === 0 ? "soko-agent" : seed;
}

export function providerDisplayName(provider: OAuthProvider): string {
  switch (provider) {
    case "facebook":
      return "Facebook";
    case "github":
      return "GitHub";
    case "google":
      return "Google";
    case "linkedin":
      return "LinkedIn";
    case "tiktok":
      return "TikTok";
    case "microsoft":
      return "Microsoft";
    case "apple":
      return "Apple";
    case "x":
      return "X";
  }
}
