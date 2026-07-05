import { createEvent, type BusinessEvent } from "@soko/event-core";
import type {
  BusinessRole,
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
  LogisticsSummary,
  PaymentMethod,
  PaymentSummary,
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
  | "device_trust:write";

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
    "device_trust:write"
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
    "device_trust:read"
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
    "tax:read"
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
    "tax:read"
  ]),
  view_only: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "supplier:read",
    "tax:read"
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

export interface ProductInput {
  name: string;
  sku?: string | null;
  unit?: string | null;
  quantity?: number;
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

export interface DocumentImportSourceInput {
  fileName: string;
  contentType?: string | null;
  content: string;
}

export interface NormalizedProductInput {
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
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

export interface SupplierImportPreview {
  fieldMapping: Record<string, keyof SupplierImportDraft>;
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

export function validateDocumentImportSource(input: DocumentImportSourceInput): ValidationResult {
  const errors: string[] = [];
  const fileName = normalizeRequiredText(input.fileName);
  const contentType = normalizeOptionalText(input.contentType);

  if (fileName.length < 5 || !fileName.toLowerCase().endsWith(".csv")) {
    errors.push("Import file must be a CSV file.");
  }

  if (
    contentType.length > 0 &&
    contentType !== "text/csv" &&
    contentType !== "application/csv" &&
    contentType !== "application/vnd.ms-excel"
  ) {
    errors.push("Import content type must be CSV.");
  }

  if (input.content.trim().length === 0) {
    errors.push("Import content is required.");
  }

  if (input.content.length > 250_000) {
    errors.push("Import content must be 250KB or smaller.");
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

export function normalizeProductInput(input: ProductInput): NormalizedProductInput {
  return {
    name: normalizeRequiredText(input.name),
    sku: nullableText(input.sku),
    unit: normalizeOptionalText(input.unit) || "unit",
    quantity: input.quantity ?? 0
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
