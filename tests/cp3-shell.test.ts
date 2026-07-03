import { describe, expect, it } from "vitest";
import {
  createInitialChatMessages,
  emptyStates,
  getEmptyState,
  quickActions
} from "../apps/web/src/cp3-shell";

describe("CP3 shell contract", () => {
  it("exposes chat, active CP5 records, and later commerce placeholders through quick actions", () => {
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
    expect(getEmptyState("invoices")?.body).toContain("CP6");
  });

  it("keeps chat writes behind deterministic CP5 business tools", () => {
    expect(createInitialChatMessages("Jane's Shop")[0]).toMatchObject({
      author: "sokoclaw",
      body: expect.stringContaining("deterministic business tools")
    });
  });
});
