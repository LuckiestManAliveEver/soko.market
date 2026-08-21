import { useState } from "react";

import { type ShellView } from "./app-shell";

import { type BusinessReportSummary, type SyncQueueSummary } from "./soko-application-shared";

import { formatMoney } from "./formatters";

export interface ContextualBusinessCardsProps {
  productCount: number;
  customerCount: number;
  invoiceCount: number;
  notificationCount: number;
  report: BusinessReportSummary | null;
  syncSummary: SyncQueueSummary;
  onOpenCatalogue: () => void;
  onOpenNetworkSync: () => void;
  onPreviewStorefront: () => void;
  onNavigate: (view: ShellView) => void;
}

export function ContextualBusinessCards({
  productCount,
  customerCount,
  invoiceCount,
  notificationCount,
  report,
  syncSummary,
  onOpenCatalogue,
  onOpenNetworkSync,
  onPreviewStorefront,
  onNavigate
}: ContextualBusinessCardsProps) {
  const activeQueueCount =
    syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict;

  const workspaceCards: Array<{
    title: string;
    body: string;
    onClick: () => void;
    value: string;
  }> = [
    {
      title: "Catalogue",
      body: "Stock, SKUs, units and adjustments",
      onClick: onOpenCatalogue,
      value: String(productCount)
    },
    {
      title: "Public shop view",
      body: "See the storefront your customers see",
      onClick: onPreviewStorefront,
      value: "View"
    },
    {
      title: "Make a Sale",
      body: "Create, preview and confirm invoices",
      onClick: () => onNavigate("invoices"),
      value: String(invoiceCount)
    },
    {
      title: "Customers",
      body: "Customer contacts and notes",
      onClick: () => onNavigate("customers"),
      value: String(customerCount)
    },
    {
      title: "Payments",
      body: "Record payments and track balances",
      onClick: () => onNavigate("payments"),
      value: formatMoney(report?.payments.totalPaid ?? 0)
    },
    {
      title: "Business Summary",
      body: "Sales and stock health",
      onClick: () => onNavigate("reports"),
      value: formatMoney(report?.sales.grossSales ?? 0)
    },
    {
      title: "Alerts",
      body: "Low stock, debt and sync notices",
      onClick: () => onNavigate("notifications"),
      value: String(notificationCount)
    },
    {
      title: "My Network",
      body: "Contacts, social graphs and invites",
      onClick: onOpenNetworkSync,
      value: String(activeQueueCount)
    },
    {
      title: "Knowledge",
      body: "Supplier files and business records",
      onClick: () => onNavigate("imports"),
      value: "CSV"
    },
    {
      title: "Delivery",
      body: "Pickup and delivery fulfillment",
      onClick: () => onNavigate("logistics"),
      value: "Track"
    },
    {
      title: "Suppliers",
      body: "Manage supplier contacts",
      onClick: () => onNavigate("suppliers"),
      value: "Manage"
    },
    {
      title: "Sync",
      body: "Review offline queue and conflicts",
      onClick: () => onNavigate("sync"),
      value: String(activeQueueCount)
    },
    {
      title: "Runtime",
      body: "Review agent sessions and turns",
      onClick: () => onNavigate("runtime"),
      value: "Sessions"
    },
    {
      title: "Compliance",
      body: "Manage export, verification, tax, and trust controls",
      onClick: () => onNavigate("compliance"),
      value: "Review"
    },
    {
      title: "Beta",
      body: "Review closed beta access, gates, support, and telemetry",
      onClick: () => onNavigate("beta"),
      value: "Review"
    },
    {
      title: "Launch",
      body: "Review public launch gates, checklist, incidents, and rollback",
      onClick: () => onNavigate("launch"),
      value: "Review"
    },
    {
      title: "Agent & Settings",
      body: "Agent and offline settings",
      onClick: () => onNavigate("agent"),
      value: "Settings"
    }
  ];

  const [visibleCards, setVisibleCards] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(workspaceCards.map((c) => [c.title, true]))
  );
  const hiddenCardCount = workspaceCards.filter((card) => !visibleCards[card.title]).length;

  function restoreWorkspaceCards() {
    setVisibleCards(Object.fromEntries(workspaceCards.map((card) => [card.title, true])));
  }

  return (
    <section className="generated-card-message" aria-label="Workspace cards">
      <div className="generated-card-grid">
        {workspaceCards.map((card) =>
          visibleCards[card.title] ? (
            <div className="generated-card" key={card.title}>
              <button
                className="generated-card-button"
                type="button"
                onClick={card.onClick}
                aria-label={card.title}
              >
                <span>{card.title}</span>
                <strong>{card.value}</strong>
                <small>{card.body}</small>
              </button>
              <button
                className="generated-card-close"
                type="button"
                aria-label={`Close ${card.title} card`}
                onClick={(e) => {
                  e.stopPropagation();
                  setVisibleCards((cur) => ({ ...cur, [card.title]: false }));
                }}
              >
                ×
              </button>
            </div>
          ) : null
        )}
        <div className="generated-card">
          <button
            className="generated-card-button"
            type="button"
            onClick={restoreWorkspaceCards}
            aria-label="Restore workspace cards"
          >
            <span>+ Add card</span>
            <strong>{hiddenCardCount}</strong>
            <small>
              {hiddenCardCount === 0
                ? "All available business cards are visible"
                : "Restore hidden business cards"}
            </small>
          </button>
        </div>
      </div>
    </section>
  );
}
