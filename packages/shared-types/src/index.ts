export type RuntimeName = "api" | "sync" | "ai-runtime" | "web";

export interface HealthResponse {
  service: RuntimeName;
  status: "ok";
  timestamp: string;
}

export interface EnvironmentConfig {
  apiHost: string;
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  reason: string;
}

export type AuthChannel = "email" | "phone";

export type BusinessRole = "owner" | "manager" | "sales_agent" | "cashier" | "view_only";

export type SupportedLanguage = "en" | "sw";

export interface AccountSummary {
  id: string;
  primaryAuthChannel: AuthChannel;
  primaryAuthDestination: string;
}

export interface UserSummary {
  id: string;
  accountId: string;
  displayName: string;
  language: SupportedLanguage;
}

export interface BusinessSummary {
  id: string;
  name: string;
  language: SupportedLanguage;
}

export interface MembershipSummary {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessRole;
}

export interface SessionSummary {
  id: string;
  expiresAt: string;
}

export interface AuthSessionView {
  account: AccountSummary;
  user: UserSummary;
  session: SessionSummary;
}

export interface ProductSummary {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSummary {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierSummary {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = "draft" | "confirmed";

export interface InvoiceItemSummary {
  id: string;
  invoiceId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceTotals {
  subtotal: number;
  taxRate: number;
  taxTotal: number;
  total: number;
}

export interface InvoiceSummary extends InvoiceTotals {
  id: string;
  businessId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  customerId: string | null;
  customerName: string | null;
  items: InvoiceItemSummary[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePreview extends InvoiceTotals {
  businessId: string;
  customerId: string | null;
  customerName: string | null;
  items: Omit<InvoiceItemSummary, "id" | "invoiceId">[];
}

export type InventoryMovementType = "manual_adjustment" | "sale";

export interface InventoryMovementSummary {
  id: string;
  businessId: string;
  productId: string;
  type: InventoryMovementType;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  reason: string;
  actorId: string;
  createdAt: string;
}
