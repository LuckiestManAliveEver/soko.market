import { describe, expect, it } from "vitest";
import {
  createInitialChatMessages,
  emptyStates,
  getEmptyState,
  quickActions
} from "../apps/web/src/cp3-shell";

describe("CP3 shell contract", () => {
  it("exposes chat and core commerce placeholders through quick actions", () => {
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
    expect(getEmptyState("products")?.body).toContain("without creating stock data");
  });

  it("keeps chat behavior as a non-executing CP4 draft placeholder", () => {
    expect(createInitialChatMessages("Jane's Shop")[0]).toMatchObject({
      author: "sokoclaw",
      body: expect.stringContaining("State-changing commands stay as drafts")
    });
  });
});
