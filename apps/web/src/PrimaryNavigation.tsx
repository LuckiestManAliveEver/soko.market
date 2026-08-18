import { type ShellView } from "./app-shell";

export const primaryNavigationItems: Array<{
  view: ShellView;
  label: string;
  shortLabel: string;
}> = [
  { view: "chat", label: "Business overview", shortLabel: "Home" },
  { view: "products", label: "Catalogue", shortLabel: "Stock" },
  { view: "invoices", label: "Sales and invoices", shortLabel: "Sales" },
  { view: "imports", label: "Documents and receipts", shortLabel: "Docs" },
  { view: "reports", label: "Business reports", shortLabel: "Reports" },
  { view: "agent", label: "Agent and offline settings", shortLabel: "Settings" }
];

export function PrimaryNavigation({
  activeView,
  notificationCount,
  onNavigate,
  onPrefetch
}: {
  activeView: ShellView;
  notificationCount: number;
  onNavigate: (view: ShellView) => void;
  onPrefetch: (view: ShellView) => void;
}) {
  return (
    <nav className="primary-navigation" aria-label="Business navigation">
      {primaryNavigationItems.map((item) => (
        <button
          className={activeView === item.view ? "active" : ""}
          type="button"
          key={item.view}
          aria-current={activeView === item.view ? "page" : undefined}
          aria-label={item.label}
          title={item.label}
          onClick={() => onNavigate(item.view)}
          onPointerDown={() => onPrefetch(item.view)}
          onPointerEnter={() => onPrefetch(item.view)}
          onFocus={() => onPrefetch(item.view)}
        >
          <span className="primary-navigation-icon" aria-hidden="true">
            {item.shortLabel.slice(0, 1)}
          </span>
          <span>{item.shortLabel}</span>
          {item.view === "reports" && notificationCount > 0 ? (
            <small aria-label={`${notificationCount} unread alerts`}>{notificationCount}</small>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
