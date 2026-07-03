export type ShellView = "home" | "chat" | "products" | "customers" | "invoices" | "payments";

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
    summary: "Ask for help or draft a task"
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
    id: "payments",
    label: "Payments",
    summary: "Prepare payment tracking"
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
    id: "payments",
    title: "No payments yet",
    body: "Payment and debt tracking start in CP8. M-Pesa integration is intentionally deferred."
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
      body: `${businessName} is ready. CP6 invoice drafts use deterministic previews and owner confirmation before stock moves.`
    }
  ];
}
