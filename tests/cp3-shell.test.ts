import { describe, expect, it } from "vitest";
import {
  createInitialChatMessages,
  emptyStates,
  getEmptyState,
  quickActions
} from "../apps/web/src/cp3-shell";

describe("CP3 shell contract", () => {
  it("exposes chat, active CP5 records, active CP6 invoices, active CP7 sync, active CP8 payments, CP9 imports, and CP12 reports", () => {
    expect(quickActions.map((action) => action.id)).toEqual([
      "home",
      "chat",
      "products",
      "customers",
      "invoices",
      "sync",
      "payments",
      "imports",
      "reports",
      "notifications"
    ]);

    expect(emptyStates.map((state) => state.id)).toEqual([
      "products",
      "customers",
      "invoices",
      "sync",
      "payments",
      "imports",
      "reports",
      "notifications"
    ]);
    expect(getEmptyState("chat")).toBeUndefined();
    expect(getEmptyState("products")?.body).toContain("CP5 product record");
    expect(getEmptyState("invoices")?.body).toContain("CP6 invoice draft");
    expect(getEmptyState("sync")?.body).toContain("CP7 sync");
    expect(getEmptyState("payments")?.body).toContain("CP8");
    expect(getEmptyState("imports")?.body).toContain("CP9");
    expect(getEmptyState("reports")?.body).toContain("CP12");
    expect(getEmptyState("notifications")?.body).toContain("CP12");
  });

  it("routes chat through the CP10 runtime confirmation boundary", () => {
    expect(createInitialChatMessages("Jane's Shop")[0]).toMatchObject({
      author: "sokoclaw",
      body: expect.stringContaining("CP10 routes chat through verification and confirmation")
    });
  });
});
