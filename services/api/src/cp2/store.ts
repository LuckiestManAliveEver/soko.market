import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { BusinessEvent } from "@soko/event-core";
import type {
  AccountSummary,
  AuthChannel,
  AuthSessionView,
  BusinessKnowledgeSummary,
  BusinessNotificationStatus,
  BusinessNotificationSummary,
  BusinessReportSummary,
  BusinessRole,
  BusinessSummary,
  CustomerDebtSummary,
  CustomerSummary,
  DocumentImportConfirmResult,
  DocumentImportJobSummary,
  DocumentImportPreviewRow,
  DocumentImportSourceSummary,
  InvoicePaymentSummary,
  InventoryMovementSummary,
  InvoiceItemSummary,
  InvoicePreview,
  InvoiceSummary,
  MembershipSummary,
  NotificationInbox,
  OfflineCacheSnapshot,
  PaymentSummary,
  ProductSummary,
  RuntimeContextSummary,
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider,
  RuntimeModelTrace,
  RuntimePlannedAction,
  RuntimeSessionSummary,
  RuntimeTelemetryEvent,
  RuntimeTurnResult,
  RuntimeTurnStatus,
  RuntimeTurnSummary,
  RuntimeVerificationResult,
  SessionSummary,
  SyncMutationPayload,
  SyncMutationType,
  SyncQueueItem,
  SyncQueueSummary,
  SyncReplayResult,
  SupplierImportDraft,
  SupplierSummary,
  SupportedLanguage,
  UserSummary
} from "@soko/shared-types";
import {
  createSyncQueueItem,
  markSyncProcessing,
  markSyncRejected,
  markSyncSynced,
  summarizeSyncQueue
} from "@soko/sync-core";
import {
  customerCreatedEvent,
  customerUpdatedEvent,
  createInvoicePreview,
  createInvoicePaymentSummary,
  createSupplierImportPreview,
  documentImportConfirmedEvent,
  documentImportFailedEvent,
  documentImportPreviewedEvent,
  invoiceConfirmedEvent,
  invoiceCreatedEvent,
  invoiceUpdatedEvent,
  isBusinessRole,
  normalizeContactRecordInput,
  normalizeInvoiceInput,
  normalizePaymentInput,
  normalizeProductInput,
  normalizeStockAdjustmentInput,
  paymentRecordedEvent,
  productCreatedEvent,
  productUpdatedEvent,
  roleCan,
  stockAdjustedEvent,
  supplierCreatedEvent,
  supplierUpdatedEvent,
  validateContactRecordInput,
  validateDocumentImportSource,
  validateInvoiceInput,
  validatePaymentInput,
  validateProductInput,
  validateStockAdjustmentInput,
  type BusinessPermission,
  type ContactRecordInput,
  type DocumentImportSourceInput,
  type InvoiceInput,
  type PaymentInput,
  type ProductInput,
  type StockAdjustmentInput
} from "@soko/business-core";
import {
  createRuntimeToolProposal,
  parseRuntimeModelOutput,
  parseMerchantCommand,
  runtimeToolRegistry,
  type RuntimeToolName
} from "@soko/tool-core";

export const sessionCookieName = "soko_session";

const otpTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxOtpAttempts = 5;
const maxRuntimeTurnsPerSession = 20;

export class Cp2Error extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

interface OtpChallenge {
  id: string;
  channel: AuthChannel;
  destination: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
}

interface SessionRecord extends SessionSummary {
  accountId: string;
  userId: string;
  revokedAt: string | null;
  createdAt: string;
}

interface DocumentImportSourceRecord extends DocumentImportSourceSummary {
  content: string;
}

interface PendingRuntimeAction {
  sessionId: string;
  businessId: string;
  actorId: string;
  action: RuntimePlannedAction;
}

export interface OtpRequestResult {
  challengeId: string;
  destination: string;
  expiresAt: string;
  devOtp: string;
}

export interface VerifyOtpResult extends AuthSessionView {
  resumed: boolean;
}

export interface CreateBusinessResult {
  business: BusinessSummary;
  membership: MembershipSummary;
}

export interface RoleCheckResult {
  allowed: boolean;
  role: BusinessRole;
  permission: BusinessPermission;
}

export interface Cp2Snapshot {
  accounts: AccountSummary[];
  users: UserSummary[];
  businesses: BusinessSummary[];
  memberships: MembershipSummary[];
  products: ProductSummary[];
  customers: CustomerSummary[];
  suppliers: SupplierSummary[];
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  documentImports: DocumentImportJobSummary[];
  documentImportSources: DocumentImportSourceSummary[];
  notifications: BusinessNotificationSummary[];
  runtimeSessions: RuntimeSessionSummary[];
  runtimeTurns: RuntimeTurnSummary[];
  inventoryMovements: InventoryMovementSummary[];
  syncQueue: SyncQueueItem[];
  sessions: SessionRecord[];
  auditEvents: BusinessEvent[];
}

export interface Cp2StoreOptions {
  runtimeModelProvider?: RuntimeModelProvider;
}

export class Cp2Store {
  constructor(private readonly options: Cp2StoreOptions = {}) {}

  private readonly accounts = new Map<string, AccountSummary>();
  private readonly accountByDestination = new Map<string, string>();
  private readonly users = new Map<string, UserSummary>();
  private readonly userByAccount = new Map<string, string>();
  private readonly businesses = new Map<string, BusinessSummary>();
  private readonly memberships = new Map<string, MembershipSummary>();
  private readonly products = new Map<string, ProductSummary>();
  private readonly customers = new Map<string, CustomerSummary>();
  private readonly suppliers = new Map<string, SupplierSummary>();
  private readonly invoices = new Map<string, InvoiceSummary>();
  private readonly payments = new Map<string, PaymentSummary>();
  private readonly documentImports = new Map<string, DocumentImportJobSummary>();
  private readonly documentImportSources = new Map<string, DocumentImportSourceRecord>();
  private readonly notifications = new Map<string, BusinessNotificationSummary>();
  private readonly notificationByRuleKey = new Map<string, string>();
  private readonly runtimeSessions = new Map<string, RuntimeSessionSummary>();
  private readonly runtimeTurns = new Map<string, RuntimeTurnSummary>();
  private readonly pendingRuntimeActions = new Map<string, PendingRuntimeAction>();
  private readonly nextInvoiceNumberByBusiness = new Map<string, number>();
  private readonly inventoryMovements = new Map<string, InventoryMovementSummary>();
  private readonly syncQueue = new Map<string, SyncQueueItem>();
  private readonly syncQueueIdByIdempotency = new Map<string, string>();
  private readonly otpChallenges = new Map<string, OtpChallenge>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly auditEvents: BusinessEvent[] = [];

  requestOtp(input: { channel: AuthChannel; destination: string; now?: Date }): OtpRequestResult {
    const now = input.now ?? new Date();
    const destination = normalizeDestination(input.channel, input.destination);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + otpTtlMs).toISOString();
    const createdAt = now.toISOString();

    this.otpChallenges.set(challengeId, {
      id: challengeId,
      channel: input.channel,
      destination,
      codeHash: hashOtp(challengeId, code),
      attempts: 0,
      maxAttempts: maxOtpAttempts,
      expiresAt,
      verifiedAt: null,
      createdAt
    });

    return {
      challengeId,
      destination,
      expiresAt,
      devOtp: code
    };
  }

  verifyOtp(input: { challengeId: string; code: string; now?: Date }): VerifyOtpResult {
    const now = input.now ?? new Date();
    const challenge = this.otpChallenges.get(input.challengeId);

    if (challenge === undefined) {
      throw new Cp2Error(404, "otp_not_found", "OTP challenge was not found.");
    }

    if (challenge.verifiedAt !== null) {
      throw new Cp2Error(409, "otp_already_verified", "OTP challenge is already verified.");
    }

    if (Date.parse(challenge.expiresAt) <= now.getTime()) {
      throw new Cp2Error(410, "otp_expired", "OTP challenge has expired.");
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new Cp2Error(429, "otp_attempts_exceeded", "OTP attempts exceeded.");
    }

    if (!hashMatches(hashOtp(challenge.id, input.code), challenge.codeHash)) {
      challenge.attempts += 1;
      throw new Cp2Error(401, "otp_invalid", "OTP code is invalid.");
    }

    challenge.verifiedAt = now.toISOString();
    const destinationKey = destinationAccountKey(challenge.channel, challenge.destination);
    const existingAccountId = this.accountByDestination.get(destinationKey);
    const resumed = existingAccountId !== undefined;
    const account =
      existingAccountId === undefined
        ? this.createAccount(challenge.channel, challenge.destination, now)
        : this.requireAccount(existingAccountId);
    const user = this.requireUser(this.userByAccount.get(account.id));
    const session = this.createSession(account, user, now);

    this.recordAuditEvent({
      type: "auth.otp_verified",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        challengeId: challenge.id,
        channel: challenge.channel,
        destination: challenge.destination
      }
    });

    this.recordAuditEvent({
      type: resumed ? "account.resumed" : "account.created",
      aggregateType: "account",
      aggregateId: account.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        primaryAuthChannel: account.primaryAuthChannel,
        primaryAuthDestination: account.primaryAuthDestination
      }
    });

    return {
      account,
      user,
      session,
      resumed
    };
  }

  getSession(sessionId: string | null, now = new Date()): AuthSessionView | null {
    if (sessionId === null) {
      return null;
    }

    const session = this.sessions.get(sessionId);

    if (session === undefined || session.revokedAt !== null) {
      return null;
    }

    if (Date.parse(session.expiresAt) <= now.getTime()) {
      return null;
    }

    return {
      account: this.requireAccount(session.accountId),
      user: this.requireUser(session.userId),
      session: sessionView(session)
    };
  }

  logout(sessionId: string | null, now = new Date()): boolean {
    if (sessionId === null) {
      return false;
    }

    const session = this.sessions.get(sessionId);

    if (session === undefined || session.revokedAt !== null) {
      return false;
    }

    session.revokedAt = now.toISOString();
    this.recordAuditEvent({
      type: "auth.session_revoked",
      aggregateType: "session",
      aggregateId: session.id,
      actorId: session.userId,
      occurredAt: now.toISOString(),
      payload: {
        accountId: session.accountId
      }
    });

    return true;
  }

  createBusiness(input: {
    sessionId: string | null;
    name: string;
    language: SupportedLanguage;
    now?: Date;
  }): CreateBusinessResult {
    const now = input.now ?? new Date();
    const session = this.getSession(input.sessionId, now);

    if (session === null) {
      throw new Cp2Error(401, "auth_required", "Authentication is required.");
    }

    const name = input.name.trim();

    if (name.length < 2) {
      throw new Cp2Error(
        400,
        "business_name_invalid",
        "Business name must be at least 2 characters."
      );
    }

    const business: BusinessSummary = {
      id: randomUUID(),
      name,
      language: input.language
    };
    const membership: MembershipSummary = {
      id: randomUUID(),
      businessId: business.id,
      userId: session.user.id,
      role: "owner"
    };

    this.businesses.set(business.id, business);
    this.memberships.set(membership.id, membership);
    this.users.set(session.user.id, {
      ...session.user,
      language: input.language
    });

    this.recordAuditEvent({
      type: "business.created",
      aggregateType: "business",
      aggregateId: business.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        name: business.name,
        language: business.language
      }
    });

    this.recordAuditEvent({
      type: "membership.created",
      aggregateType: "membership",
      aggregateId: membership.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: membership.businessId,
        userId: membership.userId,
        role: membership.role
      }
    });

    return {
      business,
      membership
    };
  }

  checkRole(input: {
    sessionId: string | null;
    businessId: string;
    role: string;
    permission?: BusinessPermission;
    now?: Date;
  }): RoleCheckResult {
    const now = input.now ?? new Date();
    const session = this.getSession(input.sessionId, now);

    if (session === null) {
      throw new Cp2Error(401, "auth_required", "Authentication is required.");
    }

    if (!isBusinessRole(input.role)) {
      throw new Cp2Error(400, "role_invalid", "Role is not supported.");
    }

    const role = input.role;
    const permission = input.permission ?? "business:read";
    const membership = [...this.memberships.values()].find(
      (candidate) =>
        candidate.businessId === input.businessId && candidate.userId === session.user.id
    );
    const allowed =
      membership !== undefined && membership.role === role && roleCan(membership.role, permission);

    return {
      allowed,
      role,
      permission
    };
  }

  listProducts(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): ProductSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "product:read", input.now);
    return [...this.products.values()].filter((product) => product.businessId === input.businessId);
  }

  createProduct(input: {
    sessionId: string | null;
    businessId: string;
    product: ProductInput;
    now?: Date;
  }): ProductSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "product:write",
      now
    );
    assertValid(validateProductInput(input.product));
    const normalized = normalizeProductInput(input.product);
    const product: ProductSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      name: normalized.name,
      sku: normalized.sku,
      unit: normalized.unit,
      quantity: normalized.quantity,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.products.set(product.id, product);
    this.appendBusinessEvent(
      productCreatedEvent({
        id: randomUUID(),
        product,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    if (product.quantity > 0) {
      this.createInventoryMovement({
        businessId: input.businessId,
        productId: product.id,
        quantityBefore: 0,
        quantityAfter: product.quantity,
        reason: "Initial product quantity",
        actorId: session.user.id,
        now
      });
    }

    return product;
  }

  updateProduct(input: {
    sessionId: string | null;
    businessId: string;
    productId: string;
    product: ProductInput;
    now?: Date;
  }): ProductSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "product:write",
      now
    );
    const existing = this.requireProduct(input.businessId, input.productId);
    assertValid(validateProductInput(input.product));
    const normalized = normalizeProductInput(input.product);
    const updated: ProductSummary = {
      ...existing,
      name: normalized.name,
      sku: normalized.sku,
      unit: normalized.unit,
      quantity: normalized.quantity,
      updatedAt: now.toISOString()
    };

    this.products.set(updated.id, updated);
    this.appendBusinessEvent(
      productUpdatedEvent({
        id: randomUUID(),
        product: updated,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    if (existing.quantity !== updated.quantity) {
      this.createInventoryMovement({
        businessId: input.businessId,
        productId: updated.id,
        quantityBefore: existing.quantity,
        quantityAfter: updated.quantity,
        reason: "Product quantity updated",
        actorId: session.user.id,
        now
      });
    }

    return updated;
  }

  adjustProductStock(input: {
    sessionId: string | null;
    businessId: string;
    productId: string;
    adjustment: StockAdjustmentInput;
    now?: Date;
  }): { product: ProductSummary; movement: InventoryMovementSummary } {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "inventory:adjust",
      now
    );
    const product = this.requireProduct(input.businessId, input.productId);
    assertValid(validateStockAdjustmentInput(input.adjustment));
    const normalized = normalizeStockAdjustmentInput(input.adjustment);
    const updated: ProductSummary = {
      ...product,
      quantity: normalized.quantityAfter,
      updatedAt: now.toISOString()
    };

    this.products.set(updated.id, updated);
    const movement = this.createInventoryMovement({
      businessId: input.businessId,
      productId: product.id,
      quantityBefore: product.quantity,
      quantityAfter: normalized.quantityAfter,
      reason: normalized.reason,
      actorId: session.user.id,
      now
    });

    return {
      product: updated,
      movement
    };
  }

  listCustomers(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): CustomerSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "customer:read", input.now);
    return [...this.customers.values()].filter(
      (customer) => customer.businessId === input.businessId
    );
  }

  createCustomer(input: {
    sessionId: string | null;
    businessId: string;
    customer: ContactRecordInput;
    now?: Date;
  }): CustomerSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "customer:write",
      now
    );
    assertValid(validateContactRecordInput(input.customer, "Customer"));
    const normalized = normalizeContactRecordInput(input.customer);
    const customer: CustomerSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      name: normalized.name,
      phone: normalized.phone,
      email: normalized.email,
      notes: normalized.notes,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.customers.set(customer.id, customer);
    this.appendBusinessEvent(
      customerCreatedEvent({
        id: randomUUID(),
        customer,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return customer;
  }

  updateCustomer(input: {
    sessionId: string | null;
    businessId: string;
    customerId: string;
    customer: ContactRecordInput;
    now?: Date;
  }): CustomerSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "customer:write",
      now
    );
    const existing = this.requireCustomer(input.businessId, input.customerId);
    assertValid(validateContactRecordInput(input.customer, "Customer"));
    const normalized = normalizeContactRecordInput(input.customer);
    const updated: CustomerSummary = {
      ...existing,
      name: normalized.name,
      phone: normalized.phone,
      email: normalized.email,
      notes: normalized.notes,
      updatedAt: now.toISOString()
    };

    this.customers.set(updated.id, updated);
    this.appendBusinessEvent(
      customerUpdatedEvent({
        id: randomUUID(),
        customer: updated,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  listSuppliers(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): SupplierSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "supplier:read", input.now);
    return [...this.suppliers.values()].filter(
      (supplier) => supplier.businessId === input.businessId
    );
  }

  createSupplier(input: {
    sessionId: string | null;
    businessId: string;
    supplier: ContactRecordInput;
    now?: Date;
  }): SupplierSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "supplier:write",
      now
    );
    assertValid(validateContactRecordInput(input.supplier, "Supplier"));
    const normalized = normalizeContactRecordInput(input.supplier);
    const supplier: SupplierSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      name: normalized.name,
      phone: normalized.phone,
      email: normalized.email,
      notes: normalized.notes,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.suppliers.set(supplier.id, supplier);
    this.appendBusinessEvent(
      supplierCreatedEvent({
        id: randomUUID(),
        supplier,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return supplier;
  }

  updateSupplier(input: {
    sessionId: string | null;
    businessId: string;
    supplierId: string;
    supplier: ContactRecordInput;
    now?: Date;
  }): SupplierSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "supplier:write",
      now
    );
    const existing = this.requireSupplier(input.businessId, input.supplierId);
    assertValid(validateContactRecordInput(input.supplier, "Supplier"));
    const normalized = normalizeContactRecordInput(input.supplier);
    const updated: SupplierSummary = {
      ...existing,
      name: normalized.name,
      phone: normalized.phone,
      email: normalized.email,
      notes: normalized.notes,
      updatedAt: now.toISOString()
    };

    this.suppliers.set(updated.id, updated);
    this.appendBusinessEvent(
      supplierUpdatedEvent({
        id: randomUUID(),
        supplier: updated,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  previewInvoice(input: {
    sessionId: string | null;
    businessId: string;
    invoice: InvoiceInput;
    now?: Date;
  }): InvoicePreview {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "invoice:write", input.now);
    assertValid(validateInvoiceInput(input.invoice));

    return this.buildInvoicePreview(input.businessId, input.invoice);
  }

  listInvoices(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): InvoiceSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "invoice:read", input.now);
    return [...this.invoices.values()].filter((invoice) => invoice.businessId === input.businessId);
  }

  createInvoice(input: {
    sessionId: string | null;
    businessId: string;
    invoice: InvoiceInput;
    now?: Date;
  }): InvoiceSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "invoice:write",
      now
    );
    assertValid(validateInvoiceInput(input.invoice));
    this.buildInvoicePreview(input.businessId, input.invoice);

    const invoice = this.buildStoredInvoice({
      businessId: input.businessId,
      invoiceId: randomUUID(),
      invoiceNumber: this.nextInvoiceNumber(input.businessId),
      input: input.invoice,
      status: "draft",
      confirmedAt: null,
      now
    });

    this.invoices.set(invoice.id, invoice);
    this.appendBusinessEvent(
      invoiceCreatedEvent({
        id: randomUUID(),
        invoice,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return invoice;
  }

  updateInvoice(input: {
    sessionId: string | null;
    businessId: string;
    invoiceId: string;
    invoice: InvoiceInput;
    now?: Date;
  }): InvoiceSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "invoice:write",
      now
    );
    const existing = this.requireInvoice(input.businessId, input.invoiceId);

    if (existing.status !== "draft") {
      throw new Cp2Error(409, "invoice_already_confirmed", "Confirmed invoices cannot be edited.");
    }

    assertValid(validateInvoiceInput(input.invoice));
    const invoice = this.buildStoredInvoice({
      businessId: input.businessId,
      invoiceId: existing.id,
      invoiceNumber: existing.invoiceNumber,
      input: input.invoice,
      status: "draft",
      confirmedAt: null,
      now,
      createdAt: existing.createdAt
    });

    this.invoices.set(invoice.id, invoice);
    this.appendBusinessEvent(
      invoiceUpdatedEvent({
        id: randomUUID(),
        invoice,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return invoice;
  }

  confirmInvoice(input: {
    sessionId: string | null;
    businessId: string;
    invoiceId: string;
    now?: Date;
  }): { invoice: InvoiceSummary; movements: InventoryMovementSummary[] } {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "invoice:confirm",
      now
    );
    const invoice = this.requireInvoice(input.businessId, input.invoiceId);

    if (invoice.status !== "draft") {
      throw new Cp2Error(409, "invoice_already_confirmed", "Invoice is already confirmed.");
    }

    const requiredQuantityByProduct = new Map<string, number>();

    for (const item of invoice.items) {
      requiredQuantityByProduct.set(
        item.productId,
        (requiredQuantityByProduct.get(item.productId) ?? 0) + item.quantity
      );
    }

    for (const [productId, requiredQuantity] of requiredQuantityByProduct) {
      const product = this.requireProduct(input.businessId, productId);

      if (product.quantity < requiredQuantity) {
        throw new Cp2Error(
          409,
          "stock_insufficient",
          `${product.name} has ${product.quantity} ${product.unit} available.`
        );
      }
    }

    const movements: InventoryMovementSummary[] = [];

    for (const item of invoice.items) {
      const product = this.requireProduct(input.businessId, item.productId);
      const updatedProduct: ProductSummary = {
        ...product,
        quantity: product.quantity - item.quantity,
        updatedAt: now.toISOString()
      };

      this.products.set(updatedProduct.id, updatedProduct);
      movements.push(
        this.createInventoryMovement({
          businessId: input.businessId,
          productId: product.id,
          type: "sale",
          quantityBefore: product.quantity,
          quantityAfter: updatedProduct.quantity,
          reason: `Invoice ${invoice.invoiceNumber}`,
          actorId: session.user.id,
          now
        })
      );
    }

    const confirmed: InvoiceSummary = {
      ...invoice,
      status: "confirmed",
      confirmedAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.invoices.set(confirmed.id, confirmed);
    this.appendBusinessEvent(
      invoiceConfirmedEvent({
        id: randomUUID(),
        invoice: confirmed,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return {
      invoice: confirmed,
      movements
    };
  }

  listPayments(input: {
    sessionId: string | null;
    businessId: string;
    invoiceId?: string;
    now?: Date;
  }): PaymentSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "payment:read", input.now);

    if (input.invoiceId !== undefined) {
      this.requireInvoice(input.businessId, input.invoiceId);
    }

    return [...this.payments.values()]
      .filter(
        (payment) =>
          payment.businessId === input.businessId &&
          (input.invoiceId === undefined || payment.invoiceId === input.invoiceId)
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  recordPayment(input: {
    sessionId: string | null;
    businessId: string;
    payment: PaymentInput;
    now?: Date;
  }): { payment: PaymentSummary; invoicePayment: InvoicePaymentSummary } {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "payment:write",
      now
    );
    assertValid(validatePaymentInput(input.payment));
    const normalized = normalizePaymentInput(input.payment);
    const invoice = this.requireInvoice(input.businessId, normalized.invoiceId);

    if (invoice.status !== "confirmed") {
      throw new Cp2Error(409, "invoice_not_confirmed", "Payments require a confirmed invoice.");
    }

    const currentSummary = this.buildInvoicePaymentSummary(invoice);

    if (normalized.amount > currentSummary.balanceDue) {
      throw new Cp2Error(
        409,
        "payment_exceeds_balance",
        "Payment amount exceeds the invoice balance."
      );
    }

    const payment: PaymentSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      method: normalized.method,
      amount: normalized.amount,
      reference: normalized.reference,
      note: normalized.note,
      actorId: session.user.id,
      createdAt: now.toISOString()
    };

    this.payments.set(payment.id, payment);
    const invoicePayment = this.buildInvoicePaymentSummary(invoice);
    this.appendBusinessEvent(
      paymentRecordedEvent({
        id: randomUUID(),
        payment,
        invoicePayment,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return {
      payment,
      invoicePayment
    };
  }

  listInvoicePaymentSummaries(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): InvoicePaymentSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "payment:read", input.now);
    return this.buildInvoicePaymentSummaries(input.businessId);
  }

  listCustomerDebts(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): CustomerDebtSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "payment:read", input.now);
    return this.buildCustomerDebtSummaries(input.businessId);
  }

  private buildCustomerDebtSummaries(businessId: string): CustomerDebtSummary[] {
    const debts = new Map<string, CustomerDebtSummary>();

    for (const summary of this.buildInvoicePaymentSummaries(businessId)) {
      if (summary.customerId === null || summary.balanceDue <= 0) {
        continue;
      }

      const existing = debts.get(summary.customerId);

      if (existing === undefined) {
        debts.set(summary.customerId, {
          customerId: summary.customerId,
          customerName: summary.customerName ?? "Customer",
          invoiceCount: 1,
          totalInvoiced: summary.invoiceTotal,
          totalPaid: summary.paidTotal,
          balanceDue: summary.balanceDue
        });
        continue;
      }

      debts.set(summary.customerId, {
        ...existing,
        invoiceCount: existing.invoiceCount + 1,
        totalInvoiced: roundMoney(existing.totalInvoiced + summary.invoiceTotal),
        totalPaid: roundMoney(existing.totalPaid + summary.paidTotal),
        balanceDue: roundMoney(existing.balanceDue + summary.balanceDue)
      });
    }

    return [...debts.values()].sort((left, right) =>
      right.balanceDue === left.balanceDue
        ? left.customerName.localeCompare(right.customerName)
        : right.balanceDue - left.balanceDue
    );
  }

  getOfflineCache(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): OfflineCacheSnapshot {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);

    return {
      businessId: input.businessId,
      capturedAt: now.toISOString(),
      source: "server_cache",
      products: this.listProducts(input),
      customers: this.listCustomers(input),
      suppliers: this.listSuppliers(input),
      invoices: this.listInvoices(input),
      payments: this.listPayments(input),
      invoicePaymentSummaries: this.listInvoicePaymentSummaries(input),
      customerDebts: this.listCustomerDebts(input),
      inventoryMovements: [...this.inventoryMovements.values()].filter(
        (movement) => movement.businessId === input.businessId
      )
    };
  }

  listSyncQueue(input: { sessionId: string | null; businessId: string; now?: Date }): {
    summary: SyncQueueSummary;
    items: SyncQueueItem[];
  } {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", input.now);
    const items = [...this.syncQueue.values()]
      .filter((item) => item.businessId === input.businessId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return {
      summary: summarizeSyncQueue(input.businessId, items),
      items
    };
  }

  getBusinessReport(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BusinessReportSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "report:read", now);
    return this.buildBusinessReport(input.businessId, now);
  }

  getBusinessKnowledge(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BusinessKnowledgeSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "report:read", now);
    return this.buildBusinessKnowledge(input.businessId, now);
  }

  listNotifications(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): NotificationInbox {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "notification:read", now);
    this.ensureDeterministicNotifications(input.businessId, now);
    const notifications = this.sortedNotifications(input.businessId);

    return {
      summary: summarizeNotifications(input.businessId, notifications),
      notifications
    };
  }

  updateNotificationStatus(input: {
    sessionId: string | null;
    businessId: string;
    notificationId: string;
    status: BusinessNotificationStatus;
    now?: Date;
  }): BusinessNotificationSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "notification:write",
      now
    );
    this.ensureDeterministicNotifications(input.businessId, now);
    const notification = this.notifications.get(input.notificationId);

    if (notification === undefined || notification.businessId !== input.businessId) {
      throw new Cp2Error(404, "notification_not_found", "Notification was not found.");
    }

    const updated: BusinessNotificationSummary = {
      ...notification,
      status: input.status,
      updatedAt: now.toISOString(),
      readAt:
        input.status === "read"
          ? (notification.readAt ?? now.toISOString())
          : input.status === "archived"
            ? (notification.readAt ?? now.toISOString())
            : null,
      archivedAt:
        input.status === "archived" ? (notification.archivedAt ?? now.toISOString()) : null
    };

    this.notifications.set(updated.id, updated);
    this.recordAuditEvent({
      type: "notification.status_updated",
      aggregateType: "notification",
      aggregateId: updated.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: input.businessId,
        status: updated.status,
        type: updated.type
      }
    });

    return updated;
  }

  enqueueSyncMutation(input: {
    sessionId: string | null;
    businessId: string;
    idempotencyKey: string;
    mutationType: SyncMutationType;
    payload: SyncMutationPayload;
    clientCreatedAt?: string;
    now?: Date;
  }): SyncQueueItem {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const idempotencyKey = input.idempotencyKey.trim();

    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new Cp2Error(
        400,
        "idempotency_key_invalid",
        "Idempotency key must be between 8 and 120 characters."
      );
    }

    const existingId = this.syncQueueIdByIdempotency.get(
      syncQueueIdempotencyKey(input.businessId, idempotencyKey)
    );

    if (existingId !== undefined) {
      return this.requireSyncQueueItem(input.businessId, existingId);
    }

    const item = createSyncQueueItem({
      id: randomUUID(),
      idempotencyKey,
      businessId: input.businessId,
      actorId: session.user.id,
      mutationType: input.mutationType,
      payload: input.payload,
      clientCreatedAt: input.clientCreatedAt ?? now.toISOString(),
      now: now.toISOString()
    });

    this.syncQueue.set(item.id, item);
    this.syncQueueIdByIdempotency.set(
      syncQueueIdempotencyKey(item.businessId, item.idempotencyKey),
      item.id
    );

    return item;
  }

  replaySyncQueueItem(input: {
    sessionId: string | null;
    businessId: string;
    syncItemId: string;
    now?: Date;
  }): SyncReplayResult {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const item = this.requireSyncQueueItem(input.businessId, input.syncItemId);

    if (item.actorId !== session.user.id) {
      throw new Cp2Error(403, "sync_actor_mismatch", "Queued work must be replayed by its actor.");
    }

    if (item.status === "synced") {
      return {
        item,
        replayed: false
      };
    }

    if (item.status === "processing") {
      throw new Cp2Error(409, "sync_item_processing", "Queued work is already processing.");
    }

    const processing = markSyncProcessing(item, now.toISOString());
    this.syncQueue.set(processing.id, processing);

    try {
      const result = this.replaySyncMutation({
        sessionId: input.sessionId,
        businessId: input.businessId,
        mutationType: processing.mutationType,
        payload: processing.payload,
        now
      });
      const synced = markSyncSynced(processing, result, now.toISOString());
      this.syncQueue.set(synced.id, synced);

      return {
        item: synced,
        replayed: true
      };
    } catch (error) {
      if (error instanceof Cp2Error) {
        const rejected = markSyncRejected(processing, {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          now: now.toISOString()
        });
        this.syncQueue.set(rejected.id, rejected);

        return {
          item: rejected,
          replayed: true
        };
      }

      throw error;
    }
  }

  replaySyncQueue(input: { sessionId: string | null; businessId: string; now?: Date }): {
    summary: SyncQueueSummary;
    results: SyncReplayResult[];
  } {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    const items = [...this.syncQueue.values()]
      .filter(
        (item) =>
          item.businessId === input.businessId &&
          (item.status === "pending" || item.status === "failed" || item.status === "conflict")
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const results = items.map((item) =>
      this.replaySyncQueueItem({
        sessionId: input.sessionId,
        businessId: input.businessId,
        syncItemId: item.id,
        now
      })
    );

    return {
      summary: this.listSyncQueue(input).summary,
      results
    };
  }

  createSupplierCsvImport(input: {
    sessionId: string | null;
    businessId: string;
    source: DocumentImportSourceInput;
    now?: Date;
  }): DocumentImportJobSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "import:write",
      now
    );
    assertValid(validateDocumentImportSource(input.source));
    const source: DocumentImportSourceRecord = {
      id: randomUUID(),
      businessId: input.businessId,
      fileName: input.source.fileName.trim(),
      contentType: input.source.contentType?.trim() || "text/csv",
      sizeBytes: Buffer.byteLength(input.source.content),
      checksum: createHash("sha256").update(input.source.content).digest("hex"),
      content: input.source.content,
      createdAt: now.toISOString()
    };
    const preview = createSupplierImportPreview({
      content: source.content
    });
    const job: DocumentImportJobSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      source: documentImportSourceView(source),
      target: "supplier",
      status: preview.rows.length === 0 ? "failed" : "previewed",
      fieldMapping: preview.fieldMapping,
      rows: preview.rows,
      confirmedCount: 0,
      errorMessage: preview.rows.length === 0 ? "Import file does not contain data rows." : null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      confirmedAt: null
    };

    this.documentImportSources.set(source.id, source);
    this.documentImports.set(job.id, job);
    this.appendBusinessEvent(
      job.status === "failed"
        ? documentImportFailedEvent({
            id: randomUUID(),
            importJob: job,
            actorId: session.user.id,
            occurredAt: now.toISOString()
          })
        : documentImportPreviewedEvent({
            id: randomUUID(),
            importJob: job,
            actorId: session.user.id,
            occurredAt: now.toISOString()
          })
    );

    return job;
  }

  listDocumentImports(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): DocumentImportJobSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "import:read", input.now);
    return [...this.documentImports.values()]
      .filter((job) => job.businessId === input.businessId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getDocumentImport(input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    now?: Date;
  }): DocumentImportJobSummary {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "import:read", input.now);
    return this.requireDocumentImport(input.businessId, input.importJobId);
  }

  updateSupplierImportRow(input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    rowNumber: number;
    mapped: SupplierImportDraft;
    selected?: boolean;
    now?: Date;
  }): DocumentImportJobSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "import:write", now);
    const job = this.requireDocumentImport(input.businessId, input.importJobId);

    if (job.status !== "previewed") {
      throw new Cp2Error(409, "import_not_editable", "Only previewed imports can be edited.");
    }

    const rowIndex = job.rows.findIndex((row) => row.rowNumber === input.rowNumber);

    if (rowIndex === -1) {
      throw new Cp2Error(404, "import_row_not_found", "Import row was not found.");
    }

    const validation = validateContactRecordInput(input.mapped, "Supplier");
    const rows = job.rows.map((row, index): DocumentImportPreviewRow => {
      if (index !== rowIndex) {
        return row;
      }

      return {
        ...row,
        mapped: input.mapped,
        errors: validation.errors,
        warnings: [],
        selected: input.selected ?? (validation.ok && row.selected)
      };
    });
    const updated: DocumentImportJobSummary = {
      ...job,
      rows,
      updatedAt: now.toISOString()
    };

    this.documentImports.set(updated.id, updated);
    return updated;
  }

  confirmSupplierImport(input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    selectedRowNumbers?: number[];
    now?: Date;
  }): DocumentImportConfirmResult {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "import:write",
      now
    );
    const job = this.requireDocumentImport(input.businessId, input.importJobId);

    if (job.status !== "previewed") {
      throw new Cp2Error(409, "import_not_confirmable", "Only previewed imports can be confirmed.");
    }

    const selectedRows = this.selectImportRows(job, input.selectedRowNumbers);

    if (selectedRows.length === 0) {
      throw new Cp2Error(400, "import_rows_required", "At least one import row must be selected.");
    }

    const invalidRows = selectedRows.filter(
      (row) => !validateContactRecordInput(row.mapped, "Supplier").ok
    );

    if (invalidRows.length > 0) {
      throw new Cp2Error(
        409,
        "import_rows_invalid",
        `Import has invalid selected rows: ${invalidRows.map((row) => row.rowNumber).join(", ")}.`
      );
    }

    const suppliers = selectedRows.map((row) =>
      this.createSupplier({
        sessionId: input.sessionId,
        businessId: input.businessId,
        supplier: row.mapped,
        now
      })
    );
    const confirmed: DocumentImportJobSummary = {
      ...job,
      status: "confirmed",
      confirmedCount: suppliers.length,
      updatedAt: now.toISOString(),
      confirmedAt: now.toISOString()
    };

    this.documentImports.set(confirmed.id, confirmed);
    this.appendBusinessEvent(
      documentImportConfirmedEvent({
        id: randomUUID(),
        importJob: confirmed,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return {
      job: confirmed,
      suppliers
    };
  }

  createRuntimeSession(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): RuntimeSessionSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const runtimeSession: RuntimeSessionSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      userId: session.user.id,
      status: "active",
      turnCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.runtimeSessions.set(runtimeSession.id, runtimeSession);
    this.recordAuditEvent({
      type: "runtime.session_created",
      aggregateType: "runtime_session",
      aggregateId: runtimeSession.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: input.businessId
      }
    });

    return runtimeSession;
  }

  listRuntimeSessions(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): RuntimeSessionSummary[] {
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      input.now
    );

    return [...this.runtimeSessions.values()]
      .filter(
        (runtimeSession) =>
          runtimeSession.businessId === input.businessId &&
          runtimeSession.userId === session.user.id
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listRuntimeTurns(input: {
    sessionId: string | null;
    businessId: string;
    runtimeSessionId: string;
    now?: Date;
  }): RuntimeTurnSummary[] {
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      input.now
    );
    const runtimeSession = this.requireRuntimeSession(input.businessId, input.runtimeSessionId);

    if (runtimeSession.userId !== session.user.id) {
      throw new Cp2Error(403, "runtime_actor_mismatch", "Runtime session belongs to another user.");
    }

    return [...this.runtimeTurns.values()]
      .filter((turn) => turn.sessionId === runtimeSession.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createRuntimeTurn(input: {
    sessionId: string | null;
    businessId: string;
    runtimeSessionId?: string;
    message: string;
    confirmationToken?: string;
    now?: Date;
  }): Promise<RuntimeTurnResult> {
    const now = input.now ?? new Date();
    const auth = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const runtimeSession =
      input.runtimeSessionId === undefined
        ? this.createRuntimeSession({
            sessionId: input.sessionId,
            businessId: input.businessId,
            now
          })
        : this.requireRuntimeSession(input.businessId, input.runtimeSessionId);

    if (runtimeSession.userId !== auth.user.id) {
      throw new Cp2Error(403, "runtime_actor_mismatch", "Runtime session belongs to another user.");
    }

    const context = this.buildRuntimeContext(input.businessId, auth.user.id);
    const turnId = randomUUID();
    const startedAt = now.toISOString();
    const telemetry: RuntimeTelemetryEvent[] = [];
    const appendTelemetry = (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata: RuntimeTelemetryEvent["metadata"] = {}
    ) => {
      telemetry.push({
        id: randomUUID(),
        sessionId: runtimeSession.id,
        turnId,
        state,
        occurredAt: now.toISOString(),
        toolName,
        risk,
        status,
        metadata
      });
    };

    appendTelemetry("turn.received", "completed", null, null, {
      messageLength: input.message.trim().length,
      hasConfirmationToken: input.confirmationToken !== undefined
    });

    if (runtimeSession.turnCount >= maxRuntimeTurnsPerSession) {
      const plan = createRuntimePlan({
        toolName: "unknown.clarify",
        input: {},
        validationErrors: ["Runtime session turn limit reached."],
        confirmationToken: null,
        status: "blocked"
      });
      const verification = createRuntimeVerification({
        requiresConfirmation: false,
        confirmationSatisfied: false,
        roleAllowed: true,
        rateLimited: true,
        errors: ["Runtime session turn limit reached."]
      });
      appendTelemetry("turn.rate_limited", "rate_limited", plan.toolName, plan.risk, {
        maxTurns: maxRuntimeTurnsPerSession
      });

      return this.storeRuntimeTurn({
        runtimeSession,
        turn: {
          id: turnId,
          sessionId: runtimeSession.id,
          businessId: input.businessId,
          actorId: auth.user.id,
          message: input.message,
          normalizedInput: input.message.trim().toLowerCase(),
          parserIntent: "unknown",
          parserConfidence: 0,
          status: "rate_limited",
          context,
          plan,
          verification,
          model: null,
          response: "This runtime session has reached its action limit. Start a new session.",
          toolResult: null,
          telemetry,
          createdAt: startedAt
        },
        now
      });
    }

    appendTelemetry("context.built", "completed", null, null, {
      productCount: context.productCount,
      invoiceCount: context.invoiceCount,
      importJobCount: context.importJobCount
    });

    if (input.confirmationToken !== undefined) {
      return this.confirmRuntimeAction({
        authUserId: auth.user.id,
        businessId: input.businessId,
        context,
        message: input.message,
        now,
        runtimeSession,
        telemetry,
        turnId,
        token: input.confirmationToken
      });
    }

    const parserResult = parseMerchantCommand(input.message);
    const modelRoute = await this.createRuntimeModelRoute({
      message: input.message,
      context,
      now,
      appendTelemetry
    });
    appendTelemetry("intent.routed", "completed", null, null, {
      intent: parserResult.intent,
      confidence: parserResult.confidence,
      source: modelRoute.proposal === null ? "parser" : "local_model"
    });
    const proposal = modelRoute.proposal ?? createRuntimeToolProposal(parserResult);
    const definition = runtimeToolRegistry[proposal.toolName];
    const roleAllowed = roleCan(context.role, definition.requiredPermission as BusinessPermission);
    const confirmationToken =
      proposal.validation.ok && definition.requiresConfirmation ? randomUUID() : null;
    const plan = createRuntimePlan({
      toolName: proposal.toolName,
      input: proposal.input,
      validationErrors: proposal.validation.errors,
      confirmationToken,
      status: proposal.validation.ok
        ? definition.requiresConfirmation
          ? "needs_confirmation"
          : "safe_to_execute"
        : "clarification_required"
    });
    const verificationErrors = [
      ...proposal.validation.errors,
      ...(roleAllowed ? [] : ["Actor role cannot use the proposed runtime tool."])
    ];
    const verification = createRuntimeVerification({
      requiresConfirmation: definition.requiresConfirmation,
      confirmationSatisfied: false,
      roleAllowed,
      rateLimited: false,
      errors: verificationErrors
    });
    appendTelemetry("plan.created", plan.status, plan.toolName, plan.risk, {
      requiresConfirmation: plan.requiresConfirmation,
      readOnly: definition.readOnly
    });
    appendTelemetry("verification.completed", plan.status, plan.toolName, plan.risk, {
      ok: verification.ok,
      roleAllowed: verification.roleAllowed
    });

    if (confirmationToken !== null) {
      this.pendingRuntimeActions.set(confirmationToken, {
        sessionId: runtimeSession.id,
        businessId: input.businessId,
        actorId: auth.user.id,
        action: plan
      });
      appendTelemetry("confirmation.required", "needs_confirmation", plan.toolName, plan.risk, {
        actionId: plan.id
      });
    }

    const canExecute = plan.status === "safe_to_execute" && verification.ok;
    const toolResult = canExecute
      ? this.executeRuntimeAction({
          sessionId: input.sessionId,
          businessId: input.businessId,
          action: plan,
          now
        })
      : null;

    if (canExecute) {
      appendTelemetry("tool.executed", "completed", plan.toolName, plan.risk, {
        actionId: plan.id
      });
      plan.executedAt = now.toISOString();
    }

    const status = runtimeStatusFromPlan(plan, verification);
    appendTelemetry("response.generated", status, plan.toolName, plan.risk, {
      actionId: plan.id
    });

    return this.storeRuntimeTurn({
      runtimeSession,
      turn: {
        id: turnId,
        sessionId: runtimeSession.id,
        businessId: input.businessId,
        actorId: auth.user.id,
        message: input.message,
        normalizedInput: parserResult.normalizedInput,
        parserIntent: parserResult.intent,
        parserConfidence: parserResult.confidence,
        status,
        context,
        plan,
        verification,
        model: modelRoute.trace,
        response: createRuntimeResponse({
          plan,
          proposalReason: proposal.reason,
          toolResult,
          verification
        }),
        toolResult,
        telemetry,
        createdAt: startedAt
      },
      now
    });
  }

  snapshot(): Cp2Snapshot {
    return {
      accounts: [...this.accounts.values()],
      users: [...this.users.values()],
      businesses: [...this.businesses.values()],
      memberships: [...this.memberships.values()],
      products: [...this.products.values()],
      customers: [...this.customers.values()],
      suppliers: [...this.suppliers.values()],
      invoices: [...this.invoices.values()],
      payments: [...this.payments.values()],
      documentImports: [...this.documentImports.values()],
      documentImportSources: [...this.documentImportSources.values()].map(documentImportSourceView),
      notifications: [...this.notifications.values()],
      runtimeSessions: [...this.runtimeSessions.values()],
      runtimeTurns: [...this.runtimeTurns.values()],
      inventoryMovements: [...this.inventoryMovements.values()],
      syncQueue: [...this.syncQueue.values()],
      sessions: [...this.sessions.values()],
      auditEvents: [...this.auditEvents]
    };
  }

  private createAccount(channel: AuthChannel, destination: string, now: Date): AccountSummary {
    const account: AccountSummary = {
      id: randomUUID(),
      primaryAuthChannel: channel,
      primaryAuthDestination: destination
    };
    const user: UserSummary = {
      id: randomUUID(),
      accountId: account.id,
      displayName: defaultDisplayName(destination),
      language: "en"
    };

    this.accounts.set(account.id, account);
    this.accountByDestination.set(destinationAccountKey(channel, destination), account.id);
    this.users.set(user.id, user);
    this.userByAccount.set(account.id, user.id);

    this.recordAuditEvent({
      type: "user.created",
      aggregateType: "user",
      aggregateId: user.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        accountId: account.id,
        language: user.language
      }
    });

    return account;
  }

  private createSession(account: AccountSummary, user: UserSummary, now: Date): SessionSummary {
    const session: SessionRecord = {
      id: randomUUID(),
      accountId: account.id,
      userId: user.id,
      expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString(),
      revokedAt: null,
      createdAt: now.toISOString()
    };

    this.sessions.set(session.id, session);
    this.recordAuditEvent({
      type: "auth.session_created",
      aggregateType: "session",
      aggregateId: session.id,
      actorId: user.id,
      occurredAt: now.toISOString(),
      payload: {
        accountId: account.id
      }
    });

    return sessionView(session);
  }

  private requireAccount(accountId: string): AccountSummary {
    const account = this.accounts.get(accountId);

    if (account === undefined) {
      throw new Cp2Error(500, "account_missing", "Account state is inconsistent.");
    }

    return account;
  }

  private requireUser(userId: string | undefined): UserSummary {
    if (userId === undefined) {
      throw new Cp2Error(500, "user_missing", "User state is inconsistent.");
    }

    const user = this.users.get(userId);

    if (user === undefined) {
      throw new Cp2Error(500, "user_missing", "User state is inconsistent.");
    }

    return user;
  }

  private requireAuthorizedSession(
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now = new Date()
  ): AuthSessionView {
    const session = this.getSession(sessionId, now);

    if (session === null) {
      throw new Cp2Error(401, "auth_required", "Authentication is required.");
    }

    if (!this.businesses.has(businessId)) {
      throw new Cp2Error(404, "business_not_found", "Business was not found.");
    }

    const membership = this.requireMembership(businessId, session.user.id);

    if (!roleCan(membership.role, permission)) {
      throw new Cp2Error(403, "permission_denied", "Permission denied for this business.");
    }

    return session;
  }

  private requireMembership(businessId: string, userId: string): MembershipSummary {
    const membership = [...this.memberships.values()].find(
      (candidate) => candidate.businessId === businessId && candidate.userId === userId
    );

    if (membership === undefined) {
      throw new Cp2Error(403, "membership_required", "Business membership is required.");
    }

    return membership;
  }

  private requireProduct(businessId: string, productId: string): ProductSummary {
    const product = this.products.get(productId);

    if (product === undefined || product.businessId !== businessId) {
      throw new Cp2Error(404, "product_not_found", "Product was not found.");
    }

    return product;
  }

  private requireCustomer(businessId: string, customerId: string): CustomerSummary {
    const customer = this.customers.get(customerId);

    if (customer === undefined || customer.businessId !== businessId) {
      throw new Cp2Error(404, "customer_not_found", "Customer was not found.");
    }

    return customer;
  }

  private requireSupplier(businessId: string, supplierId: string): SupplierSummary {
    const supplier = this.suppliers.get(supplierId);

    if (supplier === undefined || supplier.businessId !== businessId) {
      throw new Cp2Error(404, "supplier_not_found", "Supplier was not found.");
    }

    return supplier;
  }

  private requireInvoice(businessId: string, invoiceId: string): InvoiceSummary {
    const invoice = this.invoices.get(invoiceId);

    if (invoice === undefined || invoice.businessId !== businessId) {
      throw new Cp2Error(404, "invoice_not_found", "Invoice was not found.");
    }

    return invoice;
  }

  private requireSyncQueueItem(businessId: string, syncItemId: string): SyncQueueItem {
    const item = this.syncQueue.get(syncItemId);

    if (item === undefined || item.businessId !== businessId) {
      throw new Cp2Error(404, "sync_item_not_found", "Queued work item was not found.");
    }

    return item;
  }

  private requireDocumentImport(businessId: string, importJobId: string): DocumentImportJobSummary {
    const job = this.documentImports.get(importJobId);

    if (job === undefined || job.businessId !== businessId) {
      throw new Cp2Error(404, "import_not_found", "Document import was not found.");
    }

    return job;
  }

  private selectImportRows(
    job: DocumentImportJobSummary,
    selectedRowNumbers: number[] | undefined
  ): DocumentImportPreviewRow[] {
    if (selectedRowNumbers === undefined) {
      return job.rows.filter((row) => row.selected);
    }

    const selected = new Set(selectedRowNumbers);
    return job.rows.filter((row) => selected.has(row.rowNumber));
  }

  private replaySyncMutation(input: {
    sessionId: string | null;
    businessId: string;
    mutationType: SyncMutationType;
    payload: SyncMutationPayload;
    now: Date;
  }): unknown {
    switch (input.mutationType) {
      case "product.create":
        return this.createProduct({
          sessionId: input.sessionId,
          businessId: input.businessId,
          product: input.payload as ProductInput,
          now: input.now
        });

      case "customer.create":
        return this.createCustomer({
          sessionId: input.sessionId,
          businessId: input.businessId,
          customer: input.payload as ContactRecordInput,
          now: input.now
        });

      case "supplier.create":
        return this.createSupplier({
          sessionId: input.sessionId,
          businessId: input.businessId,
          supplier: input.payload as ContactRecordInput,
          now: input.now
        });

      case "inventory.adjust": {
        const payload = input.payload as { productId: string } & StockAdjustmentInput;

        return this.adjustProductStock({
          sessionId: input.sessionId,
          businessId: input.businessId,
          productId: payload.productId,
          adjustment: payload,
          now: input.now
        });
      }

      case "invoice.create":
        return this.createInvoice({
          sessionId: input.sessionId,
          businessId: input.businessId,
          invoice: input.payload as InvoiceInput,
          now: input.now
        });

      case "invoice.confirm":
        return this.confirmInvoice({
          sessionId: input.sessionId,
          businessId: input.businessId,
          invoiceId: (input.payload as { invoiceId: string }).invoiceId,
          now: input.now
        });

      case "payment.record":
        return this.recordPayment({
          sessionId: input.sessionId,
          businessId: input.businessId,
          payment: input.payload as PaymentInput,
          now: input.now
        });
    }
  }

  private confirmRuntimeAction(input: {
    authUserId: string;
    businessId: string;
    context: RuntimeContextSummary;
    message: string;
    now: Date;
    runtimeSession: RuntimeSessionSummary;
    telemetry: RuntimeTelemetryEvent[];
    turnId: string;
    token: string;
  }): RuntimeTurnResult {
    const pending = this.pendingRuntimeActions.get(input.token);

    if (pending === undefined) {
      throw new Cp2Error(
        404,
        "runtime_confirmation_not_found",
        "Runtime confirmation was not found."
      );
    }

    if (
      pending.sessionId !== input.runtimeSession.id ||
      pending.businessId !== input.businessId ||
      pending.actorId !== input.authUserId
    ) {
      throw new Cp2Error(
        403,
        "runtime_confirmation_mismatch",
        "Runtime confirmation is not valid."
      );
    }

    const action: RuntimePlannedAction = {
      ...pending.action,
      status: "safe_to_execute",
      confirmationToken: input.token
    };
    const definition = runtimeToolRegistry[action.toolName as RuntimeToolName];
    const roleAllowed = roleCan(
      input.context.role,
      definition.requiredPermission as BusinessPermission
    );
    const verification = createRuntimeVerification({
      requiresConfirmation: action.requiresConfirmation,
      confirmationSatisfied: true,
      roleAllowed,
      rateLimited: false,
      errors: roleAllowed ? [] : ["Actor role cannot use the confirmed runtime tool."]
    });
    const appendTelemetry = (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      metadata: RuntimeTelemetryEvent["metadata"] = {}
    ) => {
      input.telemetry.push({
        id: randomUUID(),
        sessionId: input.runtimeSession.id,
        turnId: input.turnId,
        state,
        occurredAt: input.now.toISOString(),
        toolName: action.toolName,
        risk: action.risk,
        status,
        metadata
      });
    };

    appendTelemetry("intent.routed", "completed", {
      confirmation: true
    });
    appendTelemetry("plan.created", action.status, {
      actionId: action.id
    });
    appendTelemetry("verification.completed", action.status, {
      ok: verification.ok,
      roleAllowed: verification.roleAllowed
    });

    const toolResult = verification.ok
      ? this.executeRuntimeAction({
          sessionId: this.requireSessionIdForUser(input.authUserId),
          businessId: input.businessId,
          action,
          now: input.now
        })
      : null;

    if (verification.ok) {
      action.executedAt = input.now.toISOString();
      this.pendingRuntimeActions.delete(input.token);
      appendTelemetry("tool.executed", "completed", {
        actionId: action.id
      });
    }

    appendTelemetry("response.generated", verification.ok ? "completed" : "blocked", {
      actionId: action.id
    });

    return this.storeRuntimeTurn({
      runtimeSession: input.runtimeSession,
      turn: {
        id: input.turnId,
        sessionId: input.runtimeSession.id,
        businessId: input.businessId,
        actorId: input.authUserId,
        message: input.message,
        normalizedInput: input.message.trim().toLowerCase(),
        parserIntent: "unknown",
        parserConfidence: 1,
        status: verification.ok ? "completed" : "blocked",
        context: input.context,
        plan: action,
        verification,
        model: null,
        response: verification.ok
          ? `Confirmed and executed ${action.toolName}.`
          : "I could not execute the confirmed action.",
        toolResult,
        telemetry: input.telemetry,
        createdAt: input.now.toISOString()
      },
      now: input.now
    });
  }

  private executeRuntimeAction(input: {
    sessionId: string | null;
    businessId: string;
    action: RuntimePlannedAction;
    now: Date;
  }): unknown {
    switch (input.action.toolName) {
      case "products.list":
        return this.listProducts({
          sessionId: input.sessionId,
          businessId: input.businessId,
          now: input.now
        });

      case "invoices.list":
        return this.listInvoices({
          sessionId: input.sessionId,
          businessId: input.businessId,
          now: input.now
        });

      case "product.create":
        return this.createProduct({
          sessionId: input.sessionId,
          businessId: input.businessId,
          product: {
            name: String(input.action.input.name ?? ""),
            sku: null,
            unit: String(input.action.input.unit ?? "unit"),
            quantity: Number(input.action.input.quantity ?? 0)
          },
          now: input.now
        });

      case "customer.create":
        return this.createCustomer({
          sessionId: input.sessionId,
          businessId: input.businessId,
          customer: {
            name: String(input.action.input.name ?? ""),
            phone: null,
            email: null,
            notes: null
          },
          now: input.now
        });

      case "invoice.draft":
      case "payment.record":
      case "unknown.clarify":
        return null;
    }
  }

  private buildRuntimeContext(businessId: string, userId: string): RuntimeContextSummary {
    const membership = this.requireMembership(businessId, userId);
    const invoices = [...this.invoices.values()].filter(
      (invoice) => invoice.businessId === businessId
    );
    const knowledge = this.buildBusinessKnowledge(businessId, new Date());

    return {
      businessId,
      userId,
      role: membership.role,
      productCount: [...this.products.values()].filter(
        (product) => product.businessId === businessId
      ).length,
      customerCount: [...this.customers.values()].filter(
        (customer) => customer.businessId === businessId
      ).length,
      supplierCount: [...this.suppliers.values()].filter(
        (supplier) => supplier.businessId === businessId
      ).length,
      invoiceCount: invoices.length,
      openInvoiceCount: invoices.filter(
        (invoice) => this.buildInvoicePaymentSummary(invoice).balanceDue > 0
      ).length,
      paymentCount: [...this.payments.values()].filter(
        (payment) => payment.businessId === businessId
      ).length,
      importJobCount: [...this.documentImports.values()].filter(
        (job) => job.businessId === businessId
      ).length,
      lowStockCount: knowledge.report.inventory.lowStockCount,
      outstandingDebtTotal: knowledge.report.debts.totalOutstanding,
      unreadNotificationCount: knowledge.notificationSummary.unread,
      knowledgeFactCount: knowledge.facts.length
    };
  }

  private buildBusinessReport(businessId: string, now: Date): BusinessReportSummary {
    const products = this.productsForBusiness(businessId);
    const invoices = this.invoicesForBusiness(businessId);
    const payments = this.paymentsForBusiness(businessId);
    const imports = this.importsForBusiness(businessId);
    const movements = [...this.inventoryMovements.values()].filter(
      (movement) => movement.businessId === businessId
    );
    const paymentSummaries = this.buildInvoicePaymentSummaries(businessId);
    const debts = this.buildCustomerDebtSummaries(businessId);
    const syncSummary = summarizeSyncQueue(businessId, this.syncItemsForBusiness(businessId));
    const confirmedInvoices = invoices.filter((invoice) => invoice.status === "confirmed");

    return {
      businessId,
      generatedAt: now.toISOString(),
      sales: {
        invoiceCount: invoices.length,
        confirmedInvoiceCount: confirmedInvoices.length,
        grossSales: roundMoney(
          confirmedInvoices.reduce((total, invoice) => total + invoice.total, 0)
        ),
        collectedTotal: roundMoney(payments.reduce((total, payment) => total + payment.amount, 0)),
        outstandingTotal: roundMoney(
          paymentSummaries.reduce((total, summary) => total + summary.balanceDue, 0)
        )
      },
      inventory: {
        productCount: products.length,
        totalUnitsOnHand: roundMoney(
          products.reduce((total, product) => total + product.quantity, 0)
        ),
        lowStockCount: products.filter((product) => product.quantity > 0 && product.quantity <= 2)
          .length,
        outOfStockCount: products.filter((product) => product.quantity <= 0).length,
        movementCount: movements.length
      },
      payments: {
        paymentCount: payments.length,
        paidInvoiceCount: paymentSummaries.filter((summary) => summary.status === "paid").length,
        partiallyPaidInvoiceCount: paymentSummaries.filter(
          (summary) => summary.status === "partially_paid"
        ).length,
        unpaidInvoiceCount: paymentSummaries.filter((summary) => summary.status === "unpaid")
          .length,
        totalPaid: roundMoney(payments.reduce((total, payment) => total + payment.amount, 0))
      },
      debts: {
        customerCount: debts.length,
        totalOutstanding: roundMoney(debts.reduce((total, debt) => total + debt.balanceDue, 0)),
        largestBalanceDue: roundMoney(Math.max(0, ...debts.map((debt) => debt.balanceDue)))
      },
      imports: {
        totalJobs: imports.length,
        previewedJobs: imports.filter((job) => job.status === "previewed").length,
        confirmedJobs: imports.filter((job) => job.status === "confirmed").length,
        failedJobs: imports.filter((job) => job.status === "failed").length,
        confirmedRows: imports.reduce((total, job) => total + job.confirmedCount, 0)
      },
      sync: {
        ...syncSummary,
        active:
          syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict
      }
    };
  }

  private buildBusinessKnowledge(businessId: string, now: Date): BusinessKnowledgeSummary {
    const report = this.buildBusinessReport(businessId, now);
    this.ensureDeterministicNotifications(businessId, now);
    const notificationSummary = summarizeNotifications(
      businessId,
      this.sortedNotifications(businessId)
    );
    const facts = [
      {
        topic: "sales" as const,
        severity: "info" as const,
        detail: `${report.sales.confirmedInvoiceCount} confirmed invoices total ${report.sales.grossSales}.`,
        metric: report.sales.grossSales
      },
      {
        topic: "debt" as const,
        severity: report.debts.totalOutstanding > 0 ? ("warning" as const) : ("info" as const),
        detail: `${report.debts.customerCount} customers have outstanding balances.`,
        metric: report.debts.totalOutstanding
      },
      {
        topic: "inventory" as const,
        severity:
          report.inventory.outOfStockCount > 0
            ? ("critical" as const)
            : report.inventory.lowStockCount > 0
              ? ("warning" as const)
              : ("info" as const),
        detail: `${report.inventory.lowStockCount} low-stock products and ${report.inventory.outOfStockCount} out of stock.`,
        metric: report.inventory.lowStockCount + report.inventory.outOfStockCount
      },
      {
        topic: "sync" as const,
        severity: report.sync.conflict > 0 ? ("critical" as const) : ("info" as const),
        detail: `${report.sync.active} sync items need attention.`,
        metric: report.sync.active
      },
      {
        topic: "notifications" as const,
        severity: notificationSummary.unread > 0 ? ("warning" as const) : ("info" as const),
        detail: `${notificationSummary.unread} unread in-app notifications.`,
        metric: notificationSummary.unread
      }
    ];

    return {
      businessId,
      generatedAt: now.toISOString(),
      report,
      notificationSummary,
      facts
    };
  }

  private ensureDeterministicNotifications(businessId: string, now: Date): void {
    const report = this.buildBusinessReport(businessId, now);

    if (report.inventory.outOfStockCount > 0 || report.inventory.lowStockCount > 0) {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:inventory.low_stock`,
        type: "low_stock",
        severity: report.inventory.outOfStockCount > 0 ? "critical" : "warning",
        title: "Inventory needs attention",
        body: `${report.inventory.lowStockCount} low-stock products and ${report.inventory.outOfStockCount} out of stock.`,
        sourceType: "report",
        sourceId: null,
        now
      });
    }

    if (report.debts.totalOutstanding > 0) {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:debt.open`,
        type: "open_debt",
        severity: "warning",
        title: "Open customer debt",
        body: `${report.debts.customerCount} customers owe ${report.debts.totalOutstanding}.`,
        sourceType: "report",
        sourceId: null,
        now
      });
    }

    if (report.sync.conflict > 0) {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:sync.conflict`,
        type: "sync_conflict",
        severity: "critical",
        title: "Sync conflicts need review",
        body: `${report.sync.conflict} queued sync item${report.sync.conflict === 1 ? "" : "s"} have conflicts.`,
        sourceType: "sync_queue",
        sourceId: null,
        now
      });
    }

    if (report.imports.failedJobs > 0) {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:import.failed`,
        type: "import_failed",
        severity: "warning",
        title: "Import failed",
        body: `${report.imports.failedJobs} document import job${report.imports.failedJobs === 1 ? "" : "s"} failed.`,
        sourceType: "document_import",
        sourceId: null,
        now
      });
    }
  }

  private upsertNotification(input: {
    businessId: string;
    ruleKey: string;
    type: BusinessNotificationSummary["type"];
    severity: BusinessNotificationSummary["severity"];
    title: string;
    body: string;
    sourceType: BusinessNotificationSummary["sourceType"];
    sourceId: string | null;
    now: Date;
  }): void {
    const existingId = this.notificationByRuleKey.get(input.ruleKey);
    const existing = existingId === undefined ? undefined : this.notifications.get(existingId);

    if (existing !== undefined) {
      if (existing.status === "archived") {
        return;
      }

      this.notifications.set(existing.id, {
        ...existing,
        severity: input.severity,
        title: input.title,
        body: input.body,
        updatedAt: input.now.toISOString()
      });
      return;
    }

    const notification: BusinessNotificationSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      type: input.type,
      severity: input.severity,
      status: "unread",
      title: input.title,
      body: input.body,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
      readAt: null,
      archivedAt: null
    };

    this.notifications.set(notification.id, notification);
    this.notificationByRuleKey.set(input.ruleKey, notification.id);
    this.recordAuditEvent({
      type: "notification.created",
      aggregateType: "notification",
      aggregateId: notification.id,
      actorId: "system",
      occurredAt: input.now.toISOString(),
      payload: {
        businessId: input.businessId,
        type: notification.type,
        severity: notification.severity
      }
    });
  }

  private sortedNotifications(businessId: string): BusinessNotificationSummary[] {
    return [...this.notifications.values()]
      .filter((notification) => notification.businessId === businessId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private productsForBusiness(businessId: string): ProductSummary[] {
    return [...this.products.values()].filter((product) => product.businessId === businessId);
  }

  private invoicesForBusiness(businessId: string): InvoiceSummary[] {
    return [...this.invoices.values()].filter((invoice) => invoice.businessId === businessId);
  }

  private paymentsForBusiness(businessId: string): PaymentSummary[] {
    return [...this.payments.values()].filter((payment) => payment.businessId === businessId);
  }

  private importsForBusiness(businessId: string): DocumentImportJobSummary[] {
    return [...this.documentImports.values()].filter((job) => job.businessId === businessId);
  }

  private syncItemsForBusiness(businessId: string): SyncQueueItem[] {
    return [...this.syncQueue.values()].filter((item) => item.businessId === businessId);
  }

  private async createRuntimeModelRoute(input: {
    message: string;
    context: RuntimeContextSummary;
    now: Date;
    appendTelemetry: (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata?: RuntimeTelemetryEvent["metadata"]
    ) => void;
  }): Promise<{
    proposal: ReturnType<typeof createRuntimeToolProposal> | null;
    trace: RuntimeModelTrace | null;
  }> {
    const provider = this.options.runtimeModelProvider;

    if (provider === undefined) {
      return {
        proposal: null,
        trace: null
      };
    }

    const prompt = buildRuntimeModelPrompt(input.message, input.context);
    input.appendTelemetry("model.prompt_built", "completed", null, null, {
      provider: provider.name,
      allowedToolCount: prompt.allowedTools.length,
      messageLength: input.message.trim().length,
      productCount: input.context.productCount,
      invoiceCount: input.context.invoiceCount
    });

    let completion: RuntimeModelCompletionResult;

    try {
      completion = await provider.complete(prompt);
    } catch {
      input.appendTelemetry("model.completed", "blocked", null, null, {
        provider: provider.name,
        adapterStatus: "error",
        durationMs: 0,
        errorCode: "provider_exception"
      });
      input.appendTelemetry("model.fallback", "completed", null, null, {
        provider: provider.name,
        adapterStatus: "error",
        errorCode: "provider_exception"
      });

      return {
        proposal: null,
        trace: {
          provider: provider.name,
          status: "error",
          durationMs: 0,
          fallbackUsed: true,
          outputKind: null,
          errorCode: "provider_exception"
        }
      };
    }

    input.appendTelemetry(
      "model.completed",
      completion.status === "available" ? "completed" : "blocked",
      null,
      null,
      {
        provider: completion.provider,
        adapterStatus: completion.status,
        durationMs: completion.durationMs,
        errorCode: completion.errorCode
      }
    );

    if (completion.status !== "available" || completion.outputText === null) {
      input.appendTelemetry("model.fallback", "completed", null, null, {
        provider: completion.provider,
        adapterStatus: completion.status,
        errorCode: completion.errorCode
      });

      return {
        proposal: null,
        trace: modelTraceFromCompletion(completion, true, null)
      };
    }

    const parsed = parseRuntimeModelOutput(completion.outputText);

    if (!parsed.ok || parsed.output === null) {
      input.appendTelemetry("model.fallback", "completed", null, null, {
        provider: completion.provider,
        adapterStatus: "malformed",
        errorCode: parsed.errors[0] ?? "model_output_malformed"
      });

      return {
        proposal: null,
        trace: {
          provider: completion.provider,
          status: "malformed",
          durationMs: completion.durationMs,
          fallbackUsed: true,
          outputKind: null,
          errorCode: parsed.errors[0] ?? "model_output_malformed"
        }
      };
    }

    return {
      proposal: parsed.output.proposal,
      trace: modelTraceFromCompletion(completion, false, parsed.output.kind)
    };
  }

  private requireRuntimeSession(
    businessId: string,
    runtimeSessionId: string
  ): RuntimeSessionSummary {
    const runtimeSession = this.runtimeSessions.get(runtimeSessionId);

    if (runtimeSession === undefined || runtimeSession.businessId !== businessId) {
      throw new Cp2Error(404, "runtime_session_not_found", "Runtime session was not found.");
    }

    if (runtimeSession.status !== "active") {
      throw new Cp2Error(409, "runtime_session_closed", "Runtime session is closed.");
    }

    return runtimeSession;
  }

  private requireSessionIdForUser(userId: string): string | null {
    const session = [...this.sessions.values()]
      .filter((candidate) => candidate.userId === userId && candidate.revokedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

    return session?.id ?? null;
  }

  private storeRuntimeTurn(input: {
    runtimeSession: RuntimeSessionSummary;
    turn: RuntimeTurnSummary;
    now: Date;
  }): RuntimeTurnResult {
    this.runtimeTurns.set(input.turn.id, input.turn);
    const updatedSession: RuntimeSessionSummary = {
      ...input.runtimeSession,
      turnCount: input.runtimeSession.turnCount + 1,
      updatedAt: input.now.toISOString()
    };
    this.runtimeSessions.set(updatedSession.id, updatedSession);
    this.recordAuditEvent({
      type: "runtime.turn_recorded",
      aggregateType: "runtime_turn",
      aggregateId: input.turn.id,
      actorId: input.turn.actorId,
      occurredAt: input.now.toISOString(),
      payload: {
        businessId: input.turn.businessId,
        runtimeSessionId: input.turn.sessionId,
        parserIntent: input.turn.parserIntent,
        toolName: input.turn.plan.toolName,
        risk: input.turn.plan.risk,
        status: input.turn.status,
        messageLength: input.turn.message.length
      }
    });

    return {
      session: updatedSession,
      turn: input.turn
    };
  }

  private buildInvoicePreview(businessId: string, invoice: InvoiceInput): InvoicePreview {
    const normalized = normalizeInvoiceInput(invoice);
    const customer =
      normalized.customerId === null
        ? null
        : this.requireCustomer(businessId, normalized.customerId);
    const products = normalized.items.map((item) =>
      this.requireProduct(businessId, item.productId)
    );

    return createInvoicePreview({
      businessId,
      invoice,
      products,
      customer
    });
  }

  private buildStoredInvoice(input: {
    businessId: string;
    invoiceId: string;
    invoiceNumber: string;
    input: InvoiceInput;
    status: "draft" | "confirmed";
    confirmedAt: string | null;
    now: Date;
    createdAt?: string;
  }): InvoiceSummary {
    const preview = this.buildInvoicePreview(input.businessId, input.input);
    const items: InvoiceItemSummary[] = preview.items.map((item) => ({
      id: randomUUID(),
      invoiceId: input.invoiceId,
      ...item
    }));

    return {
      id: input.invoiceId,
      businessId: input.businessId,
      invoiceNumber: input.invoiceNumber,
      status: input.status,
      customerId: preview.customerId,
      customerName: preview.customerName,
      items,
      subtotal: preview.subtotal,
      taxRate: preview.taxRate,
      taxTotal: preview.taxTotal,
      total: preview.total,
      confirmedAt: input.confirmedAt,
      createdAt: input.createdAt ?? input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };
  }

  private nextInvoiceNumber(businessId: string): string {
    const nextNumber = this.nextInvoiceNumberByBusiness.get(businessId) ?? 1;
    this.nextInvoiceNumberByBusiness.set(businessId, nextNumber + 1);
    return `INV-${String(nextNumber).padStart(5, "0")}`;
  }

  private createInventoryMovement(input: {
    businessId: string;
    productId: string;
    type?: "manual_adjustment" | "sale";
    quantityBefore: number;
    quantityAfter: number;
    reason: string;
    actorId: string;
    now: Date;
  }): InventoryMovementSummary {
    const movement: InventoryMovementSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      productId: input.productId,
      type: input.type ?? "manual_adjustment",
      quantityBefore: input.quantityBefore,
      quantityAfter: input.quantityAfter,
      delta: input.quantityAfter - input.quantityBefore,
      reason: input.reason,
      actorId: input.actorId,
      createdAt: input.now.toISOString()
    };

    this.inventoryMovements.set(movement.id, movement);
    this.appendBusinessEvent(
      stockAdjustedEvent({
        id: randomUUID(),
        movement,
        actorId: input.actorId,
        occurredAt: input.now.toISOString()
      })
    );

    return movement;
  }

  private buildInvoicePaymentSummaries(businessId: string): InvoicePaymentSummary[] {
    return [...this.invoices.values()]
      .filter((invoice) => invoice.businessId === businessId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((invoice) => this.buildInvoicePaymentSummary(invoice));
  }

  private buildInvoicePaymentSummary(invoice: InvoiceSummary): InvoicePaymentSummary {
    return createInvoicePaymentSummary({
      invoice,
      payments: [...this.payments.values()].filter(
        (payment) => payment.businessId === invoice.businessId
      )
    });
  }

  private appendBusinessEvent(event: BusinessEvent): void {
    this.auditEvents.push(event);
  }

  private recordAuditEvent(input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }): void {
    this.auditEvents.push(
      createAuditEvent({
        id: randomUUID(),
        type: input.type,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        actorId: input.actorId,
        risk: "low",
        occurredAt: input.occurredAt,
        payload: input.payload
      })
    );
  }
}

export function createCp2Store(options: Cp2StoreOptions = {}): Cp2Store {
  return new Cp2Store(options);
}

function buildRuntimeModelPrompt(
  message: string,
  context: RuntimeContextSummary
): RuntimeModelPrompt {
  return {
    message,
    context,
    allowedTools: Object.keys(runtimeToolRegistry) as RuntimeToolName[],
    schemaVersion: "cp11-runtime-model-v1"
  };
}

function modelTraceFromCompletion(
  completion: RuntimeModelCompletionResult,
  fallbackUsed: boolean,
  outputKind: RuntimeModelTrace["outputKind"]
): RuntimeModelTrace {
  return {
    provider: completion.provider,
    status: completion.status,
    durationMs: completion.durationMs,
    fallbackUsed,
    outputKind,
    errorCode: completion.errorCode
  };
}

function createRuntimePlan(input: {
  toolName: RuntimeToolName;
  input: Record<string, unknown>;
  validationErrors: string[];
  confirmationToken: string | null;
  status: RuntimePlannedAction["status"];
}): RuntimePlannedAction {
  const definition = runtimeToolRegistry[input.toolName];

  return {
    id: randomUUID(),
    toolName: input.toolName,
    risk: definition.risk,
    requiresConfirmation: definition.requiresConfirmation,
    status: input.status,
    input: input.input,
    validationErrors: input.validationErrors,
    confirmationToken: input.confirmationToken,
    executedAt: null
  };
}

function createRuntimeVerification(input: {
  requiresConfirmation: boolean;
  confirmationSatisfied: boolean;
  roleAllowed: boolean;
  rateLimited: boolean;
  errors: string[];
}): RuntimeVerificationResult {
  return {
    ok:
      !input.rateLimited &&
      input.roleAllowed &&
      input.errors.length === 0 &&
      (!input.requiresConfirmation || input.confirmationSatisfied),
    requiresConfirmation: input.requiresConfirmation,
    confirmationSatisfied: input.confirmationSatisfied,
    roleAllowed: input.roleAllowed,
    rateLimited: input.rateLimited,
    errors: input.errors
  };
}

function runtimeStatusFromPlan(
  plan: RuntimePlannedAction,
  verification: RuntimeVerificationResult
): RuntimeTurnStatus {
  if (verification.rateLimited) {
    return "rate_limited";
  }

  if (!verification.roleAllowed) {
    return "blocked";
  }

  if (plan.status === "clarification_required") {
    return "clarifying";
  }

  if (plan.status === "needs_confirmation") {
    return "needs_confirmation";
  }

  return verification.errors.length > 0 ? "blocked" : "completed";
}

function createRuntimeResponse(input: {
  plan: RuntimePlannedAction;
  proposalReason: string;
  toolResult: unknown | null;
  verification: RuntimeVerificationResult;
}): string {
  if (!input.verification.roleAllowed) {
    return "I cannot use that tool with your current business role.";
  }

  if (input.plan.status === "clarification_required") {
    return input.plan.validationErrors[0] ?? "I need more details before I can plan that.";
  }

  if (input.plan.status === "needs_confirmation") {
    return `I prepared ${input.plan.toolName}. Confirm before I run it.`;
  }

  if (input.toolResult !== null) {
    return `${input.proposalReason} Done.`;
  }

  return input.proposalReason;
}

export function serializeSessionCookie(
  sessionId: string,
  maxAgeSeconds = sessionTtlMs / 1000
): string {
  return `${sessionCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");

    if (name === sessionCookieName) {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

export function normalizeDestination(channel: AuthChannel, destination: string): string {
  const normalized = destination.trim();

  if (channel === "email") {
    const email = normalized.toLowerCase();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Cp2Error(400, "destination_invalid", "Email address is invalid.");
    }

    return email;
  }

  const phone = normalized.replace(/[\s-]/g, "");

  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    throw new Cp2Error(400, "destination_invalid", "Phone number is invalid.");
  }

  return phone.startsWith("+") ? phone : `+${phone}`;
}

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return value === "en" || value === "sw";
}

function createAuditEvent<TPayload extends Record<string, unknown>>(
  event: BusinessEvent<TPayload>
): BusinessEvent<TPayload> {
  return deepFreeze({
    ...event,
    payload: deepFreeze({ ...event.payload })
  }) as BusinessEvent<TPayload>;
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  for (const propertyName of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[propertyName]);
  }

  return Object.freeze(value);
}

function destinationAccountKey(channel: AuthChannel, destination: string): string {
  return `${channel}:${destination}`;
}

function syncQueueIdempotencyKey(businessId: string, idempotencyKey: string): string {
  return `${businessId}:${idempotencyKey}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function summarizeNotifications(
  businessId: string,
  notifications: BusinessNotificationSummary[]
): NotificationInbox["summary"] {
  const summary = {
    businessId,
    unread: 0,
    read: 0,
    archived: 0,
    total: notifications.length
  };

  for (const notification of notifications) {
    summary[notification.status] += 1;
  }

  return summary;
}

function hashOtp(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

function hashMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function sessionView(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    expiresAt: session.expiresAt
  };
}

function documentImportSourceView(source: DocumentImportSourceRecord): DocumentImportSourceSummary {
  return {
    id: source.id,
    businessId: source.businessId,
    fileName: source.fileName,
    contentType: source.contentType,
    sizeBytes: source.sizeBytes,
    checksum: source.checksum,
    createdAt: source.createdAt
  };
}

function defaultDisplayName(destination: string): string {
  return destination.includes("@") ? (destination.split("@")[0] ?? "Owner") : "Owner";
}

function assertValid(result: { ok: boolean; errors: string[] }): void {
  if (!result.ok) {
    throw new Cp2Error(400, "validation_failed", result.errors.join(" "));
  }
}
