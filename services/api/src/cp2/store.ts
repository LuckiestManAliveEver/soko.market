import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { BusinessEvent } from "@soko/event-core";
import type {
  AccountSummary,
  AuthChannel,
  AuthSessionView,
  BusinessRole,
  BusinessSummary,
  CustomerSummary,
  InventoryMovementSummary,
  InvoiceItemSummary,
  InvoicePreview,
  InvoiceSummary,
  MembershipSummary,
  ProductSummary,
  SessionSummary,
  SupplierSummary,
  SupportedLanguage,
  UserSummary
} from "@soko/shared-types";
import {
  customerCreatedEvent,
  customerUpdatedEvent,
  createInvoicePreview,
  invoiceConfirmedEvent,
  invoiceCreatedEvent,
  invoiceUpdatedEvent,
  isBusinessRole,
  normalizeContactRecordInput,
  normalizeInvoiceInput,
  normalizeProductInput,
  normalizeStockAdjustmentInput,
  productCreatedEvent,
  productUpdatedEvent,
  roleCan,
  stockAdjustedEvent,
  supplierCreatedEvent,
  supplierUpdatedEvent,
  validateContactRecordInput,
  validateInvoiceInput,
  validateProductInput,
  validateStockAdjustmentInput,
  type BusinessPermission,
  type ContactRecordInput,
  type InvoiceInput,
  type ProductInput,
  type StockAdjustmentInput
} from "@soko/business-core";

export const sessionCookieName = "soko_session";

const otpTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxOtpAttempts = 5;

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
  inventoryMovements: InventoryMovementSummary[];
  sessions: SessionRecord[];
  auditEvents: BusinessEvent[];
}

export class Cp2Store {
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
  private readonly nextInvoiceNumberByBusiness = new Map<string, number>();
  private readonly inventoryMovements = new Map<string, InventoryMovementSummary>();
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

    for (const item of invoice.items) {
      const product = this.requireProduct(input.businessId, item.productId);

      if (product.quantity < item.quantity) {
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
      inventoryMovements: [...this.inventoryMovements.values()],
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

export function createCp2Store(): Cp2Store {
  return new Cp2Store();
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

function defaultDisplayName(destination: string): string {
  return destination.includes("@") ? (destination.split("@")[0] ?? "Owner") : "Owner";
}

function assertValid(result: { ok: boolean; errors: string[] }): void {
  if (!result.ok) {
    throw new Cp2Error(400, "validation_failed", result.errors.join(" "));
  }
}
