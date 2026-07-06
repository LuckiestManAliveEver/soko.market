export type ShellView =
  | "home"
  | "chat"
  | "agent"
  | "products"
  | "customers"
  | "invoices"
  | "sync"
  | "payments"
  | "imports"
  | "logistics"
  | "compliance"
  | "beta"
  | "launch"
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
  attachments?: ChatAttachment[];
  confirmationToken?: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  category: "document" | "image" | "video" | "other";
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
    id: "logistics",
    label: "Logistics",
    summary: "Track pickup and delivery fulfillment"
  },
  {
    id: "compliance",
    label: "Compliance",
    summary: "Manage export, deletion, verification, tax, and trust controls"
  },
  {
    id: "beta",
    label: "Beta",
    summary: "Review closed beta access, gates, support, and telemetry"
  },
  {
    id: "launch",
    label: "Launch",
    summary: "Review public launch gates, checklist, incidents, and rollback"
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
    id: "logistics",
    title: "No logistics yet",
    body: "CP13 tracks pickup and delivery fulfillment for confirmed invoices."
  },
  {
    id: "compliance",
    title: "Compliance not reviewed yet",
    body: "CP14 keeps export, deletion, verification, tax, and device trust workflows explicit and audited."
  },
  {
    id: "beta",
    title: "Beta readiness not reviewed yet",
    body: "CP15 keeps closed beta access, support, sync, payment, and telemetry gates explicit before selected merchant use."
  },
  {
    id: "launch",
    title: "Launch readiness not reviewed yet",
    body: "CP16 keeps public onboarding, production checklist, support, telemetry, and rollback gates explicit before launch."
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
      body: `Karibu back, ${businessName}! I'm your AI attendant and I'm here to help you run your business smoothly. Everything looks good. What would you like to do today?`
    }
  ];
}
