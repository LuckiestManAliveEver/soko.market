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
    summary: "Prepare stock and price work"
  },
  {
    id: "customers",
    label: "Customers",
    summary: "Prepare customer records"
  },
  {
    id: "invoices",
    label: "Invoices",
    summary: "Prepare sales documents"
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
    body: "Product records start in CP5. This shell keeps the workflow visible without creating stock data."
  },
  {
    id: "customers",
    title: "No customers yet",
    body: "Customer records start in CP5. Use this area as the future customer entry point."
  },
  {
    id: "invoices",
    title: "No invoices yet",
    body: "Invoice and inventory flows start in CP6. CP3 only prepares the navigation surface."
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
      body: `${businessName} is ready. CP3 chat can capture drafts, but business actions start after CP4 parser checks.`
    }
  ];
}

export function createCp3PlaceholderReply(input: string): string {
  const normalizedInput = input.trim();

  if (normalizedInput.length === 0) {
    return "Type a draft instruction first.";
  }

  return `Draft saved for CP4 parser work: "${normalizedInput}". No business record was changed.`;
}
