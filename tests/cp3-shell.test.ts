import { describe, expect, it } from "vitest";
import {
  createInitialChatMessages,
  emptyStates,
  getEmptyState,
  quickActions
} from "../apps/web/src/cp3-shell";

describe("CP3 shell contract", () => {
  it("exposes chat, active CP5 records, active CP6 invoices, and later payment placeholders", () => {
    expect(quickActions.map((action) => action.id)).toEqual([
      "home",
      "chat",
      "products",
      "customers",
      "invoices",
      "payments"
    ]);

    expect(emptyStates.map((state) => state.id)).toEqual([
      "products",
      "customers",
      "invoices",
      "payments"
    ]);
    expect(getEmptyState("chat")).toBeUndefined();
    expect(getEmptyState("products")?.body).toContain("CP5 product record");
    expect(getEmptyState("invoices")?.body).toContain("CP6 invoice draft");
    expect(getEmptyState("payments")?.body).toContain("CP8");
  });

  it("keeps chat writes behind deterministic CP6 invoice confirmation", () => {
    expect(createInitialChatMessages("Jane's Shop")[0]).toMatchObject({
      author: "sokoclaw",
      body: expect.stringContaining("owner confirmation")
    });
  });
});
