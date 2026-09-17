// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextualBusinessCards } from "../apps/web/src/ContextualBusinessCards";

// Regression coverage for audit A27: the workspace hub needs a real entry point into the new
// combined dashboard (MerchantWorkspaceDashboard) alongside its 18 existing cards - not instead
// of them.
describe("ContextualBusinessCards Business workspace entry (audit A27)", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens the combined dashboard without replacing any existing card", async () => {
    const onOpenBusinessDashboard = vi.fn();

    await act(async () => {
      root = createRoot(host);
      root.render(
        <ContextualBusinessCards
          productCount={5}
          customerCount={3}
          invoiceCount={2}
          notificationCount={0}
          report={null}
          syncSummary={{ pending: 0, processing: 0, failed: 0, conflict: 0, active: 0, total: 0 }}
          onOpenCatalogue={vi.fn()}
          onOpenNetworkSync={vi.fn()}
          onPreviewStorefront={vi.fn()}
          onOpenBusinessDashboard={onOpenBusinessDashboard}
          onNavigate={vi.fn()}
        />
      );
    });

    const dashboardCard = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Business workspace")
    )!;
    expect(dashboardCard).toBeDefined();
    act(() => dashboardCard.click());
    expect(onOpenBusinessDashboard).toHaveBeenCalledTimes(1);

    // Every previously-existing card is still there.
    for (const title of ["Catalogue", "Public shop view", "Invoices", "Business Summary"]) {
      expect(host.textContent).toContain(title);
    }
  });
});
