export type ShellView =
  | "home"
  | "chat"
  | "products"
  | "customers"
  | "invoices"
  | "sync"
  | "payments"
  | "imports"
  | "reports"
  | "notifications";

export interface QuickAction {
  id: ShellView;
  label: string;
  summary: string;
}

export interface EmptyState {
  id: Exclude<ShellView, "home" | "chat">;
  title: string;
  body: string;
}

export interface ChatMessage {
  id: string;
  author: "merchant" | "sokoclaw";
  body: string;
  confirmationToken?: string;
}

export const quickActions: QuickAction[] = [
  {
    id: "home",
    label: "Home",
    summary: "Return to business overview"
  },
  {
    id: "chat",
    label: "Chat",
    summary: "Plan work through the CP10 runtime"
  },
  {
    id: "products",
    label: "Products",
    summary: "Manage stock records"
  },
  {
    id: "customers",
    label: "Customers",
    summary: "Manage customer records"
  },
  {
    id: "invoices",
    label: "Invoices",
    summary: "Create invoice drafts and confirm sales"
  },
  {
    id: "sync",
    label: "Sync",
    summary: "Review offline queue and conflicts"
  },
  {
    id: "payments",
    label: "Payments",
    summary: "Record payments and review debt"
  },
  {
    id: "imports",
    label: "Imports",
    summary: "Preview supplier CSV files"
  },
  {
    id: "reports",
    label: "Reports",
    summary: "Review sales, stock, debt, imports, and sync health"
  },
  {
    id: "notifications",
    label: "Alerts",
    summary: "Review in-app business notifications"
  }
];

export const emptyStates: EmptyState[] = [
  {
    id: "products",
    title: "No products yet",
    body: "Create the first CP5 product record to start stock tracking."
  },
  {
    id: "customers",
    title: "No customers yet",
    body: "Create the first CP5 customer record to replace paper customer notes."
  },
  {
    id: "invoices",
    title: "No invoices yet",
    body: "Create the first CP6 invoice draft to preview totals and confirm stock movement."
  },
  {
    id: "sync",
    title: "No queued work",
    body: "CP7 sync keeps offline mutations queued until server replay confirms them."
  },
  {
    id: "payments",
    title: "No payments yet",
    body: "CP8 records manual invoice payments and customer debt. Live M-Pesa integration is intentionally deferred."
  },
  {
    id: "imports",
    title: "No imports yet",
    body: "CP9 previews supplier CSV rows before any confirmed business record is written."
  },
  {
    id: "reports",
    title: "No report data yet",
    body: "CP12 reports summarize deterministic business records once products, invoices, payments, imports, or sync work exists."
  },
  {
    id: "notifications",
    title: "No notifications yet",
    body: "CP12 in-app alerts appear when deterministic business rules find low stock, debt, sync conflicts, or failed imports."
  }
];

export function getEmptyState(view: ShellView): EmptyState | undefined {
  return emptyStates.find((state) => state.id === view);
}

export function createInitialChatMessages(businessName: string): ChatMessage[] {
  return [
    {
      id: "welcome",
      author: "sokoclaw",
      body: `${businessName} is ready. CP10 routes chat through verification and confirmation before any runtime action can write records.`
    }
  ];
}
