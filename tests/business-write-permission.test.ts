/**
 * `business:write` - agent-driven changes to the business's own operating surface (network
 * identity links, computer sessions) - belongs to the roles with authority over the business.
 * Before it was a declared BusinessPermission no role held it, so the agent refused these tools for
 * everyone.
 */
import { describe, expect, it } from "vitest";
import { roleCan } from "../packages/business-core/src";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";
import { addMember, createOwner, request, signUp } from "./fixtures/fulfillment-test-helpers";

describe("business:write", () => {
  it("is held by owner and manager only", () => {
    expect(roleCan("owner", "business:write")).toBe(true);
    expect(roleCan("manager", "business:write")).toBe(true);
    for (const role of ["sales_agent", "cashier", "view_only", "driver"] as const) {
      expect(roleCan(role, "business:write"), role).toBe(false);
    }
  });

  it("lets the agent run network identity changes for owner and manager, not other staff", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const owner = await createOwner(app);
    const turn = (cookie: string) =>
      request<{
        code?: string;
        turn?: { status: string; verification: { roleAllowed: boolean } };
      }>(app, "POST", `/businesses/${owner.businessId}/runtime/turns`, cookie, {
        message: '#network.identity.reject {"candidateId":"missing-candidate"}'
      });
    const member = async (role: "manager" | "sales_agent" | "cashier") => {
      const person = await signUp(app);
      addMember(store, owner.businessId, person.userId, role);
      return person.cookie;
    };

    // Authorized: the tool executes and reaches the network domain (the candidate is made up).
    for (const cookie of [owner.cookie, await member("manager")]) {
      const response = await turn(cookie);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("identity_candidate_not_found");
    }

    for (const role of ["sales_agent", "cashier"] as const) {
      const response = await turn(await member(role));
      expect(response.status, role).toBe(200);
      expect(response.body.turn?.status, role).toBe("blocked");
      expect(response.body.turn?.verification.roleAllowed, role).toBe(false);
    }
  });
});
