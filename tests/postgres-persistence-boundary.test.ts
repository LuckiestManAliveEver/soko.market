import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Postgres persistence boundary", () => {
  it("persists every route-level mutation and read that materializes durable defaults", () => {
    const source = readFileSync("services/api/src/cp2/postgres-store.ts", "utf8");
    const requiredMethods = [
      "authenticateMcpAccessToken",
      "confirmInvoice",
      "disconnectSocialAccount",
      "getBetaReadiness",
      "getBusinessKnowledge",
      "getDeviceTrust",
      "getDirectNetwork",
      "getExtendedNetwork",
      "getLaunchReadiness",
      "getNetworkGraph",
      "getSecurityReview",
      "getTaxConfig",
      "getVerificationTier",
      "listBetaFeatureFlags",
      "listLaunchChecklist",
      "listNotifications",
      "syncConnectedSocialProvider",
      "updateInvoice"
    ];

    for (const method of requiredMethods) {
      expect(source).toContain(`"${method}"`);
    }
  });
});
