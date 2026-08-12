import type { ShellView } from "./app-shell";
import { getCachedJson } from "./api-request-cache";
import { shouldPrefetch } from "./capability-profile";

const prefetched = new Set<string>();

export function prefetchOwnerView(view: ShellView, businessId: string | null): void {
  if (!shouldPrefetch() || businessId === null) return;
  prefetchOwnerViewModule(view);
  for (const path of lightweightDataForView(view, businessId)) {
    if (prefetched.has(path)) continue;
    prefetched.add(path);
    void getCachedJson(path).catch(() => {
      prefetched.delete(path);
    });
  }
}

export function scheduleIdleOwnerPrefetch(
  view: ShellView | ShellView[],
  businessId: string | null
): () => void {
  if (!shouldPrefetch()) return () => undefined;
  const views = Array.isArray(view) ? view : [view];
  const run = () => {
    for (const candidate of views) prefetchOwnerView(candidate, businessId);
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(run, 1_000);
  return () => globalThis.clearTimeout(id);
}

export function likelyNextOwnerViews(view: ShellView): ShellView[] {
  switch (view) {
    case "products":
      return ["invoices", "imports"];
    case "invoices":
      return ["payments", "logistics"];
    case "imports":
      return ["suppliers", "products"];
    case "suppliers":
      return ["products", "imports"];
    case "customers":
      return ["invoices", "payments"];
    case "network":
      return ["suppliers", "customers"];
    case "reports":
    case "notifications":
      return ["products", "invoices"];
    case "chat":
    case "home":
    case "agent":
      return ["products", "invoices"];
    default:
      return [];
  }
}

function prefetchOwnerViewModule(view: ShellView): void {
  if (view === "products") {
    void import("./ProductCapturePanel");
  }
  if (view === "agent") {
    void import("./AccountBackendControls");
  }
}

export function resetPrefetchState(): void {
  prefetched.clear();
}

function lightweightDataForView(view: ShellView, businessId: string): string[] {
  switch (view) {
    case "home":
      return [
        `/businesses/${businessId}/reports/summary`,
        `/businesses/${businessId}/notifications`,
        `/businesses/${businessId}/sync-queue`,
        "/network"
      ];
    case "products":
      return [`/businesses/${businessId}/products`, `/businesses/${businessId}/products/fields`];
    case "suppliers":
      return [`/businesses/${businessId}/suppliers`, `/businesses/${businessId}/purchase-receipts`];
    case "customers":
      return [`/businesses/${businessId}/customers`];
    case "invoices":
      return [
        `/businesses/${businessId}/invoices`,
        `/businesses/${businessId}/products`,
        `/businesses/${businessId}/customers`
      ];
    case "network":
      return ["/network", `/businesses/${businessId}/network/invites`];
    case "sync":
      return [`/businesses/${businessId}/sync-queue`, `/businesses/${businessId}/offline-cache`];
    case "runtime":
      return [`/businesses/${businessId}/runtime/sessions`];
    case "payments":
      return [
        `/businesses/${businessId}/invoices`,
        `/businesses/${businessId}/payments`,
        `/businesses/${businessId}/payment-summaries`,
        `/businesses/${businessId}/customer-debts`
      ];
    case "imports":
      return [
        `/businesses/${businessId}/imports`,
        `/businesses/${businessId}/suppliers`,
        `/businesses/${businessId}/products`
      ];
    case "logistics":
      return [`/businesses/${businessId}/invoices`, `/businesses/${businessId}/logistics`];
    case "compliance":
      return [
        `/businesses/${businessId}/compliance/security-review`,
        `/businesses/${businessId}/compliance/verification`,
        `/businesses/${businessId}/compliance/tax-config`,
        `/businesses/${businessId}/compliance/device-trust`
      ];
    case "beta":
      return [
        `/businesses/${businessId}/beta/readiness`,
        `/businesses/${businessId}/beta/support-tickets`
      ];
    case "launch":
      return [
        `/businesses/${businessId}/launch/readiness`,
        `/businesses/${businessId}/launch/incidents`
      ];
    case "reports":
      return [`/businesses/${businessId}/reports/summary`, `/businesses/${businessId}/knowledge`];
    case "notifications":
      return [
        `/businesses/${businessId}/notifications`,
        `/businesses/${businessId}/storefront/customer-care`,
        `/businesses/${businessId}/storefront/messages`,
        `/businesses/${businessId}/storefront/orders`
      ];
    case "chat":
      return ["/v1/conversations"];
    default:
      return [];
  }
}
