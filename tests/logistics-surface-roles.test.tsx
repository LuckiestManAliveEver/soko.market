// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchFreshJson = vi.fn();
const getJson = vi.fn();
vi.mock("../apps/web/src/api-helpers", () => ({
  fetchFreshJson: (...args: unknown[]) => fetchFreshJson(...args),
  getJson: (...args: unknown[]) => getJson(...args),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  putJson: vi.fn(),
  deleteJson: vi.fn()
}));

const { LogisticsSurface } = await import("../apps/web/src/LogisticsSurface");
const { fulfillmentCopy } = await import("../apps/web/src/fulfillment-copy");
const { ApiRequestError } = await import("../apps/web/src/lib/api");
const { reportBackgroundLoadError } = await import("../apps/web/src/background-load-error");
const { permissionsForOpenShop } = await import("../apps/web/src/active-shop-permissions");

const en = fulfillmentCopy("en");

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe("Logistics for each role", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    fetchFreshJson.mockReset();
    getJson.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(permissions: string[]) {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <LogisticsSurface
          businessId="shop-a"
          viewerPermissions={permissions}
          invoices={[]}
          logistics={[]}
          form={{ invoiceId: "", method: "delivery", destination: "", note: "" }}
          onFormChange={vi.fn()}
          onCreate={vi.fn()}
          onStatusChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      );
    });
    await flush();
  }

  it("gives a driver only My deliveries: no errors, no forms they cannot use", async () => {
    const forbidden = new ApiRequestError(403, "Permission denied.");
    fetchFreshJson.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-manifests")) return [];
      throw forbidden;
    });
    getJson.mockRejectedValue(forbidden);
    await render(["business:read", "delivery:record"]);
    const text = host.textContent ?? "";
    expect(text).toContain(en.myDeliveries);
    expect(text).toContain(en.noAssignedTrips);
    expect(text).not.toContain("Permission denied");
    expect(text).not.toContain("Create fulfillment");
    expect(host.querySelector('[aria-label="Logistics form"]')).toBeNull();
  });

  it("keeps every card for someone who can run logistics, and while permissions are unknown", async () => {
    const emptyPools = {
      businessId: "shop-a",
      timezone: null,
      generatedAt: new Date(0).toISOString(),
      pools: [],
      unassigned: {
        orderCount: 0,
        unresolvedLocationCount: 0,
        noCorridorCount: 0,
        unresolvedWeightCount: 0,
        pendingIntakeCount: 0,
        orphanedCount: 0
      }
    };
    fetchFreshJson.mockImplementation(async (path: string) =>
      path.endsWith("/settings")
        ? { businessId: "shop-a", timezone: null, viewerCanManage: true }
        : path.endsWith("/default-policy")
          ? { policy: null }
          : []
    );
    getJson.mockImplementation(async (path: string) => (path.endsWith("/pools") ? emptyPools : []));
    await render(["logistics:read", "logistics:write", "fulfillment:dispatch", "delivery:record"]);
    expect(host.querySelector('[aria-label="Logistics form"]')).not.toBeNull();
    expect(host.textContent).not.toContain(en.noAssignedTrips);
    act(() => root.unmount());
    await render([]);
    expect(host.querySelector('[aria-label="Logistics form"]')).not.toBeNull();
  });

  it("keeps a role's 403 out of the status line, but not losing membership or other failures", () => {
    const setStatusMessage = vi.fn();
    reportBackgroundLoadError(
      setStatusMessage,
      new ApiRequestError(403, "Permission denied.", { code: "permission_denied" })
    );
    expect(setStatusMessage).not.toHaveBeenCalled();
    // Removed from the shop: say so, rather than leaving stale data on screen.
    reportBackgroundLoadError(
      setStatusMessage,
      new ApiRequestError(403, "You are not a member of this shop.", {
        code: "membership_required"
      })
    );
    reportBackgroundLoadError(setStatusMessage, new ApiRequestError(500, "Server error."));
    expect(setStatusMessage).toHaveBeenCalledTimes(2);
  });

  it("uses session permissions only when they describe the open shop in seller mode", () => {
    const driverElsewhere = {
      mode: "seller",
      activeShopId: "other-shop",
      permissions: ["business:read", "delivery:record"]
    };
    // The owner switched back to their own shop; the context still describes the other one.
    expect(permissionsForOpenShop(driverElsewhere, "shop-a")).toEqual([]);
    // Still in marketplace mode (a switch not yet synced, or offline).
    expect(
      permissionsForOpenShop(
        { ...driverElsewhere, mode: "marketplace", activeShopId: "shop-a" },
        "shop-a"
      )
    ).toEqual([]);
    expect(permissionsForOpenShop(null, "shop-a")).toEqual([]);
    expect(
      permissionsForOpenShop({ ...driverElsewhere, activeShopId: "shop-a" }, "shop-a")
    ).toEqual(["business:read", "delivery:record"]);
  });

  it("tells a role with no delivery work so, instead of showing a blank page", async () => {
    getJson.mockRejectedValue(
      new ApiRequestError(403, "Permission denied.", { code: "permission_denied" })
    );
    fetchFreshJson.mockRejectedValue(
      new ApiRequestError(403, "Permission denied.", { code: "permission_denied" })
    );
    await render(["business:read", "product:read"]);
    expect(host.textContent).toContain(en.noLogisticsAccess);
  });
});
