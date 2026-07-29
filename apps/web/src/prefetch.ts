import type { ShellView } from "./app-shell";
import { getCachedJson } from "./api-request-cache";
import { shouldPrefetch } from "./capability-profile";

const prefetched = new Set<string>();

export function prefetchOwnerView(view: ShellView, businessId: string | null): void {
  if (!shouldPrefetch() || businessId === null) return;
  for (const path of lightweightDataForView(view, businessId)) {
    if (prefetched.has(path)) continue;
    prefetched.add(path);
    void getCachedJson(path).catch(() => {
      prefetched.delete(path);
    });
  }
}

export function scheduleIdleOwnerPrefetch(view: ShellView, businessId: string | null): () => void {
  if (!shouldPrefetch()) return () => undefined;
  const run = () => prefetchOwnerView(view, businessId);
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(run, 1_000);
  return () => globalThis.clearTimeout(id);
}

export function resetPrefetchState(): void {
  prefetched.clear();
}

function lightweightDataForView(view: ShellView, businessId: string): string[] {
  switch (view) {
    case "products":
      return [`/businesses/${businessId}/products`, `/businesses/${businessId}/products/fields`];
    case "invoices":
      return [
        `/businesses/${businessId}/invoices`,
        `/businesses/${businessId}/products`,
        `/businesses/${businessId}/customers`
      ];
    case "reports":
      return [`/businesses/${businessId}/reports/summary`, `/businesses/${businessId}/knowledge`];
    case "imports":
      return [];
    case "chat":
      return ["/v1/conversations"];
    default:
      return [];
  }
}
