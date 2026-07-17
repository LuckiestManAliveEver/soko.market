import type { ShellView, SokoMode } from "./app-shell";

function routeId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("A route identifier is required.");
  }
  return encodeURIComponent(normalized);
}

export const routes = {
  home: "/",
  chat: "/chat",
  marketplace: "/marketplace",
  sell: "/sell",
  catalogue: "/catalogue",
  product: (productId: string) => `/products/${routeId(productId)}`,
  shop: (shopId: string) => `/shops/${routeId(shopId)}`,
  publicAgent: (agentId: string) => `/agent/${routeId(agentId)}`,
  agent: (agentId: string) => `/agents/${routeId(agentId)}`,
  customers: "/customers",
  suppliers: "/suppliers",
  invoices: "/invoices",
  network: "/network",
  sync: "/sync",
  runtime: "/runtime",
  payments: "/payments",
  receipts: "/receipts",
  logistics: "/logistics",
  compliance: "/settings/security",
  beta: "/beta",
  launch: "/launch",
  reports: "/reports",
  notifications: "/notifications",
  settings: "/settings",
  accountDeletion: "/account-deletion",
  terms: "/terms",
  privacy: "/privacy",
  oauthCallback: "/auth/oauth/callback"
} as const;

const viewPaths: Partial<Record<ShellView, string>> = {
  home: routes.home,
  chat: routes.chat,
  agent: routes.settings,
  products: routes.catalogue,
  suppliers: routes.suppliers,
  customers: routes.customers,
  invoices: routes.invoices,
  network: routes.network,
  sync: routes.sync,
  runtime: routes.runtime,
  payments: routes.payments,
  imports: routes.receipts,
  logistics: routes.logistics,
  compliance: routes.compliance,
  beta: routes.beta,
  launch: routes.launch,
  reports: routes.reports,
  notifications: routes.notifications
};

export interface OwnerRoute {
  mode: SokoMode;
  view: ShellView;
}

export function pathForOwnerView(view: ShellView, mode: SokoMode): string {
  if (view === "chat") {
    return mode === "seller" ? routes.sell : routes.marketplace;
  }
  return viewPaths[view] ?? routes.chat;
}

export function readOwnerRoute(pathname: string): OwnerRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === routes.home || path === routes.chat || path === routes.marketplace) {
    return { mode: "marketplace", view: "chat" };
  }
  if (path === routes.sell) return { mode: "seller", view: "chat" };

  const view = (Object.entries(viewPaths) as Array<[ShellView, string]>).find(
    ([, route]) => route === path
  )?.[0];
  if (view !== undefined) return { mode: "seller", view };

  if (/^\/products\/[^/]+$/.test(path)) return { mode: "seller", view: "products" };
  if (/^\/agents\/[^/]+$/.test(path)) return { mode: "seller", view: "agent" };
  return null;
}
