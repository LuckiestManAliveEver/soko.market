import { createEvent, type BusinessEvent } from "@soko/event-core";
import type {
  BusinessRole,
  BetaAccessStatus,
  BetaAccessSummary,
  BetaDeviceClass,
  BetaDeviceTestSummary,
  BetaDeviceTestStatus,
  BetaFeatureFlagKey,
  BetaFeatureFlagRisk,
  BetaFeatureFlagSummary,
  BetaSupportSeverity,
  BetaSupportTicketStatus,
  BetaSupportTicketSummary,
  BetaTelemetryEventSummary,
  BetaTelemetryKind,
  CountryTaxConfigSummary,
  CustomerSummary,
  DataExportBundleSummary,
  DeviceTrustLevel,
  DeviceTrustSummary,
  DocumentImportJobSummary,
  DocumentImportPreviewRow,
  AccountDeletionRequestSummary,
  InvoicePaymentStatus,
  InvoicePaymentSummary,
  InventoryMovementSummary,
  InvoicePreview,
  InvoiceSummary,
  FulfillmentMethod,
  FulfillmentStatus,
  LaunchAccessStatus,
  LaunchChecklistItemSummary,
  LaunchChecklistKey,
  LaunchChecklistStatus,
  LaunchIncidentCategory,
  LaunchIncidentSeverity,
  LaunchIncidentStatus,
  LaunchIncidentSummary,
  LaunchSettingsSummary,
  LogisticsSummary,
  PaymentMethod,
  PaymentSummary,
  ProductImportDraft,
  ProductSummary,
  SupplierImportDraft,
  SupplierSummary,
  TaxCountryCode,
  VerificationTier,
  VerificationTierSummary
} from "@soko/shared-types";
import { invalid, type ValidationResult, valid } from "@soko/tool-core";

export interface BusinessActionDraft {
  actionType: string;
  actorId: string;
  aggregateId: string;
  aggregateType: string;
  requiresConfirmation: boolean;
}

export function validateBusinessActionDraft(draft: BusinessActionDraft): ValidationResult {
  const errors: string[] = [];

  if (draft.actionType.trim().length === 0) {
    errors.push("Action type is required.");
  }

  if (draft.actorId.trim().length === 0) {
    errors.push("Actor id is required.");
  }

  if (draft.aggregateId.trim().length === 0) {
    errors.push("Aggregate id is required.");
  }

  if (draft.aggregateType.trim().length === 0) {
    errors.push("Aggregate type is required.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function businessActionProposedEvent(input: {
  id: string;
  draft: BusinessActionDraft;
  occurredAt: string;
}): BusinessEvent<{ draft: BusinessActionDraft }> {
  return createEvent({
    id: input.id,
    type: "business_action.proposed",
    aggregateId: input.draft.aggregateId,
    aggregateType: input.draft.aggregateType,
    actorId: input.draft.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      draft: input.draft
    }
  });
}

export const businessRoles = ["owner", "manager", "sales_agent", "cashier", "view_only"] as const;

export type BusinessPermission =
  | "business:create"
  | "business:read"
  | "membership:read"
  | "membership:manage"
  | "product:read"
  | "product:write"
  | "customer:read"
  | "customer:write"
  | "supplier:read"
  | "supplier:write"
  | "inventory:adjust"
  | "invoice:read"
  | "invoice:write"
  | "invoice:confirm"
  | "payment:read"
  | "payment:write"
  | "logistics:read"
  | "logistics:write"
  | "import:read"
  | "import:write"
  | "report:read"
  | "notification:read"
  | "notification:write"
  | "compliance:read"
  | "compliance:export"
  | "compliance:delete"
  | "verification:read"
  | "verification:write"
  | "tax:read"
  | "tax:write"
  | "device_trust:read"
  | "device_trust:write"
  | "beta:read"
  | "beta:write"
  | "beta:support"
  | "beta:telemetry"
  | "launch:read"
  | "launch:write"
  | "launch:support";

const rolePermissions: Record<BusinessRole, ReadonlySet<BusinessPermission>> = {
  owner: new Set([
    "business:create",
    "business:read",
    "membership:read",
    "membership:manage",
    "product:read",
    "product:write",
    "customer:read",
    "customer:write",
    "supplier:read",
    "supplier:write",
    "inventory:adjust",
    "invoice:read",
    "invoice:write",
    "invoice:confirm",
    "payment:read",
    "payment:write",
    "logistics:read",
    "logistics:write",
    "import:read",
    "import:write",
    "report:read",
    "notification:read",
    "notification:write",
    "compliance:read",
    "compliance:export",
    "compliance:delete",
    "verification:read",
    "verification:write",
    "tax:read",
    "tax:write",
    "device_trust:read",
    "device_trust:write",
    "beta:read",
    "beta:write",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:write",
    "launch:support"
  ]),
  manager: new Set([
    "business:read",
    "membership:read",
    "product:read",
    "product:write",
    "customer:read",
    "customer:write",
    "supplier:read",
    "supplier:write",
    "inventory:adjust",
    "invoice:read",
    "invoice:write",
    "invoice:confirm",
    "payment:read",
    "payment:write",
    "logistics:read",
    "logistics:write",
    "import:read",
    "import:write",
    "report:read",
    "notification:read",
    "notification:write",
    "compliance:read",
    "verification:read",
    "tax:read",
    "tax:write",
    "device_trust:read",
    "beta:read",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:support"
  ]),
  sales_agent: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "customer:write",
    "invoice:read",
    "invoice:write",
    "payment:read",
    "logistics:read",
    "logistics:write",
    "import:read",
    "notification:read",
    "tax:read",
    "beta:read",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:support"
  ]),
  cashier: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "invoice:read",
    "payment:read",
    "payment:write",
    "logistics:read",
    "import:read",
    "notification:read",
    "tax:read",
    "beta:read",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:support"
  ]),
  view_only: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "supplier:read",
    "tax:read",
    "beta:read",
    "launch:read"
  ])
};

export const paymentMethods: PaymentMethod[] = [
  "cash",
  "bank_transfer",
  "mobile_money_manual",
  "card_manual",
  "other_manual"
];

export function isBusinessRole(value: string): value is BusinessRole {
  return businessRoles.includes(value as BusinessRole);
}

export function roleCan(role: BusinessRole, permission: BusinessPermission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}

export function permissionsForRole(role: BusinessRole): BusinessPermission[] {
  return [...(rolePermissions[role] ?? new Set<BusinessPermission>())];
}

export interface ProductInput {
  name: string;
  sku?: string | null;
  unit?: string | null;
  quantity?: number;
  buyingPrice?: number | null;
  sellingPrice?: number | null;
}

export interface ContactRecordInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface StockAdjustmentInput {
  quantityAfter: number;
  reason?: string | null;
}

export interface InvoiceLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceInput {
  customerId?: string | null;
  customerName?: string | null;
  taxRate?: number | null;
  items: InvoiceLineInput[];
}

export interface PaymentInput {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
}

export interface LogisticsInput {
  invoiceId: string;
  method: FulfillmentMethod;
  destination?: string | null;
  note?: string | null;
}

export interface LogisticsStatusInput {
  status: FulfillmentStatus;
  note?: string | null;
}

export interface AccountDeletionInput {
  confirmation: string;
  reason?: string | null;
}

export interface VerificationTierInput {
  tier: VerificationTier;
  evidenceType?: "none" | "owner_attestation" | "business_document" | null;
  note?: string | null;
}

export interface CountryTaxConfigInput {
  countryCode: TaxCountryCode;
  defaultTaxRate: number;
  taxId?: string | null;
  pricesIncludeTax?: boolean;
}

export interface DeviceTrustInput {
  deviceId: string;
  level: DeviceTrustLevel;
  reason?: string | null;
}

export interface BetaAccessInput {
  status: BetaAccessStatus;
  invitedMerchantCount?: number;
  pauseReason?: string | null;
}

export interface BetaFeatureFlagInput {
  enabled: boolean;
  reason?: string | null;
}

export interface BetaDeviceTestInput {
  deviceClass: BetaDeviceClass;
  workflow: string;
  status: BetaDeviceTestStatus;
  durationMs: number;
  notes?: string | null;
}

export interface BetaSupportTicketInput {
  severity: BetaSupportSeverity;
  title: string;
  body?: string | null;
  source?: "merchant" | "operator";
}

export interface BetaSupportTicketStatusInput {
  status: BetaSupportTicketStatus;
}

export interface BetaTelemetryInput {
  kind: BetaTelemetryKind;
  message?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LaunchSettingsInput {
  status: LaunchAccessStatus;
  publicOnboardingEnabled?: boolean;
  rollbackArmed?: boolean;
  freezeActive?: boolean;
  allowedSignupCount?: number;
  pauseReason?: string | null;
}

export interface LaunchChecklistInput {
  key: LaunchChecklistKey;
  status: LaunchChecklistStatus;
  evidence?: string | null;
}

export interface LaunchIncidentInput {
  severity: LaunchIncidentSeverity;
  category: LaunchIncidentCategory;
  title: string;
  body?: string | null;
}

export interface LaunchIncidentStatusInput {
  status: LaunchIncidentStatus;
}

export interface DocumentImportSourceInput {
  fileName: string;
  contentType?: string | null;
  content: string;
  sourceType?: "upload" | "paste" | "database";
  sourceLocator?: string | null;
  originalSizeBytes?: number;
  originalChecksum?: string;
  originalStorageKey?: string | null;
}

export interface NormalizedProductInput {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
}

export interface NormalizedContactRecordInput {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface NormalizedStockAdjustmentInput {
  quantityAfter: number;
  reason: string;
}

export interface NormalizedInvoiceLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface NormalizedInvoiceInput {
  customerId: string | null;
  customerName: string | null;
  taxRate: number;
  items: NormalizedInvoiceLineInput[];
}

export interface NormalizedPaymentInput {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
}

export interface NormalizedLogisticsInput {
  invoiceId: string;
  method: FulfillmentMethod;
  destination: string | null;
  note: string | null;
}

export interface NormalizedLogisticsStatusInput {
  status: FulfillmentStatus;
  note: string | null;
}

export interface NormalizedAccountDeletionInput {
  reason: string | null;
}

export interface NormalizedVerificationTierInput {
  tier: VerificationTier;
  evidenceType: "none" | "owner_attestation" | "business_document";
  note: string | null;
}

export interface NormalizedCountryTaxConfigInput {
  countryCode: TaxCountryCode;
  defaultTaxRate: number;
  taxId: string | null;
  pricesIncludeTax: boolean;
}

export interface NormalizedDeviceTrustInput {
  deviceId: string;
  level: DeviceTrustLevel;
  reason: string | null;
}

export interface NormalizedBetaAccessInput {
  status: BetaAccessStatus;
  invitedMerchantCount: number;
  pauseReason: string | null;
}

export interface NormalizedBetaFeatureFlagInput {
  enabled: boolean;
  reason: string;
}

export interface NormalizedBetaDeviceTestInput {
  deviceClass: BetaDeviceClass;
  workflow: string;
  status: BetaDeviceTestStatus;
  durationMs: number;
  notes: string | null;
}

export interface NormalizedBetaSupportTicketInput {
  severity: BetaSupportSeverity;
  title: string;
  bodySummary: string;
  source: "merchant" | "operator";
}

export interface NormalizedBetaSupportTicketStatusInput {
  status: BetaSupportTicketStatus;
}

export interface NormalizedBetaTelemetryInput {
  kind: BetaTelemetryKind;
  message: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface NormalizedLaunchSettingsInput {
  status: LaunchAccessStatus;
  publicOnboardingEnabled: boolean;
  rollbackArmed: boolean;
  freezeActive: boolean;
  allowedSignupCount: number;
  pauseReason: string | null;
}

export interface NormalizedLaunchChecklistInput {
  key: LaunchChecklistKey;
  status: LaunchChecklistStatus;
  evidence: string;
}

export interface NormalizedLaunchIncidentInput {
  severity: LaunchIncidentSeverity;
  category: LaunchIncidentCategory;
  title: string;
  bodySummary: string;
}

export interface NormalizedLaunchIncidentStatusInput {
  status: LaunchIncidentStatus;
}

export interface SupplierImportPreview {
  fieldMapping: Record<string, keyof SupplierImportDraft>;
  rows: DocumentImportPreviewRow[];
}

export interface ProductImportPreview {
  fieldMapping: Record<string, keyof ProductImportDraft>;
  rows: DocumentImportPreviewRow[];
}

export function validateProductInput(input: ProductInput): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.name).length < 2) {
    errors.push("Product name must be at least 2 characters.");
  }

  if (!isValidQuantity(input.quantity ?? 0)) {
    errors.push("Product quantity must be a finite non-negative number.");
  }

  if (
    input.buyingPrice !== null &&
    input.buyingPrice !== undefined &&
    !isValidMoney(input.buyingPrice)
  ) {
    errors.push("Product buying price must be a finite non-negative amount.");
  }

  if (
    input.sellingPrice !== null &&
    input.sellingPrice !== undefined &&
    !isValidMoney(input.sellingPrice)
  ) {
    errors.push("Product selling price must be a finite non-negative amount.");
  }

  if (normalizeOptionalText(input.unit).length > 32) {
    errors.push("Product unit must be 32 characters or fewer.");
  }

  if (normalizeOptionalText(input.sku).length > 64) {
    errors.push("Product SKU must be 64 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateContactRecordInput(
  input: ContactRecordInput,
  label: string
): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.name).length < 2) {
    errors.push(`${label} name must be at least 2 characters.`);
  }

  if (normalizeOptionalText(input.phone).length > 32) {
    errors.push(`${label} phone must be 32 characters or fewer.`);
  }

  if (normalizeOptionalText(input.email).length > 0 && !isValidEmail(input.email)) {
    errors.push(`${label} email is invalid.`);
  }

  if (normalizeOptionalText(input.notes).length > 240) {
    errors.push(`${label} notes must be 240 characters or fewer.`);
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateStockAdjustmentInput(input: StockAdjustmentInput): ValidationResult {
  const errors: string[] = [];

  if (!isValidQuantity(input.quantityAfter)) {
    errors.push("Adjusted quantity must be a finite non-negative number.");
  }

  if (normalizeOptionalText(input.reason).length > 160) {
    errors.push("Stock adjustment reason must be 160 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateInvoiceInput(input: InvoiceInput): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push("Invoice must include at least one item.");
  } else if (input.items.length > 50) {
    errors.push("Invoice must include 50 items or fewer.");
  }

  if (!isValidTaxRate(input.taxRate ?? 0)) {
    errors.push("Invoice tax rate must be between 0 and 1.");
  }

  if (normalizeOptionalText(input.customerId).length > 80) {
    errors.push("Invoice customer id must be 80 characters or fewer.");
  }

  if (normalizeOptionalText(input.customerName).length > 120) {
    errors.push("Invoice customer name must be 120 characters or fewer.");
  }

  for (const [index, item] of input.items.entries()) {
    if (normalizeRequiredText(item.productId).length === 0) {
      errors.push(`Invoice item ${index + 1} product is required.`);
    }

    if (!isPositiveQuantity(item.quantity)) {
      errors.push(`Invoice item ${index + 1} quantity must be a positive finite number.`);
    }

    if (!isValidMoney(item.unitPrice)) {
      errors.push(`Invoice item ${index + 1} unit price must be a finite non-negative number.`);
    }
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validatePaymentInput(input: PaymentInput): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.invoiceId).length === 0) {
    errors.push("Payment invoice id is required.");
  }

  if (!isPositiveMoney(input.amount)) {
    errors.push("Payment amount must be a positive finite number.");
  }

  if (!isPaymentMethod(input.method)) {
    errors.push("Payment method is not supported.");
  }

  if (normalizeOptionalText(input.reference).length > 80) {
    errors.push("Payment reference must be 80 characters or fewer.");
  }

  if (normalizeOptionalText(input.note).length > 160) {
    errors.push("Payment note must be 160 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLogisticsInput(input: LogisticsInput): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.invoiceId).length === 0) {
    errors.push("Logistics invoice id is required.");
  }

  if (!isFulfillmentMethod(input.method)) {
    errors.push("Fulfillment method is not supported.");
  }

  if (normalizeOptionalText(input.destination).length > 180) {
    errors.push("Logistics destination must be 180 characters or fewer.");
  }

  if (normalizeOptionalText(input.note).length > 180) {
    errors.push("Logistics note must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLogisticsStatusInput(input: LogisticsStatusInput): ValidationResult {
  const errors: string[] = [];

  if (!isFulfillmentStatus(input.status)) {
    errors.push("Fulfillment status is not supported.");
  }

  if (normalizeOptionalText(input.note).length > 180) {
    errors.push("Logistics note must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLogisticsStatusTransition(
  current: FulfillmentStatus,
  next: FulfillmentStatus,
  method: FulfillmentMethod
): ValidationResult {
  if (current === next) {
    return valid();
  }

  if (current === "completed" || current === "cancelled") {
    return invalid("Completed or cancelled fulfillment records cannot change status.");
  }

  const allowed: Record<FulfillmentStatus, FulfillmentStatus[]> = {
    pending: ["ready", "cancelled"],
    ready:
      method === "delivery"
        ? ["out_for_delivery", "completed", "cancelled"]
        : ["completed", "cancelled"],
    out_for_delivery: method === "delivery" ? ["completed", "cancelled"] : [],
    completed: [],
    cancelled: []
  };

  return allowed[current]?.includes(next)
    ? valid()
    : invalid(`Cannot change fulfillment status from ${current} to ${next}.`);
}

export function validateAccountDeletionInput(input: AccountDeletionInput): ValidationResult {
  const errors: string[] = [];

  if (input.confirmation.trim() !== "DELETE") {
    errors.push("Account deletion requires DELETE confirmation.");
  }

  if (normalizeOptionalText(input.reason).length > 240) {
    errors.push("Account deletion reason must be 240 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateVerificationTierInput(input: VerificationTierInput): ValidationResult {
  const errors: string[] = [];

  if (!isVerificationTier(input.tier)) {
    errors.push("Verification tier is not supported.");
  }

  if (
    input.evidenceType !== undefined &&
    input.evidenceType !== null &&
    input.evidenceType !== "none" &&
    input.evidenceType !== "owner_attestation" &&
    input.evidenceType !== "business_document"
  ) {
    errors.push("Verification evidence type is not supported.");
  }

  if (normalizeOptionalText(input.note).length > 240) {
    errors.push("Verification note must be 240 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateCountryTaxConfigInput(input: CountryTaxConfigInput): ValidationResult {
  const errors: string[] = [];

  if (!isTaxCountryCode(input.countryCode)) {
    errors.push("Tax country code is not supported.");
  }

  if (!isValidTaxRate(input.defaultTaxRate)) {
    errors.push("Default tax rate must be between 0 and 1.");
  }

  if (normalizeOptionalText(input.taxId).length > 64) {
    errors.push("Tax id must be 64 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateDeviceTrustInput(input: DeviceTrustInput): ValidationResult {
  const errors: string[] = [];

  if (normalizeRequiredText(input.deviceId).length < 4) {
    errors.push("Device id must be at least 4 characters.");
  }

  if (normalizeRequiredText(input.deviceId).length > 120) {
    errors.push("Device id must be 120 characters or fewer.");
  }

  if (!isDeviceTrustLevel(input.level)) {
    errors.push("Device trust level is not supported.");
  }

  if (normalizeOptionalText(input.reason).length > 180) {
    errors.push("Device trust reason must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateBetaAccessInput(input: BetaAccessInput): ValidationResult {
  const errors: string[] = [];

  if (!isBetaAccessStatus(input.status)) {
    errors.push("Beta access status is not supported.");
  }

  if (
    input.invitedMerchantCount !== undefined &&
    (!Number.isInteger(input.invitedMerchantCount) ||
      input.invitedMerchantCount < 0 ||
      input.invitedMerchantCount > 10)
  ) {
    errors.push("Invited beta merchant count must be an integer between 0 and 10.");
  }

  if (normalizeOptionalText(input.pauseReason).length > 180) {
    errors.push("Beta pause reason must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateBetaFeatureFlagInput(input: BetaFeatureFlagInput): ValidationResult {
  const errors: string[] = [];

  if (typeof input.enabled !== "boolean") {
    errors.push("Beta feature flag enabled state is required.");
  }

  if (normalizeOptionalText(input.reason).length > 180) {
    errors.push("Beta feature flag reason must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateBetaDeviceTestInput(input: BetaDeviceTestInput): ValidationResult {
  const errors: string[] = [];

  if (!isBetaDeviceClass(input.deviceClass)) {
    errors.push("Beta device class is not supported.");
  }

  if (normalizeRequiredText(input.workflow).length < 3) {
    errors.push("Beta device workflow is required.");
  }

  if (normalizeRequiredText(input.workflow).length > 80) {
    errors.push("Beta device workflow must be 80 characters or fewer.");
  }

  if (!isBetaDeviceTestStatus(input.status)) {
    errors.push("Beta device test status is not supported.");
  }

  if (!Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 600_000) {
    errors.push("Beta device test duration must be between 0 and 600000 ms.");
  }

  if (normalizeOptionalText(input.notes).length > 180) {
    errors.push("Beta device test notes must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateBetaSupportTicketInput(input: BetaSupportTicketInput): ValidationResult {
  const errors: string[] = [];

  if (!isBetaSupportSeverity(input.severity)) {
    errors.push("Beta support severity is not supported.");
  }

  if (normalizeRequiredText(input.title).length < 3) {
    errors.push("Beta support title is required.");
  }

  if (normalizeRequiredText(input.title).length > 100) {
    errors.push("Beta support title must be 100 characters or fewer.");
  }

  if (normalizeOptionalText(input.body).length > 500) {
    errors.push("Beta support body must be 500 characters or fewer.");
  }

  if (input.source !== undefined && input.source !== "merchant" && input.source !== "operator") {
    errors.push("Beta support source is not supported.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateBetaSupportTicketStatusInput(
  input: BetaSupportTicketStatusInput
): ValidationResult {
  return isBetaSupportTicketStatus(input.status)
    ? valid()
    : invalid("Beta support ticket status is not supported.");
}

export function validateBetaTelemetryInput(input: BetaTelemetryInput): ValidationResult {
  const errors: string[] = [];

  if (!isBetaTelemetryKind(input.kind)) {
    errors.push("Beta telemetry kind is not supported.");
  }

  if (normalizeOptionalText(input.message).length > 300) {
    errors.push("Beta telemetry message must be 300 characters or fewer.");
  }

  const metadata = input.metadata ?? {};
  const entries = Object.entries(metadata);

  if (entries.length > 12) {
    errors.push("Beta telemetry metadata can include 12 fields or fewer.");
  }

  for (const [key, value] of entries) {
    if (normalizeRequiredText(key).length === 0 || key.length > 40) {
      errors.push("Beta telemetry metadata keys must be 40 characters or fewer.");
    }

    if (value !== null && typeof value === "string" && value.length > 80) {
      errors.push("Beta telemetry string metadata values must be 80 characters or fewer.");
    }
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLaunchSettingsInput(input: LaunchSettingsInput): ValidationResult {
  const errors: string[] = [];

  if (!isLaunchAccessStatus(input.status)) {
    errors.push("Launch access status is not supported.");
  }

  if (
    input.allowedSignupCount !== undefined &&
    (!Number.isInteger(input.allowedSignupCount) ||
      input.allowedSignupCount < 0 ||
      input.allowedSignupCount > 100_000)
  ) {
    errors.push("Launch allowed signup count must be an integer between 0 and 100000.");
  }

  if (normalizeOptionalText(input.pauseReason).length > 180) {
    errors.push("Launch pause reason must be 180 characters or fewer.");
  }

  if (input.status === "open" && input.publicOnboardingEnabled === false) {
    errors.push("Open launch status requires public onboarding to be enabled.");
  }

  if (input.status === "open" && input.freezeActive === true) {
    errors.push("Open launch status cannot be used while launch freeze is active.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLaunchChecklistInput(input: LaunchChecklistInput): ValidationResult {
  const errors: string[] = [];

  if (!isLaunchChecklistKey(input.key)) {
    errors.push("Launch checklist key is not supported.");
  }

  if (!isLaunchChecklistStatus(input.status)) {
    errors.push("Launch checklist status is not supported.");
  }

  if (normalizeOptionalText(input.evidence).length > 180) {
    errors.push("Launch checklist evidence must be 180 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLaunchIncidentInput(input: LaunchIncidentInput): ValidationResult {
  const errors: string[] = [];

  if (!isLaunchIncidentSeverity(input.severity)) {
    errors.push("Launch incident severity is not supported.");
  }

  if (!isLaunchIncidentCategory(input.category)) {
    errors.push("Launch incident category is not supported.");
  }

  if (normalizeRequiredText(input.title).length < 3) {
    errors.push("Launch incident title is required.");
  }

  if (normalizeRequiredText(input.title).length > 100) {
    errors.push("Launch incident title must be 100 characters or fewer.");
  }

  if (normalizeOptionalText(input.body).length > 500) {
    errors.push("Launch incident body must be 500 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function validateLaunchIncidentStatusInput(
  input: LaunchIncidentStatusInput
): ValidationResult {
  return isLaunchIncidentStatus(input.status)
    ? valid()
    : invalid("Launch incident status is not supported.");
}

export function validateDocumentImportSource(input: DocumentImportSourceInput): ValidationResult {
  const errors: string[] = [];
  const fileName = normalizeRequiredText(input.fileName);
  const contentType = normalizeOptionalText(input.contentType);
  const sourceLocator = normalizeOptionalText(input.sourceLocator);
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const supportedExtensions = new Set([
    "csv",
    "tsv",
    "txt",
    "json",
    "sql",
    "pdf",
    "docx",
    "xls",
    "xlsx",
    "ods"
  ]);

  if (fileName.length < 5 || !supportedExtensions.has(extension)) {
    errors.push("Import file must be PDF, DOCX, XLS, XLSX, ODS, CSV, TSV, text, JSON, or SQL.");
  }

  if (
    contentType.length > 0 &&
    ![
      "text/csv",
      "text/tab-separated-values",
      "text/plain",
      "application/csv",
      "application/json",
      "application/sql",
      "application/pdf",
      "application/octet-stream",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.spreadsheet"
    ].includes(contentType)
  ) {
    errors.push("Import content type is not supported.");
  }

  if (input.content.trim().length === 0) {
    errors.push("Import content is required.");
  }

  if (input.content.length > 250_000) {
    errors.push("Import content must be 250KB or smaller.");
  }

  if (
    input.sourceType !== undefined &&
    input.sourceType !== "upload" &&
    input.sourceType !== "paste" &&
    input.sourceType !== "database"
  ) {
    errors.push("Import source type is not supported.");
  }

  if (
    input.originalStorageKey !== undefined &&
    input.originalStorageKey !== null &&
    !/^[A-Za-z0-9][A-Za-z0-9/_.:-]{0,511}$/u.test(input.originalStorageKey)
  ) {
    errors.push("Import object storage key is invalid.");
  }

  if (sourceLocator.length > 500) {
    errors.push("Import source reference must be 500 characters or fewer.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function createSupplierImportPreview(input: {
  content: string;
  fieldMapping?: Record<string, keyof SupplierImportDraft>;
}): SupplierImportPreview {
  const records = parseCsvRecords(input.content);
  const fieldMapping = input.fieldMapping ?? inferSupplierFieldMapping(records.headers);
  const rows = records.rows.map((row, index) => {
    const mapped = mapSupplierRow(row, fieldMapping);
    const validation = validateContactRecordInput(mapped, "Supplier");

    return {
      rowNumber: index + 1,
      raw: row,
      mapped,
      errors: validation.errors,
      warnings: [],
      selected: validation.ok
    };
  });

  return {
    fieldMapping,
    rows
  };
}

export function createProductImportPreview(input: {
  content: string;
  fieldMapping?: Record<string, keyof ProductImportDraft>;
}): ProductImportPreview {
  const records = parseFlexibleImportRecords(input.content);
  const fieldMapping = input.fieldMapping ?? inferProductFieldMapping(records.headers);
  const rows = records.rows.map((row, index) => {
    const mapped = mapProductRow(row, fieldMapping);
    const validation = validateProductInput(mapped);

    return {
      rowNumber: index + 1,
      raw: row,
      mapped,
      errors: validation.errors,
      warnings: [],
      selected: validation.ok
    };
  });

  return {
    fieldMapping,
    rows
  };
}

export function normalizeProductInput(input: ProductInput): NormalizedProductInput {
  return {
    name: normalizeRequiredText(input.name),
    sku: nullableText(input.sku),
    unit: normalizeOptionalText(input.unit) || "unit",
    quantity: input.quantity ?? 0,
    buyingPrice:
      input.buyingPrice === null || input.buyingPrice === undefined
        ? null
        : roundMoney(input.buyingPrice),
    sellingPrice:
      input.sellingPrice === null || input.sellingPrice === undefined
        ? null
        : roundMoney(input.sellingPrice)
  };
}

export function normalizeContactRecordInput(
  input: ContactRecordInput
): NormalizedContactRecordInput {
  return {
    name: normalizeRequiredText(input.name),
    phone: nullableText(input.phone),
    email: nullableText(input.email)?.toLowerCase() ?? null,
    notes: nullableText(input.notes)
  };
}

export function normalizeStockAdjustmentInput(
  input: StockAdjustmentInput
): NormalizedStockAdjustmentInput {
  return {
    quantityAfter: input.quantityAfter,
    reason: normalizeOptionalText(input.reason) || "Manual stock adjustment"
  };
}

export function normalizeInvoiceInput(input: InvoiceInput): NormalizedInvoiceInput {
  return {
    customerId: nullableText(input.customerId),
    customerName: nullableText(input.customerName),
    taxRate: roundMoney(input.taxRate ?? 0),
    items: input.items.map((item) => ({
      productId: normalizeRequiredText(item.productId),
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice)
    }))
  };
}

export function normalizePaymentInput(input: PaymentInput): NormalizedPaymentInput {
  return {
    invoiceId: normalizeRequiredText(input.invoiceId),
    amount: roundMoney(input.amount),
    method: input.method,
    reference: nullableText(input.reference),
    note: nullableText(input.note)
  };
}

export function normalizeLogisticsInput(input: LogisticsInput): NormalizedLogisticsInput {
  return {
    invoiceId: normalizeRequiredText(input.invoiceId),
    method: input.method,
    destination: nullableText(input.destination),
    note: nullableText(input.note)
  };
}

export function normalizeLogisticsStatusInput(
  input: LogisticsStatusInput
): NormalizedLogisticsStatusInput {
  return {
    status: input.status,
    note: nullableText(input.note)
  };
}

export function normalizeAccountDeletionInput(
  input: AccountDeletionInput
): NormalizedAccountDeletionInput {
  return {
    reason: nullableText(input.reason)
  };
}

export function normalizeVerificationTierInput(
  input: VerificationTierInput
): NormalizedVerificationTierInput {
  return {
    tier: input.tier,
    evidenceType:
      input.evidenceType ?? (input.tier === "unverified" ? "none" : "owner_attestation"),
    note: nullableText(input.note)
  };
}

export function normalizeCountryTaxConfigInput(
  input: CountryTaxConfigInput
): NormalizedCountryTaxConfigInput {
  return {
    countryCode: input.countryCode,
    defaultTaxRate: roundMoney(input.defaultTaxRate),
    taxId: nullableText(input.taxId),
    pricesIncludeTax: input.pricesIncludeTax ?? false
  };
}

export function normalizeDeviceTrustInput(input: DeviceTrustInput): NormalizedDeviceTrustInput {
  return {
    deviceId: normalizeRequiredText(input.deviceId),
    level: input.level,
    reason: nullableText(input.reason)
  };
}

export function normalizeBetaAccessInput(input: BetaAccessInput): NormalizedBetaAccessInput {
  return {
    status: input.status,
    invitedMerchantCount: input.invitedMerchantCount ?? (input.status === "not_invited" ? 0 : 1),
    pauseReason: input.status === "paused" ? nullableText(input.pauseReason) : null
  };
}

export function normalizeBetaFeatureFlagInput(
  input: BetaFeatureFlagInput
): NormalizedBetaFeatureFlagInput {
  return {
    enabled: input.enabled,
    reason: normalizeOptionalText(input.reason) || "Updated for closed beta hardening."
  };
}

export function normalizeBetaDeviceTestInput(
  input: BetaDeviceTestInput
): NormalizedBetaDeviceTestInput {
  return {
    deviceClass: input.deviceClass,
    workflow: normalizeRequiredText(input.workflow),
    status: input.status,
    durationMs: Math.round(input.durationMs),
    notes: nullableText(input.notes)
  };
}

export function normalizeBetaSupportTicketInput(
  input: BetaSupportTicketInput
): NormalizedBetaSupportTicketInput {
  const body = normalizeOptionalText(input.body);

  return {
    severity: input.severity,
    title: normalizeRequiredText(input.title),
    bodySummary:
      body.length === 0
        ? "No details provided."
        : body.length <= 120
          ? body
          : `${body.slice(0, 117)}...`,
    source: input.source ?? "merchant"
  };
}

export function normalizeBetaSupportTicketStatusInput(
  input: BetaSupportTicketStatusInput
): NormalizedBetaSupportTicketStatusInput {
  return {
    status: input.status
  };
}

export function normalizeBetaTelemetryInput(
  input: BetaTelemetryInput
): NormalizedBetaTelemetryInput {
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).map(([key, value]) => [
      normalizeRequiredText(key),
      typeof value === "string" ? normalizeOptionalText(value) : value
    ])
  );

  return {
    kind: input.kind,
    message: nullableText(input.message),
    metadata
  };
}

export function normalizeLaunchSettingsInput(
  input: LaunchSettingsInput
): NormalizedLaunchSettingsInput {
  return {
    status: input.status,
    publicOnboardingEnabled: input.publicOnboardingEnabled ?? input.status === "open",
    rollbackArmed: input.rollbackArmed ?? true,
    freezeActive: input.freezeActive ?? input.status !== "open",
    allowedSignupCount: input.allowedSignupCount ?? (input.status === "open" ? 1 : 0),
    pauseReason:
      input.status === "paused" || input.status === "closed"
        ? nullableText(input.pauseReason)
        : null
  };
}

export function normalizeLaunchChecklistInput(
  input: LaunchChecklistInput
): NormalizedLaunchChecklistInput {
  return {
    key: input.key,
    status: input.status,
    evidence: normalizeOptionalText(input.evidence) || "Launch checklist item reviewed."
  };
}

export function normalizeLaunchIncidentInput(
  input: LaunchIncidentInput
): NormalizedLaunchIncidentInput {
  const body = normalizeOptionalText(input.body);

  return {
    severity: input.severity,
    category: input.category,
    title: normalizeRequiredText(input.title),
    bodySummary:
      body.length === 0
        ? "No details provided."
        : body.length <= 120
          ? body
          : `${body.slice(0, 117)}...`
  };
}

export function normalizeLaunchIncidentStatusInput(
  input: LaunchIncidentStatusInput
): NormalizedLaunchIncidentStatusInput {
  return {
    status: input.status
  };
}

export function normalizeSupplierImportDraft(input: SupplierImportDraft): SupplierImportDraft {
  return normalizeContactRecordInput(input);
}

export function isFulfillmentMethod(value: string): value is FulfillmentMethod {
  return value === "delivery" || value === "pickup";
}

export function isFulfillmentStatus(value: string): value is FulfillmentStatus {
  return (
    value === "pending" ||
    value === "ready" ||
    value === "out_for_delivery" ||
    value === "completed" ||
    value === "cancelled"
  );
}

export function isVerificationTier(value: string): value is VerificationTier {
  return value === "unverified" || value === "owner_verified" || value === "business_verified";
}

export function isTaxCountryCode(value: string): value is TaxCountryCode {
  return value === "KE";
}

export function isDeviceTrustLevel(value: string): value is DeviceTrustLevel {
  return value === "unknown" || value === "trusted" || value === "restricted";
}

export function isBetaAccessStatus(value: string): value is BetaAccessStatus {
  return value === "not_invited" || value === "active" || value === "paused";
}

export function isBetaFeatureFlagKey(value: string): value is BetaFeatureFlagKey {
  return (
    value === "closed_beta" ||
    value === "offline_hardening" ||
    value === "controlled_payments" ||
    value === "support_intake" ||
    value === "crash_telemetry"
  );
}

export function betaFeatureFlagRisk(key: BetaFeatureFlagKey): BetaFeatureFlagRisk {
  return key === "controlled_payments" ? "high" : key === "closed_beta" ? "medium" : "low";
}

export function isBetaDeviceClass(value: string): value is BetaDeviceClass {
  return value === "android_1gb" || value === "android_2gb";
}

export function isBetaDeviceTestStatus(value: string): value is BetaDeviceTestStatus {
  return value === "passed" || value === "failed";
}

export function isBetaSupportSeverity(value: string): value is BetaSupportSeverity {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

export function isBetaSupportTicketStatus(value: string): value is BetaSupportTicketStatus {
  return value === "open" || value === "triaged" || value === "resolved";
}

export function isBetaTelemetryKind(value: string): value is BetaTelemetryKind {
  return value === "session" || value === "crash" || value === "error";
}

export function isLaunchAccessStatus(value: string): value is LaunchAccessStatus {
  return value === "closed" || value === "open" || value === "paused";
}

export function isLaunchChecklistKey(value: string): value is LaunchChecklistKey {
  return (
    value === "environment_config" ||
    value === "secrets_ready" ||
    value === "backup_verified" ||
    value === "monitoring_ready" ||
    value === "deploy_verified" ||
    value === "rollback_runbook" ||
    value === "support_coverage"
  );
}

export function isLaunchChecklistStatus(value: string): value is LaunchChecklistStatus {
  return value === "pending" || value === "passed" || value === "failed";
}

export function isLaunchIncidentSeverity(value: string): value is LaunchIncidentSeverity {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

export function isLaunchIncidentCategory(value: string): value is LaunchIncidentCategory {
  return (
    value === "onboarding" ||
    value === "payments" ||
    value === "sync" ||
    value === "support" ||
    value === "telemetry" ||
    value === "rollback"
  );
}

export function isLaunchIncidentStatus(value: string): value is LaunchIncidentStatus {
  return value === "open" || value === "mitigating" || value === "resolved";
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return paymentMethods.includes(value as PaymentMethod);
}

export function dataExportCreatedEvent(input: {
  id: string;
  exportBundle: DataExportBundleSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  exportId: string;
  recordCounts: Record<string, number>;
  checksum: string;
}> {
  return createEvent({
    id: input.id,
    type: "compliance.data_export_created",
    aggregateId: input.exportBundle.id,
    aggregateType: "data_export",
    actorId: input.actorId,
    risk: "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.exportBundle.businessId,
      exportId: input.exportBundle.id,
      recordCounts: input.exportBundle.recordCounts,
      checksum: input.exportBundle.checksum
    }
  });
}

export function accountDeletionScheduledEvent(input: {
  id: string;
  deletionRequest: AccountDeletionRequestSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  deletionRequestId: string;
  status: AccountDeletionRequestSummary["status"];
  anonymizeAfter: string;
  retention: AccountDeletionRequestSummary["retention"];
}> {
  return createEvent({
    id: input.id,
    type: "compliance.account_deletion_scheduled",
    aggregateId: input.deletionRequest.id,
    aggregateType: "account_deletion",
    actorId: input.actorId,
    risk: "critical",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.deletionRequest.businessId,
      deletionRequestId: input.deletionRequest.id,
      status: input.deletionRequest.status,
      anonymizeAfter: input.deletionRequest.anonymizeAfter,
      retention: input.deletionRequest.retention
    }
  });
}

export function verificationTierUpdatedEvent(input: {
  id: string;
  verification: VerificationTierSummary;
  previousTier: VerificationTier;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  previousTier: VerificationTier;
  tier: VerificationTier;
  evidenceType: VerificationTierSummary["evidenceType"];
}> {
  return createEvent({
    id: input.id,
    type: "compliance.verification_tier_updated",
    aggregateId: input.verification.businessId,
    aggregateType: "verification_tier",
    actorId: input.actorId,
    risk: "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.verification.businessId,
      previousTier: input.previousTier,
      tier: input.verification.tier,
      evidenceType: input.verification.evidenceType
    }
  });
}

export function taxConfigUpdatedEvent(input: {
  id: string;
  taxConfig: CountryTaxConfigSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  countryCode: TaxCountryCode;
  defaultTaxRate: number;
  pricesIncludeTax: boolean;
}> {
  return createEvent({
    id: input.id,
    type: "compliance.tax_config_updated",
    aggregateId: input.taxConfig.businessId,
    aggregateType: "tax_config",
    actorId: input.actorId,
    risk: "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.taxConfig.businessId,
      countryCode: input.taxConfig.countryCode,
      defaultTaxRate: input.taxConfig.defaultTaxRate,
      pricesIncludeTax: input.taxConfig.pricesIncludeTax
    }
  });
}

export function deviceTrustUpdatedEvent(input: {
  id: string;
  deviceTrust: DeviceTrustSummary;
  previousLevel: DeviceTrustLevel;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  deviceId: string;
  previousLevel: DeviceTrustLevel;
  level: DeviceTrustLevel;
}> {
  return createEvent({
    id: input.id,
    type: "compliance.device_trust_updated",
    aggregateId: `${input.deviceTrust.businessId}:${input.deviceTrust.deviceId}`,
    aggregateType: "device_trust",
    actorId: input.actorId,
    risk: "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.deviceTrust.businessId,
      deviceId: input.deviceTrust.deviceId,
      previousLevel: input.previousLevel,
      level: input.deviceTrust.level
    }
  });
}

export function betaAccessUpdatedEvent(input: {
  id: string;
  access: BetaAccessSummary;
  previousStatus: BetaAccessStatus;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  previousStatus: BetaAccessStatus;
  status: BetaAccessStatus;
  invitedMerchantCount: number;
}> {
  return createEvent({
    id: input.id,
    type: "beta.access_updated",
    aggregateId: input.access.businessId,
    aggregateType: "beta_access",
    actorId: input.actorId,
    risk: "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.access.businessId,
      previousStatus: input.previousStatus,
      status: input.access.status,
      invitedMerchantCount: input.access.invitedMerchantCount
    }
  });
}

export function betaFeatureFlagUpdatedEvent(input: {
  id: string;
  featureFlag: BetaFeatureFlagSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  key: BetaFeatureFlagKey;
  enabled: boolean;
  risk: BetaFeatureFlagRisk;
}> {
  return createEvent({
    id: input.id,
    type: "beta.feature_flag_updated",
    aggregateId: `${input.featureFlag.businessId}:${input.featureFlag.key}`,
    aggregateType: "beta_feature_flag",
    actorId: input.actorId,
    risk: input.featureFlag.risk,
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.featureFlag.businessId,
      key: input.featureFlag.key,
      enabled: input.featureFlag.enabled,
      risk: input.featureFlag.risk
    }
  });
}

export function betaDeviceTestRecordedEvent(input: {
  id: string;
  deviceTest: BetaDeviceTestSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  deviceTestId: string;
  deviceClass: BetaDeviceClass;
  workflow: string;
  status: BetaDeviceTestStatus;
  durationMs: number;
}> {
  return createEvent({
    id: input.id,
    type: "beta.device_test_recorded",
    aggregateId: input.deviceTest.id,
    aggregateType: "beta_device_test",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.deviceTest.businessId,
      deviceTestId: input.deviceTest.id,
      deviceClass: input.deviceTest.deviceClass,
      workflow: input.deviceTest.workflow,
      status: input.deviceTest.status,
      durationMs: input.deviceTest.durationMs
    }
  });
}

export function betaSupportTicketCreatedEvent(input: {
  id: string;
  ticket: BetaSupportTicketSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  supportTicketId: string;
  severity: BetaSupportSeverity;
  status: BetaSupportTicketStatus;
  titleLength: number;
  bodySummaryLength: number;
}> {
  return createEvent({
    id: input.id,
    type: "beta.support_ticket_created",
    aggregateId: input.ticket.id,
    aggregateType: "beta_support_ticket",
    actorId: input.actorId,
    risk: input.ticket.severity === "critical" ? "high" : "medium",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.ticket.businessId,
      supportTicketId: input.ticket.id,
      severity: input.ticket.severity,
      status: input.ticket.status,
      titleLength: input.ticket.title.length,
      bodySummaryLength: input.ticket.bodySummary.length
    }
  });
}

export function betaSupportTicketStatusUpdatedEvent(input: {
  id: string;
  ticket: BetaSupportTicketSummary;
  previousStatus: BetaSupportTicketStatus;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  supportTicketId: string;
  previousStatus: BetaSupportTicketStatus;
  status: BetaSupportTicketStatus;
  severity: BetaSupportSeverity;
}> {
  return createEvent({
    id: input.id,
    type: "beta.support_ticket_status_updated",
    aggregateId: input.ticket.id,
    aggregateType: "beta_support_ticket",
    actorId: input.actorId,
    risk: input.ticket.severity === "critical" ? "high" : "medium",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.ticket.businessId,
      supportTicketId: input.ticket.id,
      previousStatus: input.previousStatus,
      status: input.ticket.status,
      severity: input.ticket.severity
    }
  });
}

export function betaTelemetryRecordedEvent(input: {
  id: string;
  telemetry: BetaTelemetryEventSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  telemetryId: string;
  kind: BetaTelemetryKind;
  severity: BetaTelemetryEventSummary["severity"];
  fingerprint: string;
  metadataFieldCount: number;
}> {
  return createEvent({
    id: input.id,
    type: "beta.telemetry_recorded",
    aggregateId: input.telemetry.id,
    aggregateType: "beta_telemetry",
    actorId: input.actorId,
    risk: input.telemetry.severity === "critical" ? "medium" : "low",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.telemetry.businessId,
      telemetryId: input.telemetry.id,
      kind: input.telemetry.kind,
      severity: input.telemetry.severity,
      fingerprint: input.telemetry.fingerprint,
      metadataFieldCount: Object.keys(input.telemetry.boundedMetadata).length
    }
  });
}

export function launchSettingsUpdatedEvent(input: {
  id: string;
  settings: LaunchSettingsSummary;
  previousStatus: LaunchAccessStatus;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  previousStatus: LaunchAccessStatus;
  status: LaunchAccessStatus;
  publicOnboardingEnabled: boolean;
  rollbackArmed: boolean;
  freezeActive: boolean;
  allowedSignupCount: number;
}> {
  return createEvent({
    id: input.id,
    type: "launch.settings_updated",
    aggregateId: input.settings.businessId,
    aggregateType: "launch_settings",
    actorId: input.actorId,
    risk: input.settings.status === "open" ? "critical" : "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.settings.businessId,
      previousStatus: input.previousStatus,
      status: input.settings.status,
      publicOnboardingEnabled: input.settings.publicOnboardingEnabled,
      rollbackArmed: input.settings.rollbackArmed,
      freezeActive: input.settings.freezeActive,
      allowedSignupCount: input.settings.allowedSignupCount
    }
  });
}

export function launchChecklistUpdatedEvent(input: {
  id: string;
  item: LaunchChecklistItemSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  key: LaunchChecklistKey;
  status: LaunchChecklistStatus;
  evidenceLength: number;
}> {
  return createEvent({
    id: input.id,
    type: "launch.checklist_updated",
    aggregateId: `${input.item.businessId}:${input.item.key}`,
    aggregateType: "launch_checklist",
    actorId: input.actorId,
    risk: input.item.status === "failed" ? "high" : "medium",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.item.businessId,
      key: input.item.key,
      status: input.item.status,
      evidenceLength: input.item.evidence.length
    }
  });
}

export function launchIncidentCreatedEvent(input: {
  id: string;
  incident: LaunchIncidentSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  incidentId: string;
  severity: LaunchIncidentSeverity;
  status: LaunchIncidentStatus;
  category: LaunchIncidentCategory;
  titleLength: number;
  bodySummaryLength: number;
}> {
  return createEvent({
    id: input.id,
    type: "launch.incident_created",
    aggregateId: input.incident.id,
    aggregateType: "launch_incident",
    actorId: input.actorId,
    risk: input.incident.severity === "critical" ? "critical" : "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.incident.businessId,
      incidentId: input.incident.id,
      severity: input.incident.severity,
      status: input.incident.status,
      category: input.incident.category,
      titleLength: input.incident.title.length,
      bodySummaryLength: input.incident.bodySummary.length
    }
  });
}

export function launchIncidentStatusUpdatedEvent(input: {
  id: string;
  incident: LaunchIncidentSummary;
  previousStatus: LaunchIncidentStatus;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  businessId: string;
  incidentId: string;
  previousStatus: LaunchIncidentStatus;
  status: LaunchIncidentStatus;
  severity: LaunchIncidentSeverity;
}> {
  return createEvent({
    id: input.id,
    type: "launch.incident_status_updated",
    aggregateId: input.incident.id,
    aggregateType: "launch_incident",
    actorId: input.actorId,
    risk: input.incident.severity === "critical" ? "critical" : "high",
    occurredAt: input.occurredAt,
    payload: {
      businessId: input.incident.businessId,
      incidentId: input.incident.id,
      previousStatus: input.previousStatus,
      status: input.incident.status,
      severity: input.incident.severity
    }
  });
}

export function logisticsCreatedEvent(input: {
  id: string;
  logistics: LogisticsSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ logistics: LogisticsSummary }> {
  return createEvent({
    id: input.id,
    type: "logistics.created",
    aggregateId: input.logistics.id,
    aggregateType: "logistics",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      logistics: input.logistics
    }
  });
}

export function logisticsStatusUpdatedEvent(input: {
  id: string;
  logistics: LogisticsSummary;
  previousStatus: FulfillmentStatus;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  logistics: LogisticsSummary;
  previousStatus: FulfillmentStatus;
}> {
  return createEvent({
    id: input.id,
    type: "logistics.status_updated",
    aggregateId: input.logistics.id,
    aggregateType: "logistics",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      logistics: input.logistics,
      previousStatus: input.previousStatus
    }
  });
}

export function createInvoicePreview(input: {
  businessId: string;
  invoice: InvoiceInput;
  products: ProductSummary[];
  customer?: CustomerSummary | null;
}): InvoicePreview {
  const normalized = normalizeInvoiceInput(input.invoice);
  const items = normalized.items.map((item) => {
    const product = input.products.find((candidate) => candidate.id === item.productId);

    return {
      productId: item.productId,
      productName: product?.name ?? "Unknown product",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: roundMoney(item.quantity * item.unitPrice)
    };
  });
  const totals = calculateInvoiceTotals(items, normalized.taxRate);

  return {
    businessId: input.businessId,
    customerId: input.customer?.id ?? normalized.customerId,
    customerName: input.customer?.name ?? normalized.customerName,
    items,
    ...totals
  };
}

export function calculateInvoiceTotals(
  items: Array<{ lineTotal: number }>,
  taxRate: number
): {
  subtotal: number;
  taxRate: number;
  taxTotal: number;
  total: number;
} {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const normalizedTaxRate = roundMoney(taxRate);
  const taxTotal = roundMoney(subtotal * normalizedTaxRate);

  return {
    subtotal,
    taxRate: normalizedTaxRate,
    taxTotal,
    total: roundMoney(subtotal + taxTotal)
  };
}

export function calculateInvoicePaymentStatus(input: {
  invoiceTotal: number;
  paidTotal: number;
}): InvoicePaymentStatus {
  const invoiceTotal = roundMoney(input.invoiceTotal);
  const paidTotal = roundMoney(input.paidTotal);

  if (paidTotal <= 0) {
    return "unpaid";
  }

  return paidTotal >= invoiceTotal ? "paid" : "partially_paid";
}

export function createInvoicePaymentSummary(input: {
  invoice: InvoiceSummary;
  payments: PaymentSummary[];
}): InvoicePaymentSummary {
  const paidTotal = roundMoney(
    input.payments
      .filter((payment) => payment.invoiceId === input.invoice.id)
      .reduce((sum, payment) => sum + payment.amount, 0)
  );
  const balanceDue = roundMoney(Math.max(0, input.invoice.total - paidTotal));

  return {
    invoiceId: input.invoice.id,
    businessId: input.invoice.businessId,
    invoiceNumber: input.invoice.invoiceNumber,
    customerId: input.invoice.customerId,
    customerName: input.invoice.customerName,
    invoiceTotal: input.invoice.total,
    paidTotal,
    balanceDue,
    status: calculateInvoicePaymentStatus({
      invoiceTotal: input.invoice.total,
      paidTotal
    })
  };
}

export function productCreatedEvent(input: {
  id: string;
  product: ProductSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ product: ProductSummary }> {
  return createEvent({
    id: input.id,
    type: "product.created",
    aggregateId: input.product.id,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      product: input.product
    }
  });
}

export function productUpdatedEvent(input: {
  id: string;
  product: ProductSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ product: ProductSummary }> {
  return createEvent({
    id: input.id,
    type: "product.updated",
    aggregateId: input.product.id,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      product: input.product
    }
  });
}

export function productDeletedEvent(input: {
  id: string;
  product: ProductSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ product: ProductSummary }> {
  return createEvent({
    id: input.id,
    type: "product.deleted",
    aggregateId: input.product.id,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      product: input.product
    }
  });
}

export function customerCreatedEvent(input: {
  id: string;
  customer: CustomerSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ customer: CustomerSummary }> {
  return createEvent({
    id: input.id,
    type: "customer.created",
    aggregateId: input.customer.id,
    aggregateType: "customer",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      customer: input.customer
    }
  });
}

export function customerUpdatedEvent(input: {
  id: string;
  customer: CustomerSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ customer: CustomerSummary }> {
  return createEvent({
    id: input.id,
    type: "customer.updated",
    aggregateId: input.customer.id,
    aggregateType: "customer",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      customer: input.customer
    }
  });
}

export function supplierCreatedEvent(input: {
  id: string;
  supplier: SupplierSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ supplier: SupplierSummary }> {
  return createEvent({
    id: input.id,
    type: "supplier.created",
    aggregateId: input.supplier.id,
    aggregateType: "supplier",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      supplier: input.supplier
    }
  });
}

export function supplierUpdatedEvent(input: {
  id: string;
  supplier: SupplierSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ supplier: SupplierSummary }> {
  return createEvent({
    id: input.id,
    type: "supplier.updated",
    aggregateId: input.supplier.id,
    aggregateType: "supplier",
    actorId: input.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      supplier: input.supplier
    }
  });
}

export function stockAdjustedEvent(input: {
  id: string;
  movement: InventoryMovementSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ movement: InventoryMovementSummary }> {
  return createEvent({
    id: input.id,
    type: "inventory.stock_adjusted",
    aggregateId: input.movement.productId,
    aggregateType: "product",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      movement: input.movement
    }
  });
}

export function invoiceCreatedEvent(input: {
  id: string;
  invoice: InvoiceSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ invoice: InvoiceSummary }> {
  return createEvent({
    id: input.id,
    type: "invoice.created",
    aggregateId: input.invoice.id,
    aggregateType: "invoice",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      invoice: input.invoice
    }
  });
}

export function invoiceUpdatedEvent(input: {
  id: string;
  invoice: InvoiceSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ invoice: InvoiceSummary }> {
  return createEvent({
    id: input.id,
    type: "invoice.updated",
    aggregateId: input.invoice.id,
    aggregateType: "invoice",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      invoice: input.invoice
    }
  });
}

export function invoiceConfirmedEvent(input: {
  id: string;
  invoice: InvoiceSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ invoice: InvoiceSummary }> {
  return createEvent({
    id: input.id,
    type: "invoice.confirmed",
    aggregateId: input.invoice.id,
    aggregateType: "invoice",
    actorId: input.actorId,
    risk: "high",
    occurredAt: input.occurredAt,
    payload: {
      invoice: input.invoice
    }
  });
}

export function paymentRecordedEvent(input: {
  id: string;
  payment: PaymentSummary;
  invoicePayment: InvoicePaymentSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{
  payment: PaymentSummary;
  invoicePayment: InvoicePaymentSummary;
}> {
  return createEvent({
    id: input.id,
    type: "payment.recorded",
    aggregateId: input.payment.invoiceId,
    aggregateType: "invoice",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      payment: input.payment,
      invoicePayment: input.invoicePayment
    }
  });
}

export function documentImportPreviewedEvent(input: {
  id: string;
  importJob: DocumentImportJobSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ importJob: DocumentImportJobSummary }> {
  return createEvent({
    id: input.id,
    type: "document_import.previewed",
    aggregateId: input.importJob.id,
    aggregateType: "document_import",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      importJob: input.importJob
    }
  });
}

export function documentImportConfirmedEvent(input: {
  id: string;
  importJob: DocumentImportJobSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ importJob: DocumentImportJobSummary }> {
  return createEvent({
    id: input.id,
    type: "document_import.confirmed",
    aggregateId: input.importJob.id,
    aggregateType: "document_import",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      importJob: input.importJob
    }
  });
}

export function documentImportFailedEvent(input: {
  id: string;
  importJob: DocumentImportJobSummary;
  actorId: string;
  occurredAt: string;
}): BusinessEvent<{ importJob: DocumentImportJobSummary }> {
  return createEvent({
    id: input.id,
    type: "document_import.failed",
    aggregateId: input.importJob.id,
    aggregateType: "document_import",
    actorId: input.actorId,
    risk: "medium",
    occurredAt: input.occurredAt,
    payload: {
      importJob: input.importJob
    }
  });
}

function normalizeRequiredText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeOptionalText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function nullableText(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized.length === 0 ? null : normalized;
}

function isValidQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveQuantity(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidMoney(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveMoney(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidTaxRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidEmail(value: string | null | undefined): boolean {
  const normalized = normalizeOptionalText(value);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseCsvRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const records = parseCsv(content).filter((row) => row.some((cell) => cell.trim().length > 0));

  if (records.length === 0) {
    return {
      headers: [],
      rows: []
    };
  }

  const headerRecord = records[0];

  if (headerRecord === undefined) {
    return {
      headers: [],
      rows: []
    };
  }

  const headers = headerRecord.map(
    (header, index) => normalizeOptionalText(header) || `column_${index + 1}`
  );
  const rows = records
    .slice(1)
    .map((record) =>
      Object.fromEntries(
        headers.map((header, index) => [header, normalizeOptionalText(record[index])])
      )
    );

  return {
    headers,
    rows
  };
}

function parseFlexibleImportRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return {
      headers: [],
      rows: []
    };
  }

  const jsonRecords = parseJsonProductRecords(trimmed);

  if (jsonRecords !== null) {
    return jsonRecords;
  }

  const sqlRecords = parseSqlInsertRecords(trimmed);

  if (sqlRecords !== null && sqlRecords.rows.length > 0) {
    return sqlRecords;
  }

  if (trimmed.includes("\t")) {
    return parseDelimitedRecords(trimmed, "\t");
  }

  const csvRecords = parseCsvRecords(trimmed);

  if (csvRecords.headers.length > 1 || csvRecords.rows.length > 0) {
    return csvRecords;
  }

  return parseLooseProductLines(trimmed);
}

function parseDelimitedRecords(
  content: string,
  delimiter: string
): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const records = content
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => normalizeOptionalText(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));
  const headerRecord = records[0] ?? [];
  const headers = headerRecord.map((header, index) => header || `column_${index + 1}`);
  const rows = records
    .slice(1)
    .map((record) =>
      Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]))
    );

  return {
    headers,
    rows
  };
}

function parseJsonProductRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : isObjectRecord(parsed) && Array.isArray(parsed.products)
        ? parsed.products
        : null;

    if (records === null) {
      return null;
    }

    const rows = records
      .filter(isObjectRecord)
      .map((record) =>
        Object.fromEntries(
          Object.entries(record).map(([key, value]) => [key, value === null ? "" : String(value)])
        )
      );
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    return {
      headers,
      rows
    };
  } catch {
    return null;
  }
}

function parseSqlInsertRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} | null {
  const match = content.match(/insert\s+into\s+\S+\s*\(([^)]+)\)\s*values\s*([\s\S]+?);?$/i);

  if (match === null) {
    return null;
  }

  const headerSection = match[1];
  const valueSection = match[2];

  if (headerSection === undefined || valueSection === undefined) {
    return null;
  }

  const headers = headerSection.split(",").map((header) => normalizeSqlToken(header));
  const rowMatches = [...valueSection.matchAll(/\(([^()]*)\)/g)];
  const rows = rowMatches.map((rowMatch) => {
    const cells = parseCsv(rowMatch[1] ?? "").at(0) ?? [];
    return Object.fromEntries(
      headers.map((header, index) => [header, normalizeSqlToken(cells[index] ?? "")])
    );
  });

  return {
    headers,
    rows
  };
}

function parseLooseProductLines(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const headers = ["name", "quantity", "unit", "sellingPrice"];
  const rows = content
    .split(/\r?\n/)
    .map((line) => normalizeOptionalText(line))
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line
        .split(/\s{2,}|\s+\|\s+|\s+-\s+|\s+,\s+/)
        .map((part) => normalizeOptionalText(part))
        .filter((part) => part.length > 0);
      const priceMatch = line.match(/(?:ksh|kes|usd|\$)?\s*(\d+(?:\.\d{1,2})?)\s*$/i);

      return {
        name: parts[0] ?? line,
        quantity: parts[1] ?? "0",
        unit: parts[2] ?? "unit",
        sellingPrice: parts[3] ?? priceMatch?.[1] ?? ""
      };
    });

  return {
    headers,
    rows
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSqlToken(value: string): string {
  const trimmed = normalizeOptionalText(value).replace(/;$/, "");

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function inferSupplierFieldMapping(headers: string[]): Record<string, keyof SupplierImportDraft> {
  const mapping: Record<string, keyof SupplierImportDraft> = {};

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (normalized === "name" || normalized === "supplier" || normalized === "suppliername") {
      mapping[header] = "name";
    } else if (normalized === "phone" || normalized === "mobile" || normalized === "tel") {
      mapping[header] = "phone";
    } else if (normalized === "email" || normalized === "emailaddress") {
      mapping[header] = "email";
    } else if (normalized === "note" || normalized === "notes") {
      mapping[header] = "notes";
    }
  }

  return mapping;
}

function mapSupplierRow(
  row: Record<string, string>,
  fieldMapping: Record<string, keyof SupplierImportDraft>
): SupplierImportDraft {
  const mapped: SupplierImportDraft = {
    name: "",
    phone: null,
    email: null,
    notes: null
  };

  for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
    const value = row[sourceField] ?? "";

    if (targetField === "name") {
      mapped.name = value;
    } else if (targetField === "phone") {
      mapped.phone = nullableText(value);
    } else if (targetField === "email") {
      mapped.email = nullableText(value);
    } else {
      mapped.notes = nullableText(value);
    }
  }

  return normalizeSupplierImportDraft(mapped);
}

function inferProductFieldMapping(headers: string[]): Record<string, keyof ProductImportDraft> {
  const mapping: Record<string, keyof ProductImportDraft> = {};

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (
      normalized === "name" ||
      normalized === "product" ||
      normalized === "productname" ||
      normalized === "item" ||
      normalized === "itemname"
    ) {
      mapping[header] = "name";
    } else if (normalized === "sku" || normalized === "code" || normalized === "barcode") {
      mapping[header] = "sku";
    } else if (
      normalized === "unit" ||
      normalized === "measure" ||
      normalized === "uom" ||
      normalized === "pack"
    ) {
      mapping[header] = "unit";
    } else if (
      normalized === "quantity" ||
      normalized === "qty" ||
      normalized === "stock" ||
      normalized === "onhand"
    ) {
      mapping[header] = "quantity";
    } else if (
      normalized === "buyingprice" ||
      normalized === "buyprice" ||
      normalized === "cost" ||
      normalized === "costprice" ||
      normalized === "purchaseprice"
    ) {
      mapping[header] = "buyingPrice";
    } else if (
      normalized === "sellingprice" ||
      normalized === "sellprice" ||
      normalized === "price" ||
      normalized === "retailprice" ||
      normalized === "saleprice"
    ) {
      mapping[header] = "sellingPrice";
    }
  }

  return mapping;
}

function mapProductRow(
  row: Record<string, string>,
  fieldMapping: Record<string, keyof ProductImportDraft>
): ProductImportDraft {
  const mapped: ProductImportDraft = {
    name: "",
    sku: null,
    unit: "unit",
    quantity: 0,
    buyingPrice: null,
    sellingPrice: null
  };

  for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
    const value = row[sourceField] ?? "";

    if (targetField === "name") {
      mapped.name = value;
    } else if (targetField === "sku") {
      mapped.sku = nullableText(value);
    } else if (targetField === "unit") {
      mapped.unit = normalizeOptionalText(value) || "unit";
    } else if (targetField === "quantity") {
      mapped.quantity = parseImportNumber(value) ?? 0;
    } else if (targetField === "buyingPrice") {
      mapped.buyingPrice = parseImportNumber(value);
    } else {
      mapped.sellingPrice = parseImportNumber(value);
    }
  }

  return normalizeProductInput(mapped);
}

function parseImportNumber(value: string): number | null {
  const normalized = normalizeOptionalText(value).replace(/[^0-9.-]/g, "");

  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
