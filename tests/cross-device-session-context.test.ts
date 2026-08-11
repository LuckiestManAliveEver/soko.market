import { describe, expect, it } from "vitest";
import {
  shellViewForSurface,
  surfaceForShellView
} from "../apps/web/src/cross-device-session-context";

describe("cross-device session context", () => {
  it("maps recoverable seller surfaces to stable views", () => {
    expect(surfaceForShellView("products", "seller")).toBe("catalogue");
    expect(surfaceForShellView("payments", "seller")).toBe("order");
    expect(surfaceForShellView("imports", "seller")).toBe("receipt");
    expect(surfaceForShellView("reports", "seller")).toBe("owner-controls");
    expect(shellViewForSurface("catalogue", "seller")).toBe("products");
    expect(shellViewForSurface("order", "seller")).toBe("invoices");
    expect(shellViewForSurface("receipt", "seller")).toBe("imports");
  });

  it("keeps marketplace continuity on the conversation surface", () => {
    expect(surfaceForShellView("products", "marketplace")).toBe("conversation");
    expect(shellViewForSurface("owner-controls", "marketplace")).toBe("chat");
  });
});
