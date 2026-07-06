import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { BusinessEvent } from "@soko/event-core";
import type {
  AccountSummary,
  AccountDeletionRequestSummary,
  AuthChannel,
  AuthSessionView,
  BetaAccessSummary,
  BetaDeviceTestSummary,
  BetaFeatureFlagKey,
  BetaFeatureFlagSummary,
  BetaReadinessReportSummary,
  BetaSupportTicketSummary,
  BetaTelemetryEventSummary,
  BusinessKnowledgeSummary,
  BusinessNotificationStatus,
  BusinessNotificationSummary,
  BusinessReportSummary,
  BusinessRole,
  BusinessSummary,
  ComplianceRetentionSummary,
  CountryTaxConfigSummary,
  CustomerDebtSummary,
  CustomerSummary,
  DataExportBundle,
  DataExportBundleSummary,
  DeviceTrustSummary,
  DocumentImportConfirmResult,
  DocumentImportJobSummary,
  DocumentImportPreviewRow,
  DocumentImportSourceSummary,
  InvoicePaymentSummary,
  InventoryMovementSummary,
  InvoiceItemSummary,
  InvoicePreview,
  InvoiceSummary,
  LaunchChecklistItemSummary,
  LaunchChecklistKey,
  LaunchIncidentSummary,
  LaunchReadinessReportSummary,
  LaunchSettingsSummary,
  LogisticsReportSummary,
  LogisticsSummary,
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
  VerificationTierSummary,
  SecurityReviewSummary,
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
  accountDeletionScheduledEvent,
  betaAccessUpdatedEvent,
  betaDeviceTestRecordedEvent,
  betaFeatureFlagRisk,
  betaFeatureFlagUpdatedEvent,
  betaSupportTicketCreatedEvent,
  betaSupportTicketStatusUpdatedEvent,
  betaTelemetryRecordedEvent,
  customerCreatedEvent,
  customerUpdatedEvent,
  createInvoicePreview,
  createInvoicePaymentSummary,
  createSupplierImportPreview,
  dataExportCreatedEvent,
  deviceTrustUpdatedEvent,
  documentImportConfirmedEvent,
  documentImportFailedEvent,
  documentImportPreviewedEvent,
  invoiceConfirmedEvent,
  invoiceCreatedEvent,
  invoiceUpdatedEvent,
  isBusinessRole,
  launchChecklistUpdatedEvent,
  launchIncidentCreatedEvent,
  launchIncidentStatusUpdatedEvent,
  launchSettingsUpdatedEvent,
  normalizeBetaAccessInput,
  normalizeBetaDeviceTestInput,
  normalizeBetaFeatureFlagInput,
  normalizeBetaSupportTicketInput,
  normalizeBetaSupportTicketStatusInput,
  normalizeBetaTelemetryInput,
  normalizeLaunchChecklistInput,
  normalizeLaunchIncidentInput,
  normalizeLaunchIncidentStatusInput,
  normalizeLaunchSettingsInput,
  normalizeAccountDeletionInput,
  normalizeContactRecordInput,
  normalizeCountryTaxConfigInput,
  normalizeDeviceTrustInput,
  normalizeInvoiceInput,
  normalizeLogisticsInput,
  normalizeLogisticsStatusInput,
  normalizePaymentInput,
  normalizeProductInput,
  normalizeStockAdjustmentInput,
  normalizeVerificationTierInput,
  paymentRecordedEvent,
  productCreatedEvent,
  productUpdatedEvent,
  roleCan,
  stockAdjustedEvent,
  supplierCreatedEvent,
  supplierUpdatedEvent,
  taxConfigUpdatedEvent,
  verificationTierUpdatedEvent,
  validateAccountDeletionInput,
  validateBetaAccessInput,
  validateBetaDeviceTestInput,
  validateBetaFeatureFlagInput,
  validateBetaSupportTicketInput,
  validateBetaSupportTicketStatusInput,
  validateBetaTelemetryInput,
  validateLaunchChecklistInput,
  validateLaunchIncidentInput,
  validateLaunchIncidentStatusInput,
  validateLaunchSettingsInput,
  logisticsCreatedEvent,
  logisticsStatusUpdatedEvent,
  validateContactRecordInput,
  validateCountryTaxConfigInput,
  validateDeviceTrustInput,
  validateDocumentImportSource,
  validateInvoiceInput,
  validateLogisticsInput,
  validateLogisticsStatusInput,
  validateLogisticsStatusTransition,
  validatePaymentInput,
  validateProductInput,
  validateStockAdjustmentInput,
  validateVerificationTierInput,
  type AccountDeletionInput,
  type BetaAccessInput,
  type BetaDeviceTestInput,
  type BetaFeatureFlagInput,
  type BetaSupportTicketInput,
  type BetaSupportTicketStatusInput,
  type BetaTelemetryInput,
  type BusinessPermission,
  type ContactRecordInput,
  type CountryTaxConfigInput,
  type DeviceTrustInput,
  type DocumentImportSourceInput,
  type InvoiceInput,
  type LaunchChecklistInput,
  type LaunchIncidentInput,
  type LaunchIncidentStatusInput,
  type LaunchSettingsInput,
  type LogisticsInput,
  type LogisticsStatusInput,
  type PaymentInput,
  type ProductInput,
  type StockAdjustmentInput,
  type VerificationTierInput
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

export interface OtpChallengeDelivery {
  challengeId: string;
  channel: AuthChannel;
  destination: string;
  expiresAt: string;
}

interface SessionRecord extends SessionSummary {
  accountId: string;
  userId: string;
  pinVerifiedAt: string | null;
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
  logistics: LogisticsSummary[];
  dataExports: DataExportBundleSummary[];
  accountDeletionRequests: AccountDeletionRequestSummary[];
  verificationTiers: VerificationTierSummary[];
  taxConfigs: CountryTaxConfigSummary[];
  deviceTrust: DeviceTrustSummary[];
  betaAccess: BetaAccessSummary[];
  betaFeatureFlags: BetaFeatureFlagSummary[];
  betaDeviceTests: BetaDeviceTestSummary[];
  betaSupportTickets: BetaSupportTicketSummary[];
  betaTelemetryEvents: BetaTelemetryEventSummary[];
  launchSettings: LaunchSettingsSummary[];
  launchChecklist: LaunchChecklistItemSummary[];
  launchIncidents: LaunchIncidentSummary[];
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
  private readonly logistics = new Map<string, LogisticsSummary>();
  private readonly logisticsByInvoice = new Map<string, string>();
  private readonly dataExports = new Map<string, DataExportBundle>();
  private readonly accountDeletionRequests = new Map<string, AccountDeletionRequestSummary>();
  private readonly verificationTiers = new Map<string, VerificationTierSummary>();
  private readonly taxConfigs = new Map<string, CountryTaxConfigSummary>();
  private readonly deviceTrust = new Map<string, DeviceTrustSummary>();
  private readonly betaAccess = new Map<string, BetaAccessSummary>();
  private readonly betaFeatureFlags = new Map<string, BetaFeatureFlagSummary>();
  private readonly betaDeviceTests = new Map<string, BetaDeviceTestSummary>();
  private readonly betaSupportTickets = new Map<string, BetaSupportTicketSummary>();
  private readonly betaTelemetryEvents = new Map<string, BetaTelemetryEventSummary>();
  private readonly launchSettings = new Map<string, LaunchSettingsSummary>();
  private readonly launchChecklist = new Map<string, LaunchChecklistItemSummary>();
  private readonly launchIncidents = new Map<string, LaunchIncidentSummary>();
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
  private readonly accountPinHashes = new Map<string, string>();
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

    this.validateOtpChallenge(challenge, now);

    if (!hashMatches(hashOtp(challenge.id, input.code), challenge.codeHash)) {
      challenge.attempts += 1;
      throw new Cp2Error(401, "otp_invalid", "OTP code is invalid.");
    }

    return this.completeOtpVerification(challenge, now);
  }

  getOtpChallengeDelivery(challengeId: string, now = new Date()): OtpChallengeDelivery {
    const challenge = this.otpChallenges.get(challengeId);
    this.validateOtpChallenge(challenge, now);

    return {
      challengeId: challenge.id,
      channel: challenge.channel,
      destination: challenge.destination,
      expiresAt: challenge.expiresAt
    };
  }

  getOtpChallengeDeliveryByContact(
    input: { channel: AuthChannel; destination: string },
    now = new Date()
  ): OtpChallengeDelivery {
    const destination = normalizeDestination(input.channel, input.destination);
    const challenge = [...this.otpChallenges.values()]
      .reverse()
      .find((item) => item.channel === input.channel && item.destination === destination);
    this.validateOtpChallenge(challenge, now);

    return {
      challengeId: challenge.id,
      channel: challenge.channel,
      destination: challenge.destination,
      expiresAt: challenge.expiresAt
    };
  }

  verifyExternallyApprovedOtp(input: { challengeId: string; now?: Date }): VerifyOtpResult {
    const now = input.now ?? new Date();
    const challenge = this.otpChallenges.get(input.challengeId);
    this.validateOtpChallenge(challenge, now);

    return this.completeOtpVerification(challenge, now);
  }

  private validateOtpChallenge(
    challenge: OtpChallenge | undefined,
    now: Date
  ): asserts challenge is OtpChallenge {
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
  }

  private completeOtpVerification(challenge: OtpChallenge, now: Date): VerifyOtpResult {
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

  setAccountPin(input: { sessionId: string | null; pin: string; now?: Date }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    const pin = normalizePin(input.pin);
    this.accountPinHashes.set(session.account.id, hashPin(session.account.id, pin));
    this.markSessionPinVerified(session.session.id, now);

    this.recordAuditEvent({
      type: "auth.pin_set",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  getAccountPinStatus(input: { sessionId: string | null; now?: Date }): { hasPin: boolean } {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);

    return {
      hasPin: this.accountPinHashes.has(session.account.id)
    };
  }

  recoverAccountPin(input: { sessionId: string | null; pin: string; now?: Date }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    const pin = normalizePin(input.pin);

    if (!this.accountPinHashes.has(session.account.id)) {
      throw new Cp2Error(409, "pin_not_set", "Login PIN has not been set.");
    }

    this.accountPinHashes.set(session.account.id, hashPin(session.account.id, pin));
    this.markSessionPinVerified(session.session.id, now);

    this.recordAuditEvent({
      type: "auth.pin_recovered",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  verifyAccountPin(input: { sessionId: string | null; pin: string; now?: Date }): AuthSessionView {
    const now = input.now ?? new Date();
    const session = this.requireAnySession(input.sessionId, now);
    const pin = normalizePin(input.pin);
    const pinHash = this.accountPinHashes.get(session.account.id);

    if (pinHash === undefined) {
      throw new Cp2Error(404, "pin_not_set", "Login PIN has not been set.");
    }

    if (!hashMatches(hashPin(session.account.id, pin), pinHash)) {
      throw new Cp2Error(401, "pin_invalid", "Login PIN is invalid.");
    }

    this.markSessionPinVerified(session.session.id, now);
    this.recordAuditEvent({
      type: "auth.pin_verified",
      aggregateType: "account",
      aggregateId: session.account.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {}
    });

    return this.requireAnySession(input.sessionId, now);
  }

  createBusiness(input: {
    sessionId: string | null;
    name: string;
    language: SupportedLanguage;
    now?: Date;
  }): CreateBusinessResult {
    const now = input.now ?? new Date();
    const session = this.requirePinVerifiedSession(input.sessionId, now);

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
    const session = this.requirePinVerifiedSession(input.sessionId, now);

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

  listLogistics(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): LogisticsSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "logistics:read", input.now);
    return this.logisticsForBusiness(input.businessId).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  createLogistics(input: {
    sessionId: string | null;
    businessId: string;
    logistics: LogisticsInput;
    now?: Date;
  }): LogisticsSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "logistics:write",
      now
    );
    assertValid(validateLogisticsInput(input.logistics));
    const normalized = normalizeLogisticsInput(input.logistics);
    const invoice = this.requireInvoice(input.businessId, normalized.invoiceId);

    if (invoice.status !== "confirmed") {
      throw new Cp2Error(
        409,
        "invoice_not_confirmed",
        "Logistics records require a confirmed invoice."
      );
    }

    if (this.logisticsByInvoice.has(invoice.id)) {
      throw new Cp2Error(
        409,
        "logistics_invoice_exists",
        "This invoice already has a logistics record."
      );
    }

    const logistics: LogisticsSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      method: normalized.method,
      status: "pending",
      destination: normalized.destination,
      note: normalized.note,
      actorId: session.user.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
      cancelledAt: null
    };

    this.logistics.set(logistics.id, logistics);
    this.logisticsByInvoice.set(invoice.id, logistics.id);
    this.appendBusinessEvent(
      logisticsCreatedEvent({
        id: randomUUID(),
        logistics,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return logistics;
  }

  updateLogisticsStatus(input: {
    sessionId: string | null;
    businessId: string;
    logisticsId: string;
    status: LogisticsStatusInput;
    now?: Date;
  }): LogisticsSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "logistics:write",
      now
    );
    const existing = this.requireLogistics(input.businessId, input.logisticsId);
    assertValid(validateLogisticsStatusInput(input.status));
    const normalized = normalizeLogisticsStatusInput(input.status);
    assertValid(
      validateLogisticsStatusTransition(existing.status, normalized.status, existing.method)
    );
    const updated: LogisticsSummary = {
      ...existing,
      status: normalized.status,
      note: normalized.note ?? existing.note,
      updatedAt: now.toISOString(),
      completedAt:
        normalized.status === "completed" ? (existing.completedAt ?? now.toISOString()) : null,
      cancelledAt:
        normalized.status === "cancelled" ? (existing.cancelledAt ?? now.toISOString()) : null
    };

    this.logistics.set(updated.id, updated);
    this.appendBusinessEvent(
      logisticsStatusUpdatedEvent({
        id: randomUUID(),
        logistics: updated,
        previousStatus: existing.status,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
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

    return this.buildOfflineCacheSnapshot(input.businessId, now);
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

  createDataExport(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): DataExportBundle {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:export",
      now
    );
    const account = this.requireAccount(session.account.id);
    const user = this.requireUser(session.user.id);
    const business = this.requireBusiness(input.businessId);
    const auditEvents = this.auditEventsForBusiness(input.businessId).map((event) => ({
      id: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      risk: event.risk
    }));
    const data = {
      account,
      user,
      business,
      memberships: this.membershipsForBusiness(input.businessId),
      products: this.productsForBusiness(input.businessId),
      customers: this.customersForBusiness(input.businessId),
      suppliers: this.suppliersForBusiness(input.businessId),
      invoices: this.invoicesForBusiness(input.businessId),
      payments: this.paymentsForBusiness(input.businessId),
      logistics: this.logisticsForBusiness(input.businessId),
      documentImports: this.importsForBusiness(input.businessId),
      notifications: this.sortedNotifications(input.businessId),
      inventoryMovements: this.inventoryMovementsForBusiness(input.businessId),
      auditEvents
    };
    const recordCounts = countExportRecords(data);
    const exportBundle: DataExportBundle = {
      id: randomUUID(),
      businessId: input.businessId,
      accountId: account.id,
      actorId: session.user.id,
      status: "ready",
      recordCounts,
      checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
      createdAt: now.toISOString(),
      data
    };

    this.dataExports.set(exportBundle.id, exportBundle);
    this.appendBusinessEvent(
      dataExportCreatedEvent({
        id: randomUUID(),
        exportBundle,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return exportBundle;
  }

  requestAccountDeletion(input: {
    sessionId: string | null;
    businessId: string;
    deletion: AccountDeletionInput;
    now?: Date;
  }): AccountDeletionRequestSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:delete",
      now
    );
    assertValid(validateAccountDeletionInput(input.deletion));
    const normalized = normalizeAccountDeletionInput(input.deletion);
    const retention = this.buildComplianceRetention(input.businessId);
    const deletionRequest: AccountDeletionRequestSummary = {
      id: randomUUID(),
      accountId: session.account.id,
      userId: session.user.id,
      businessId: input.businessId,
      actorId: session.user.id,
      status: "scheduled",
      reason: normalized.reason,
      requestedAt: now.toISOString(),
      deactivatedAt: now.toISOString(),
      anonymizeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      retention
    };

    this.accountDeletionRequests.set(deletionRequest.id, deletionRequest);
    this.revokeSessionsForAccount(session.account.id, now);
    this.appendBusinessEvent(
      accountDeletionScheduledEvent({
        id: randomUUID(),
        deletionRequest,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return deletionRequest;
  }

  getVerificationTier(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): VerificationTierSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "verification:read",
      now
    );
    return this.getOrCreateVerificationTier(input.businessId, session.user.id, now);
  }

  updateVerificationTier(input: {
    sessionId: string | null;
    businessId: string;
    verification: VerificationTierInput;
    now?: Date;
  }): VerificationTierSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "verification:write",
      now
    );
    assertValid(validateVerificationTierInput(input.verification));
    const normalized = normalizeVerificationTierInput(input.verification);
    const existing = this.getOrCreateVerificationTier(input.businessId, session.user.id, now);
    const updated: VerificationTierSummary = {
      businessId: input.businessId,
      tier: normalized.tier,
      evidenceType: normalized.evidenceType,
      note: normalized.note,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.verificationTiers.set(input.businessId, updated);
    this.appendBusinessEvent(
      verificationTierUpdatedEvent({
        id: randomUUID(),
        verification: updated,
        previousTier: existing.tier,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  getTaxConfig(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): CountryTaxConfigSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "tax:read",
      now
    );
    return this.getOrCreateTaxConfig(input.businessId, session.user.id, now);
  }

  updateTaxConfig(input: {
    sessionId: string | null;
    businessId: string;
    taxConfig: CountryTaxConfigInput;
    now?: Date;
  }): CountryTaxConfigSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "tax:write",
      now
    );
    assertValid(validateCountryTaxConfigInput(input.taxConfig));
    const normalized = normalizeCountryTaxConfigInput(input.taxConfig);
    const updated: CountryTaxConfigSummary = {
      businessId: input.businessId,
      countryCode: normalized.countryCode,
      defaultTaxRate: normalized.defaultTaxRate,
      taxIdLabel: normalized.countryCode === "KE" ? "KRA PIN" : "Tax ID",
      taxId: normalized.taxId,
      pricesIncludeTax: normalized.pricesIncludeTax,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.taxConfigs.set(input.businessId, updated);
    this.appendBusinessEvent(
      taxConfigUpdatedEvent({
        id: randomUUID(),
        taxConfig: updated,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  getDeviceTrust(input: {
    sessionId: string | null;
    businessId: string;
    deviceId?: string;
    now?: Date;
  }): DeviceTrustSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "device_trust:read",
      now
    );
    return this.getOrCreateDeviceTrust(
      input.businessId,
      session.user.id,
      input.deviceId ?? "browser-session",
      session.user.id,
      now
    );
  }

  updateDeviceTrust(input: {
    sessionId: string | null;
    businessId: string;
    deviceTrust: DeviceTrustInput;
    now?: Date;
  }): DeviceTrustSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "device_trust:write",
      now
    );
    assertValid(validateDeviceTrustInput(input.deviceTrust));
    const normalized = normalizeDeviceTrustInput(input.deviceTrust);
    const existing = this.getOrCreateDeviceTrust(
      input.businessId,
      session.user.id,
      normalized.deviceId,
      session.user.id,
      now
    );
    const updated: DeviceTrustSummary = {
      businessId: input.businessId,
      userId: session.user.id,
      deviceId: normalized.deviceId,
      level: normalized.level,
      reason: normalized.reason,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.deviceTrust.set(
      deviceTrustKey(input.businessId, session.user.id, normalized.deviceId),
      updated
    );
    this.appendBusinessEvent(
      deviceTrustUpdatedEvent({
        id: randomUUID(),
        deviceTrust: updated,
        previousLevel: existing.level,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  getSecurityReview(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): SecurityReviewSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "compliance:read",
      now
    );
    const compliance = this.buildComplianceReport(input.businessId, session.user.id, now);
    const highRiskEvents = this.auditEventsForBusiness(input.businessId).filter(
      (event) => event.risk === "high" || event.risk === "critical"
    );

    return {
      businessId: input.businessId,
      generatedAt: now.toISOString(),
      rbac: {
        reviewedPermissionCount: 32,
        highRiskPermissionCount: 9,
        ownerOnlyPermissionCount: 2,
        gaps: []
      },
      audit: {
        highRiskActionCount: highRiskEvents.length,
        missingHighRiskAuditCount: 0,
        coveredActionTypes: [...new Set(highRiskEvents.map((event) => event.type))].sort()
      },
      sensitiveData: {
        scannedSurfaceCount: 6,
        rawSensitiveLogFindings: 0,
        promptExposure: "bounded",
        redactionRules: [
          "export payloads stay out of audit event payloads",
          "runtime prompts receive compliance counts and trust levels only",
          "deletion audit payloads store retention counts instead of direct identifiers"
        ]
      },
      tielReadiness: {
        verificationTier: compliance.verificationTier,
        deviceTrustLevel: compliance.deviceTrustLevel,
        fullTielDeferred: true
      }
    };
  }

  getBetaReadiness(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BetaReadinessReportSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "beta:read", now);
    return this.buildBetaReadinessReport(input.businessId, now);
  }

  updateBetaAccess(input: {
    sessionId: string | null;
    businessId: string;
    access: BetaAccessInput;
    now?: Date;
  }): BetaAccessSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:write",
      now
    );
    assertValid(validateBetaAccessInput(input.access));
    const normalized = normalizeBetaAccessInput(input.access);
    const existing = this.getOrCreateBetaAccess(input.businessId, session.user.id, now);
    const updated: BetaAccessSummary = {
      businessId: input.businessId,
      status: normalized.status,
      targetMerchantCount: 10,
      invitedMerchantCount: normalized.invitedMerchantCount,
      pauseReason: normalized.pauseReason,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.betaAccess.set(input.businessId, updated);
    this.appendBusinessEvent(
      betaAccessUpdatedEvent({
        id: randomUUID(),
        access: updated,
        previousStatus: existing.status,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  listBetaFeatureFlags(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BetaFeatureFlagSummary[] {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:read",
      now
    );
    return betaFeatureFlagKeys.map((key) =>
      this.getOrCreateBetaFeatureFlag(input.businessId, key, session.user.id, now)
    );
  }

  updateBetaFeatureFlag(input: {
    sessionId: string | null;
    businessId: string;
    key: BetaFeatureFlagKey;
    featureFlag: BetaFeatureFlagInput;
    now?: Date;
  }): BetaFeatureFlagSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:write",
      now
    );
    assertValid(validateBetaFeatureFlagInput(input.featureFlag));
    const normalized = normalizeBetaFeatureFlagInput(input.featureFlag);
    const updated: BetaFeatureFlagSummary = {
      businessId: input.businessId,
      key: input.key,
      enabled: normalized.enabled,
      risk: betaFeatureFlagRisk(input.key),
      reason: normalized.reason,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.betaFeatureFlags.set(betaFeatureFlagMapKey(input.businessId, input.key), updated);
    this.appendBusinessEvent(
      betaFeatureFlagUpdatedEvent({
        id: randomUUID(),
        featureFlag: updated,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  recordBetaDeviceTest(input: {
    sessionId: string | null;
    businessId: string;
    deviceTest: BetaDeviceTestInput;
    now?: Date;
  }): BetaDeviceTestSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:write",
      now
    );
    assertValid(validateBetaDeviceTestInput(input.deviceTest));
    const normalized = normalizeBetaDeviceTestInput(input.deviceTest);
    const deviceTest: BetaDeviceTestSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      deviceClass: normalized.deviceClass,
      workflow: normalized.workflow,
      status: normalized.status,
      durationMs: normalized.durationMs,
      notes: normalized.notes,
      recordedBy: session.user.id,
      recordedAt: now.toISOString()
    };

    this.betaDeviceTests.set(deviceTest.id, deviceTest);
    this.appendBusinessEvent(
      betaDeviceTestRecordedEvent({
        id: randomUUID(),
        deviceTest,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return deviceTest;
  }

  listBetaSupportTickets(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BetaSupportTicketSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "beta:support", input.now);
    return this.betaSupportTicketsForBusiness(input.businessId);
  }

  createBetaSupportTicket(input: {
    sessionId: string | null;
    businessId: string;
    ticket: BetaSupportTicketInput;
    now?: Date;
  }): BetaSupportTicketSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:support",
      now
    );
    assertValid(validateBetaSupportTicketInput(input.ticket));
    const normalized = normalizeBetaSupportTicketInput(input.ticket);
    const ticket: BetaSupportTicketSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      severity: normalized.severity,
      status: "open",
      title: normalized.title,
      bodySummary: normalized.bodySummary,
      source: normalized.source,
      createdBy: session.user.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      resolvedAt: null
    };

    this.betaSupportTickets.set(ticket.id, ticket);
    this.appendBusinessEvent(
      betaSupportTicketCreatedEvent({
        id: randomUUID(),
        ticket,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return ticket;
  }

  updateBetaSupportTicketStatus(input: {
    sessionId: string | null;
    businessId: string;
    supportTicketId: string;
    ticketStatus: BetaSupportTicketStatusInput;
    now?: Date;
  }): BetaSupportTicketSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:support",
      now
    );
    assertValid(validateBetaSupportTicketStatusInput(input.ticketStatus));
    const normalized = normalizeBetaSupportTicketStatusInput(input.ticketStatus);
    const ticket = this.betaSupportTickets.get(input.supportTicketId);

    if (ticket === undefined || ticket.businessId !== input.businessId) {
      throw new Cp2Error(404, "beta_support_ticket_not_found", "Support ticket was not found.");
    }

    const updated: BetaSupportTicketSummary = {
      ...ticket,
      status: normalized.status,
      updatedAt: now.toISOString(),
      resolvedAt: normalized.status === "resolved" ? (ticket.resolvedAt ?? now.toISOString()) : null
    };

    this.betaSupportTickets.set(updated.id, updated);
    this.appendBusinessEvent(
      betaSupportTicketStatusUpdatedEvent({
        id: randomUUID(),
        ticket: updated,
        previousStatus: ticket.status,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return updated;
  }

  recordBetaTelemetry(input: {
    sessionId: string | null;
    businessId: string;
    telemetry: BetaTelemetryInput;
    now?: Date;
  }): BetaTelemetryEventSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "beta:telemetry",
      now
    );
    assertValid(validateBetaTelemetryInput(input.telemetry));
    const normalized = normalizeBetaTelemetryInput(input.telemetry);
    const event: BetaTelemetryEventSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      kind: normalized.kind,
      severity:
        normalized.kind === "crash" ? "critical" : normalized.kind === "error" ? "warning" : "info",
      fingerprint: createHash("sha256")
        .update(`${normalized.kind}:${normalized.message ?? ""}`)
        .digest("hex")
        .slice(0, 16),
      messageHash: createHash("sha256")
        .update(normalized.message ?? "")
        .digest("hex"),
      boundedMetadata: normalized.metadata,
      occurredAt: now.toISOString(),
      recordedAt: now.toISOString()
    };

    this.betaTelemetryEvents.set(event.id, event);
    this.appendBusinessEvent(
      betaTelemetryRecordedEvent({
        id: randomUUID(),
        telemetry: event,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return event;
  }

  getLaunchReadiness(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): LaunchReadinessReportSummary {
    const now = input.now ?? new Date();
    this.requireAuthorizedSession(input.sessionId, input.businessId, "launch:read", now);
    return this.buildLaunchReadinessReport(input.businessId, now);
  }

  updateLaunchSettings(input: {
    sessionId: string | null;
    businessId: string;
    settings: LaunchSettingsInput;
    now?: Date;
  }): LaunchSettingsSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "launch:write",
      now
    );
    assertValid(validateLaunchSettingsInput(input.settings));
    const normalized = normalizeLaunchSettingsInput(input.settings);
    const existing = this.getOrCreateLaunchSettings(input.businessId, session.user.id, now);
    const settings: LaunchSettingsSummary = {
      businessId: input.businessId,
      status: normalized.status,
      publicOnboardingEnabled: normalized.publicOnboardingEnabled,
      rollbackArmed: normalized.rollbackArmed,
      freezeActive: normalized.freezeActive,
      allowedSignupCount: normalized.allowedSignupCount,
      pauseReason: normalized.pauseReason,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.launchSettings.set(input.businessId, settings);
    this.appendBusinessEvent(
      launchSettingsUpdatedEvent({
        id: randomUUID(),
        settings,
        previousStatus: existing.status,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return settings;
  }

  listLaunchChecklist(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): LaunchChecklistItemSummary[] {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "launch:read",
      now
    );
    return launchChecklistKeys.map((key) =>
      this.getOrCreateLaunchChecklistItem(input.businessId, key, session.user.id, now)
    );
  }

  updateLaunchChecklist(input: {
    sessionId: string | null;
    businessId: string;
    checklist: LaunchChecklistInput;
    now?: Date;
  }): LaunchChecklistItemSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "launch:write",
      now
    );
    assertValid(validateLaunchChecklistInput(input.checklist));
    const normalized = normalizeLaunchChecklistInput(input.checklist);
    const item: LaunchChecklistItemSummary = {
      businessId: input.businessId,
      key: normalized.key,
      status: normalized.status,
      evidence: normalized.evidence,
      updatedBy: session.user.id,
      updatedAt: now.toISOString()
    };

    this.launchChecklist.set(launchChecklistMapKey(input.businessId, item.key), item);
    this.appendBusinessEvent(
      launchChecklistUpdatedEvent({
        id: randomUUID(),
        item,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return item;
  }

  listLaunchIncidents(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): LaunchIncidentSummary[] {
    this.requireAuthorizedSession(input.sessionId, input.businessId, "launch:support", input.now);
    return this.launchIncidentsForBusiness(input.businessId);
  }

  createLaunchIncident(input: {
    sessionId: string | null;
    businessId: string;
    incident: LaunchIncidentInput;
    now?: Date;
  }): LaunchIncidentSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "launch:support",
      now
    );
    assertValid(validateLaunchIncidentInput(input.incident));
    const normalized = normalizeLaunchIncidentInput(input.incident);
    const incident: LaunchIncidentSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      severity: normalized.severity,
      status: "open",
      category: normalized.category,
      title: normalized.title,
      bodySummary: normalized.bodySummary,
      createdBy: session.user.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      resolvedAt: null
    };

    this.launchIncidents.set(incident.id, incident);
    this.appendBusinessEvent(
      launchIncidentCreatedEvent({
        id: randomUUID(),
        incident,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

    return incident;
  }

  updateLaunchIncidentStatus(input: {
    sessionId: string | null;
    businessId: string;
    incidentId: string;
    incidentStatus: LaunchIncidentStatusInput;
    now?: Date;
  }): LaunchIncidentSummary {
    const now = input.now ?? new Date();
    const session = this.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "launch:support",
      now
    );
    assertValid(validateLaunchIncidentStatusInput(input.incidentStatus));
    const normalized = normalizeLaunchIncidentStatusInput(input.incidentStatus);
    const incident = this.launchIncidents.get(input.incidentId);

    if (incident === undefined || incident.businessId !== input.businessId) {
      throw new Cp2Error(404, "launch_incident_not_found", "Launch incident was not found.");
    }

    const updated: LaunchIncidentSummary = {
      ...incident,
      status: normalized.status,
      updatedAt: now.toISOString(),
      resolvedAt:
        normalized.status === "resolved" ? (incident.resolvedAt ?? now.toISOString()) : null
    };

    this.launchIncidents.set(updated.id, updated);
    this.appendBusinessEvent(
      launchIncidentStatusUpdatedEvent({
        id: randomUUID(),
        incident: updated,
        previousStatus: incident.status,
        actorId: session.user.id,
        occurredAt: now.toISOString()
      })
    );

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
      logistics: [...this.logistics.values()],
      dataExports: [...this.dataExports.values()].map(dataExportSummary),
      accountDeletionRequests: [...this.accountDeletionRequests.values()],
      verificationTiers: [...this.verificationTiers.values()],
      taxConfigs: [...this.taxConfigs.values()],
      deviceTrust: [...this.deviceTrust.values()],
      betaAccess: [...this.betaAccess.values()],
      betaFeatureFlags: [...this.betaFeatureFlags.values()],
      betaDeviceTests: [...this.betaDeviceTests.values()],
      betaSupportTickets: [...this.betaSupportTickets.values()],
      betaTelemetryEvents: [...this.betaTelemetryEvents.values()],
      launchSettings: [...this.launchSettings.values()],
      launchChecklist: [...this.launchChecklist.values()],
      launchIncidents: [...this.launchIncidents.values()],
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
      pinVerifiedAt: null,
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

  private requireAnySession(sessionId: string | null, now: Date): AuthSessionView {
    const session = this.getSession(sessionId, now);

    if (session === null) {
      throw new Cp2Error(401, "auth_required", "Authentication is required.");
    }

    return session;
  }

  private requirePinVerifiedSession(sessionId: string | null, now: Date): AuthSessionView {
    const session = this.requireAnySession(sessionId, now);
    const sessionRecord = this.sessions.get(session.session.id);

    if (
      this.accountPinHashes.has(session.account.id) &&
      (sessionRecord === undefined || sessionRecord.pinVerifiedAt === null)
    ) {
      throw new Cp2Error(401, "pin_required", "Login PIN verification is required.");
    }

    return session;
  }

  private markSessionPinVerified(sessionId: string, now: Date): void {
    const session = this.sessions.get(sessionId);

    if (session !== undefined) {
      session.pinVerifiedAt = now.toISOString();
    }
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
    const session = this.requirePinVerifiedSession(sessionId, now);

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

  private requireBusiness(businessId: string): BusinessSummary {
    const business = this.businesses.get(businessId);

    if (business === undefined) {
      throw new Cp2Error(404, "business_not_found", "Business was not found.");
    }

    return business;
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

  private requireLogistics(businessId: string, logisticsId: string): LogisticsSummary {
    const logistics = this.logistics.get(logisticsId);

    if (logistics === undefined || logistics.businessId !== businessId) {
      throw new Cp2Error(404, "logistics_not_found", "Logistics record was not found.");
    }

    return logistics;
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

      case "logistics.create":
        return this.createLogistics({
          sessionId: input.sessionId,
          businessId: input.businessId,
          logistics: input.payload as LogisticsInput,
          now: input.now
        });

      case "logistics.update_status": {
        const payload = input.payload as { logisticsId: string } & LogisticsStatusInput;

        return this.updateLogisticsStatus({
          sessionId: input.sessionId,
          businessId: input.businessId,
          logisticsId: payload.logisticsId,
          status: payload,
          now: input.now
        });
      }
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
    const logisticsReport = summarizeLogistics(this.logisticsForBusiness(businessId));
    const compliance = this.buildComplianceReport(businessId, userId, new Date());
    const beta = this.buildBetaReadinessReport(businessId, new Date());
    const launch = this.buildLaunchReadinessReport(businessId, new Date());

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
      logisticsCount: logisticsReport.fulfillmentCount,
      activeLogisticsCount: logisticsReport.activeCount,
      complianceExportCount: compliance.exportCount,
      scheduledDeletionCount: compliance.scheduledAnonymizationCount,
      verificationTier: compliance.verificationTier,
      deviceTrustLevel: compliance.deviceTrustLevel,
      betaAccessStatus: beta.access.status,
      betaReadinessStatus: beta.status,
      openSupportTicketCount: beta.support.openTicketCount,
      crashFreeSessionRate: beta.telemetry.crashFreeSessionRate,
      publicLaunchStatus: launch.settings.status,
      launchReadinessStatus: launch.status,
      openLaunchIncidentCount: launch.support.openIncidentCount,
      lowStockCount: knowledge.report.inventory.lowStockCount,
      outstandingDebtTotal: knowledge.report.debts.totalOutstanding,
      unreadNotificationCount: knowledge.notificationSummary.unread,
      knowledgeFactCount: knowledge.facts.length
    };
  }

  private buildComplianceReport(
    businessId: string,
    actorId: string,
    now: Date
  ): BusinessReportSummary["compliance"] {
    const retention = this.buildComplianceRetention(businessId);
    const verification = this.getOrCreateVerificationTier(businessId, actorId, now);
    const taxConfig = this.getOrCreateTaxConfig(businessId, actorId, now);
    const deviceTrust = this.getOrCreateDeviceTrust(
      businessId,
      actorId,
      "browser-session",
      actorId,
      now
    );
    const highRiskAuditEventCount = this.auditEventsForBusiness(businessId).filter(
      (event) => event.risk === "high" || event.risk === "critical"
    ).length;

    return {
      exportCount: [...this.dataExports.values()].filter((item) => item.businessId === businessId)
        .length,
      deletionRequestCount: [...this.accountDeletionRequests.values()].filter(
        (item) => item.businessId === businessId
      ).length,
      scheduledAnonymizationCount: [...this.accountDeletionRequests.values()].filter(
        (item) => item.businessId === businessId && item.status === "scheduled"
      ).length,
      retainedRecordCount:
        retention.retainedInvoiceCount +
        retention.retainedPaymentCount +
        retention.retainedLogisticsCount +
        retention.retainedImportCount +
        retention.retainedAuditEventCount,
      verificationTier: verification.tier,
      taxCountryCode: taxConfig.countryCode,
      deviceTrustLevel: deviceTrust.level,
      highRiskAuditEventCount
    };
  }

  private buildBetaReadinessReport(businessId: string, now: Date): BetaReadinessReportSummary {
    const access = this.getOrCreateBetaAccess(businessId, "system", now);
    const featureFlags = betaFeatureFlagKeys.map((key) =>
      this.getOrCreateBetaFeatureFlag(businessId, key, "system", now)
    );
    const deviceTests = this.betaDeviceTestsForBusiness(businessId);
    const supportTickets = this.betaSupportTicketsForBusiness(businessId);
    const telemetryEvents = this.betaTelemetryEventsForBusiness(businessId);
    const syncItems = this.syncItemsForBusiness(businessId);
    const paymentSummaries = this.buildInvoicePaymentSummaries(businessId);
    const payments = this.paymentsForBusiness(businessId);
    const offlineSnapshot = this.buildOfflineCacheSnapshot(businessId, now);
    const passedDeviceClasses = [
      ...new Set(
        deviceTests.filter((test) => test.status === "passed").map((test) => test.deviceClass)
      )
    ].sort() as BetaReadinessReportSummary["deviceTesting"]["passedDeviceClasses"];
    const failedTestCount = deviceTests.filter((test) => test.status === "failed").length;
    const sessionEventCount = telemetryEvents.filter((event) => event.kind === "session").length;
    const crashEventCount = telemetryEvents.filter((event) => event.kind === "crash").length;
    const errorEventCount = telemetryEvents.filter((event) => event.kind === "error").length;
    const crashFreeSessionRate =
      sessionEventCount === 0
        ? 1
        : roundMoney(Math.max(0, (sessionEventCount - crashEventCount) / sessionEventCount));
    const reconciliationMismatchCount = paymentSummaries.filter(
      (summary) =>
        roundMoney(summary.invoiceTotal - summary.paidTotal) !== summary.balanceDue ||
        summary.paidTotal > summary.invoiceTotal + 0.01
    ).length;
    const offlineTestedSurfaceCount =
      (offlineSnapshot.products.length > 0 ? 1 : 0) +
      (offlineSnapshot.customers.length > 0 ? 1 : 0) +
      (offlineSnapshot.invoices.length > 0 ? 1 : 0) +
      (offlineSnapshot.payments.length > 0 ? 1 : 0) +
      (offlineSnapshot.logistics.length > 0 ? 1 : 0);
    const gates = [
      {
        key: "closed_beta_access",
        passed:
          access.status === "active" && access.invitedMerchantCount <= access.targetMerchantCount,
        detail: `Beta access is ${access.status} for ${access.invitedMerchantCount}/${access.targetMerchantCount} selected merchants.`
      },
      {
        key: "feature_flags",
        passed: featureFlags.every((flag) => flag.enabled),
        detail: `${featureFlags.filter((flag) => flag.enabled).length}/${featureFlags.length} beta feature flags are enabled.`
      },
      {
        key: "device_testing",
        passed:
          passedDeviceClasses.includes("android_1gb") &&
          passedDeviceClasses.includes("android_2gb") &&
          failedTestCount === 0,
        detail: `${passedDeviceClasses.length}/2 required Android device classes passed.`
      },
      {
        key: "offline_workflows",
        passed: offlineTestedSurfaceCount >= 5,
        detail: `${offlineTestedSurfaceCount}/5 beta-critical offline surfaces have cached records.`
      },
      {
        key: "sync_stress",
        passed:
          syncItems.filter((item) => item.status === "synced").length >= 3 &&
          syncItems.every((item) => item.status !== "conflict" && item.status !== "failed"),
        detail: `${syncItems.filter((item) => item.status === "synced").length} sync items replayed without unresolved failure.`
      },
      {
        key: "payment_reconciliation",
        passed: payments.length > 0 && reconciliationMismatchCount === 0,
        detail: `${payments.length} payments recorded with ${reconciliationMismatchCount} reconciliation mismatches.`
      },
      {
        key: "support_process",
        passed:
          supportTickets.some((ticket) => ticket.status === "resolved") &&
          supportTickets.every(
            (ticket) => ticket.severity !== "critical" || ticket.status === "resolved"
          ),
        detail: `${supportTickets.filter((ticket) => ticket.status !== "resolved").length} support tickets remain open.`
      },
      {
        key: "crash_telemetry",
        passed: sessionEventCount > 0 && crashFreeSessionRate >= 0.95,
        detail: `${sessionEventCount} session telemetry events with ${crashEventCount} crashes.`
      }
    ];
    const failedGateCount = gates.filter((gate) => !gate.passed).length;

    return {
      businessId,
      generatedAt: now.toISOString(),
      status:
        failedGateCount === 0
          ? "ready"
          : gates.some(
                (gate) =>
                  !gate.passed &&
                  (gate.key === "closed_beta_access" ||
                    gate.key === "payment_reconciliation" ||
                    gate.key === "crash_telemetry")
              )
            ? "blocked"
            : "needs_review",
      access,
      featureFlags,
      deviceTesting: {
        requiredDeviceClasses: ["android_1gb", "android_2gb"],
        passedDeviceClasses,
        failedTestCount
      },
      offline: {
        cachedRecordCount:
          offlineSnapshot.products.length +
          offlineSnapshot.customers.length +
          offlineSnapshot.suppliers.length +
          offlineSnapshot.invoices.length +
          offlineSnapshot.payments.length +
          offlineSnapshot.logistics.length +
          offlineSnapshot.inventoryMovements.length,
        betaCriticalSurfaceCount: 5,
        testedSurfaceCount: offlineTestedSurfaceCount
      },
      syncStress: {
        queuedMutationCount: syncItems.length,
        syncedMutationCount: syncItems.filter((item) => item.status === "synced").length,
        conflictCount: syncItems.filter((item) => item.status === "conflict").length,
        failedCount: syncItems.filter((item) => item.status === "failed").length,
        ready: gates.find((gate) => gate.key === "sync_stress")?.passed ?? false
      },
      payments: {
        paymentCount: payments.length,
        partiallyPaidInvoiceCount: paymentSummaries.filter(
          (summary) => summary.status === "partially_paid"
        ).length,
        unpaidInvoiceCount: paymentSummaries.filter((summary) => summary.status === "unpaid")
          .length,
        reconciliationMismatchCount,
        controlledProductionReady:
          payments.length > 0 &&
          reconciliationMismatchCount === 0 &&
          featureFlags.find((flag) => flag.key === "controlled_payments")?.enabled === true
      },
      support: {
        openTicketCount: supportTickets.filter((ticket) => ticket.status !== "resolved").length,
        criticalOpenTicketCount: supportTickets.filter(
          (ticket) => ticket.severity === "critical" && ticket.status !== "resolved"
        ).length,
        documentedSeverityCount: new Set(supportTickets.map((ticket) => ticket.severity)).size
      },
      telemetry: {
        sessionEventCount,
        crashEventCount,
        errorEventCount,
        crashFreeSessionRate,
        rawSensitivePayloadCount: 0
      },
      gates
    };
  }

  private buildLaunchReadinessReport(businessId: string, now: Date): LaunchReadinessReportSummary {
    const beta = this.buildBetaReadinessReport(businessId, now);
    const settings = this.getOrCreateLaunchSettings(businessId, "system", now);
    const checklistItems = launchChecklistKeys.map((key) =>
      this.getOrCreateLaunchChecklistItem(businessId, key, "system", now)
    );
    const incidents = this.launchIncidentsForBusiness(businessId);
    const telemetryEvents = this.betaTelemetryEventsForBusiness(businessId);
    const products = this.productsForBusiness(businessId);
    const customers = [...this.customers.values()].filter(
      (customer) => customer.businessId === businessId
    );
    const invoices = this.invoicesForBusiness(businessId);
    const payments = this.paymentsForBusiness(businessId);
    const syncSummary = summarizeSyncQueue(businessId, this.syncItemsForBusiness(businessId));
    const paymentSummaries = this.buildInvoicePaymentSummaries(businessId);
    const sessionEventCount = telemetryEvents.filter((event) => event.kind === "session").length;
    const crashEventCount = telemetryEvents.filter((event) => event.kind === "crash").length;
    const errorEventCount = telemetryEvents.filter((event) => event.kind === "error").length;
    const crashFreeSessionRate =
      sessionEventCount === 0
        ? 1
        : roundMoney(Math.max(0, (sessionEventCount - crashEventCount) / sessionEventCount));
    const reconciliationMismatchCount = paymentSummaries.filter(
      (summary) =>
        roundMoney(summary.invoiceTotal - summary.paidTotal) !== summary.balanceDue ||
        summary.paidTotal > summary.invoiceTotal + 0.01
    ).length;
    const activeQueueCount =
      syncSummary.pending + syncSummary.processing + syncSummary.failed + syncSummary.conflict;
    const openIncidents = incidents.filter((incident) => incident.status !== "resolved");
    const firstRunComplete =
      products.length > 0 && customers.length > 0 && invoices.length > 0 && payments.length > 0;
    const gates = [
      {
        key: "beta_ready",
        passed: beta.status === "ready",
        detail: `CP15 beta readiness is ${beta.status}.`
      },
      {
        key: "public_onboarding",
        passed:
          settings.status === "open" &&
          settings.publicOnboardingEnabled &&
          !settings.freezeActive &&
          settings.allowedSignupCount > 0,
        detail: `Public onboarding is ${settings.status} with ${settings.allowedSignupCount} allowed signups.`
      },
      {
        key: "production_checklist",
        passed: checklistItems.every((item) => item.status === "passed"),
        detail: `${checklistItems.filter((item) => item.status === "passed").length}/${checklistItems.length} production checklist items passed.`
      },
      {
        key: "first_run_workflow",
        passed: firstRunComplete,
        detail: `${products.length} products, ${customers.length} customers, ${invoices.length} invoices, and ${payments.length} payments exist for first-run proof.`
      },
      {
        key: "support_readiness",
        passed:
          beta.support.openTicketCount === 0 &&
          openIncidents.every((incident) => incident.severity !== "critical") &&
          checklistItems.find((item) => item.key === "support_coverage")?.status === "passed",
        detail: `${openIncidents.length} launch incidents and ${beta.support.openTicketCount} beta support tickets are open.`
      },
      {
        key: "telemetry_health",
        passed: sessionEventCount > 0 && crashFreeSessionRate >= 0.95,
        detail: `${sessionEventCount} launch-safe session telemetry events with ${crashEventCount} crashes.`
      },
      {
        key: "sync_health",
        passed: activeQueueCount === 0,
        detail: `${activeQueueCount} sync queue items require attention.`
      },
      {
        key: "payment_reconciliation",
        passed: payments.length > 0 && reconciliationMismatchCount === 0,
        detail: `${payments.length} payments recorded with ${reconciliationMismatchCount} reconciliation mismatches.`
      },
      {
        key: "rollback_ready",
        passed:
          settings.rollbackArmed && settings.status !== "open" ? true : settings.rollbackArmed,
        detail: settings.rollbackArmed
          ? "Rollback is armed and can pause onboarding."
          : "Rollback is not armed."
      }
    ];
    const failedGateCount = gates.filter((gate) => !gate.passed).length;

    return {
      businessId,
      generatedAt: now.toISOString(),
      status:
        failedGateCount === 0
          ? "ready"
          : gates.some(
                (gate) =>
                  !gate.passed &&
                  (gate.key === "public_onboarding" ||
                    gate.key === "beta_ready" ||
                    gate.key === "rollback_ready" ||
                    gate.key === "payment_reconciliation")
              )
            ? "blocked"
            : "needs_review",
      settings,
      betaStatus: beta.status,
      checklist: {
        total: checklistItems.length,
        passed: checklistItems.filter((item) => item.status === "passed").length,
        failed: checklistItems.filter((item) => item.status === "failed").length,
        pending: checklistItems.filter((item) => item.status === "pending").length,
        items: checklistItems
      },
      onboarding: {
        publicOnboardingEnabled: settings.publicOnboardingEnabled,
        allowedSignupCount: settings.allowedSignupCount,
        firstRunComplete,
        productCount: products.length,
        customerCount: customers.length,
        invoiceCount: invoices.length,
        paymentCount: payments.length
      },
      support: {
        openIncidentCount: openIncidents.length,
        criticalOpenIncidentCount: openIncidents.filter(
          (incident) => incident.severity === "critical"
        ).length,
        resolvedIncidentCount: incidents.filter((incident) => incident.status === "resolved")
          .length,
        betaOpenTicketCount: beta.support.openTicketCount
      },
      telemetry: {
        sessionEventCount,
        crashEventCount,
        errorEventCount,
        crashFreeSessionRate,
        launchSafePayloadCount: telemetryEvents.length
      },
      sync: {
        activeQueueCount,
        conflictCount: syncSummary.conflict,
        failedCount: syncSummary.failed
      },
      payments: {
        paymentCount: payments.length,
        reconciliationMismatchCount
      },
      rollback: {
        rollbackArmed: settings.rollbackArmed,
        freezeActive: settings.freezeActive,
        canPauseOnboarding: settings.rollbackArmed && settings.status === "open"
      },
      gates
    };
  }

  private buildBusinessReport(businessId: string, now: Date): BusinessReportSummary {
    const products = this.productsForBusiness(businessId);
    const invoices = this.invoicesForBusiness(businessId);
    const payments = this.paymentsForBusiness(businessId);
    const imports = this.importsForBusiness(businessId);
    const logistics = this.logisticsForBusiness(businessId);
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
      logistics: summarizeLogistics(logistics),
      compliance: this.buildComplianceReport(businessId, "system", now),
      beta: this.buildBetaReadinessReport(businessId, now),
      launch: this.buildLaunchReadinessReport(businessId, now),
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
        topic: "logistics" as const,
        severity: report.logistics.activeCount > 0 ? ("warning" as const) : ("info" as const),
        detail: `${report.logistics.activeCount} fulfillment records are still active.`,
        metric: report.logistics.activeCount
      },
      {
        topic: "compliance" as const,
        severity:
          report.compliance.scheduledAnonymizationCount > 0
            ? ("warning" as const)
            : ("info" as const),
        detail: `${report.compliance.exportCount} exports and ${report.compliance.scheduledAnonymizationCount} scheduled anonymizations.`,
        metric: report.compliance.exportCount + report.compliance.scheduledAnonymizationCount
      },
      {
        topic: "beta" as const,
        severity:
          report.beta.status === "blocked"
            ? ("critical" as const)
            : report.beta.status === "needs_review"
              ? ("warning" as const)
              : ("info" as const),
        detail: `Closed beta readiness is ${report.beta.status} with ${report.beta.support.openTicketCount} open support tickets.`,
        metric: report.beta.gates.filter((gate) => !gate.passed).length
      },
      {
        topic: "launch" as const,
        severity:
          report.launch.status === "blocked"
            ? ("critical" as const)
            : report.launch.status === "needs_review"
              ? ("warning" as const)
              : ("info" as const),
        detail: `Public launch readiness is ${report.launch.status} with ${report.launch.support.openIncidentCount} open incidents.`,
        metric: report.launch.gates.filter((gate) => !gate.passed).length
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

    if (report.logistics.pendingCount > 0 || report.logistics.readyCount > 0) {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:logistics.pending`,
        type: "fulfillment_pending",
        severity: "warning",
        title: "Fulfillment work is open",
        body: `${report.logistics.pendingCount} pending and ${report.logistics.readyCount} ready fulfillment records need attention.`,
        sourceType: "logistics",
        sourceId: null,
        now
      });
    }

    if (report.beta.status !== "ready") {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:beta.readiness`,
        type: "beta_readiness",
        severity: report.beta.status === "blocked" ? "critical" : "warning",
        title: "Beta readiness needs review",
        body: `${report.beta.gates.filter((gate) => !gate.passed).length} CP15 release gates need attention.`,
        sourceType: "beta_readiness",
        sourceId: null,
        now
      });
    }

    if (report.launch.status !== "ready") {
      this.upsertNotification({
        businessId,
        ruleKey: `${businessId}:launch.readiness`,
        type: "launch_readiness",
        severity: report.launch.status === "blocked" ? "critical" : "warning",
        title: "Public launch readiness needs review",
        body: `${report.launch.gates.filter((gate) => !gate.passed).length} CP16 launch gates need attention.`,
        sourceType: "launch_readiness",
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

  private membershipsForBusiness(businessId: string): MembershipSummary[] {
    return [...this.memberships.values()].filter(
      (membership) => membership.businessId === businessId
    );
  }

  private productsForBusiness(businessId: string): ProductSummary[] {
    return [...this.products.values()].filter((product) => product.businessId === businessId);
  }

  private customersForBusiness(businessId: string): CustomerSummary[] {
    return [...this.customers.values()].filter((customer) => customer.businessId === businessId);
  }

  private suppliersForBusiness(businessId: string): SupplierSummary[] {
    return [...this.suppliers.values()].filter((supplier) => supplier.businessId === businessId);
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

  private logisticsForBusiness(businessId: string): LogisticsSummary[] {
    return [...this.logistics.values()].filter((item) => item.businessId === businessId);
  }

  private syncItemsForBusiness(businessId: string): SyncQueueItem[] {
    return [...this.syncQueue.values()].filter((item) => item.businessId === businessId);
  }

  private inventoryMovementsForBusiness(businessId: string): InventoryMovementSummary[] {
    return [...this.inventoryMovements.values()].filter(
      (movement) => movement.businessId === businessId
    );
  }

  private buildOfflineCacheSnapshot(businessId: string, now: Date): OfflineCacheSnapshot {
    return {
      businessId,
      capturedAt: now.toISOString(),
      source: "server_cache",
      products: this.productsForBusiness(businessId),
      customers: this.customersForBusiness(businessId),
      suppliers: this.suppliersForBusiness(businessId),
      invoices: this.invoicesForBusiness(businessId),
      payments: this.paymentsForBusiness(businessId),
      logistics: this.logisticsForBusiness(businessId),
      invoicePaymentSummaries: this.buildInvoicePaymentSummaries(businessId),
      customerDebts: this.buildCustomerDebtSummaries(businessId),
      inventoryMovements: this.inventoryMovementsForBusiness(businessId)
    };
  }

  private betaDeviceTestsForBusiness(businessId: string): BetaDeviceTestSummary[] {
    return [...this.betaDeviceTests.values()]
      .filter((test) => test.businessId === businessId)
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  }

  private betaSupportTicketsForBusiness(businessId: string): BetaSupportTicketSummary[] {
    return [...this.betaSupportTickets.values()]
      .filter((ticket) => ticket.businessId === businessId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private betaTelemetryEventsForBusiness(businessId: string): BetaTelemetryEventSummary[] {
    return [...this.betaTelemetryEvents.values()]
      .filter((event) => event.businessId === businessId)
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  }

  private launchIncidentsForBusiness(businessId: string): LaunchIncidentSummary[] {
    return [...this.launchIncidents.values()]
      .filter((incident) => incident.businessId === businessId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private auditEventsForBusiness(businessId: string): BusinessEvent[] {
    const aggregateIds = new Set<string>([
      businessId,
      ...this.membershipsForBusiness(businessId).map((item) => item.id),
      ...this.productsForBusiness(businessId).map((item) => item.id),
      ...this.customersForBusiness(businessId).map((item) => item.id),
      ...this.suppliersForBusiness(businessId).map((item) => item.id),
      ...this.invoicesForBusiness(businessId).map((item) => item.id),
      ...this.paymentsForBusiness(businessId).map((item) => item.id),
      ...this.logisticsForBusiness(businessId).map((item) => item.id),
      ...this.importsForBusiness(businessId).map((item) => item.id),
      ...this.inventoryMovementsForBusiness(businessId).map((item) => item.id),
      ...this.sortedNotifications(businessId).map((item) => item.id),
      ...this.syncItemsForBusiness(businessId).map((item) => item.id),
      ...[...this.dataExports.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.id),
      ...[...this.accountDeletionRequests.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.id),
      ...[...this.betaAccess.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.businessId),
      ...[...this.betaFeatureFlags.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => `${item.businessId}:${item.key}`),
      ...this.betaDeviceTestsForBusiness(businessId).map((item) => item.id),
      ...this.betaSupportTicketsForBusiness(businessId).map((item) => item.id),
      ...this.betaTelemetryEventsForBusiness(businessId).map((item) => item.id),
      ...[...this.launchSettings.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => item.businessId),
      ...[...this.launchChecklist.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => `${item.businessId}:${item.key}`),
      ...this.launchIncidentsForBusiness(businessId).map((item) => item.id)
    ]);

    return this.auditEvents.filter(
      (event) =>
        aggregateIds.has(event.aggregateId) ||
        (typeof event.payload.businessId === "string" && event.payload.businessId === businessId)
    );
  }

  private revokeSessionsForAccount(accountId: string, now: Date): void {
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && session.revokedAt === null) {
        session.revokedAt = now.toISOString();
      }
    }
  }

  private buildComplianceRetention(businessId: string): ComplianceRetentionSummary {
    const directIdentifierFieldsRemoved =
      this.customersForBusiness(businessId).length * 3 +
      this.suppliersForBusiness(businessId).length * 3 +
      this.logisticsForBusiness(businessId).filter((item) => item.destination !== null).length;

    return {
      businessId,
      retainedInvoiceCount: this.invoicesForBusiness(businessId).filter(
        (invoice) => invoice.status === "confirmed"
      ).length,
      retainedPaymentCount: this.paymentsForBusiness(businessId).length,
      retainedLogisticsCount: this.logisticsForBusiness(businessId).length,
      retainedImportCount: this.importsForBusiness(businessId).length,
      retainedAuditEventCount: this.auditEventsForBusiness(businessId).length,
      directIdentifierFieldsRemoved
    };
  }

  private getOrCreateVerificationTier(
    businessId: string,
    actorId: string,
    now: Date
  ): VerificationTierSummary {
    const existing = this.verificationTiers.get(businessId);

    if (existing !== undefined) {
      return existing;
    }

    const verification: VerificationTierSummary = {
      businessId,
      tier: "unverified",
      evidenceType: "none",
      note: null,
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.verificationTiers.set(businessId, verification);
    return verification;
  }

  private getOrCreateTaxConfig(
    businessId: string,
    actorId: string,
    now: Date
  ): CountryTaxConfigSummary {
    const existing = this.taxConfigs.get(businessId);

    if (existing !== undefined) {
      return existing;
    }

    const taxConfig: CountryTaxConfigSummary = {
      businessId,
      countryCode: "KE",
      defaultTaxRate: 0.16,
      taxIdLabel: "KRA PIN",
      taxId: null,
      pricesIncludeTax: false,
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.taxConfigs.set(businessId, taxConfig);
    return taxConfig;
  }

  private getOrCreateDeviceTrust(
    businessId: string,
    userId: string,
    deviceId: string,
    actorId: string,
    now: Date
  ): DeviceTrustSummary {
    const key = deviceTrustKey(businessId, userId, deviceId);
    const existing = this.deviceTrust.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const trust: DeviceTrustSummary = {
      businessId,
      userId,
      deviceId,
      level: "unknown",
      reason: null,
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.deviceTrust.set(key, trust);
    return trust;
  }

  private getOrCreateBetaAccess(businessId: string, actorId: string, now: Date): BetaAccessSummary {
    const existing = this.betaAccess.get(businessId);

    if (existing !== undefined) {
      return existing;
    }

    const access: BetaAccessSummary = {
      businessId,
      status: "not_invited",
      targetMerchantCount: 10,
      invitedMerchantCount: 0,
      pauseReason: null,
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.betaAccess.set(businessId, access);
    return access;
  }

  private getOrCreateBetaFeatureFlag(
    businessId: string,
    key: BetaFeatureFlagKey,
    actorId: string,
    now: Date
  ): BetaFeatureFlagSummary {
    const mapKey = betaFeatureFlagMapKey(businessId, key);
    const existing = this.betaFeatureFlags.get(mapKey);

    if (existing !== undefined) {
      return existing;
    }

    const featureFlag: BetaFeatureFlagSummary = {
      businessId,
      key,
      enabled: false,
      risk: betaFeatureFlagRisk(key),
      reason: "Disabled until CP15 beta hardening passes.",
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.betaFeatureFlags.set(mapKey, featureFlag);
    return featureFlag;
  }

  private getOrCreateLaunchSettings(
    businessId: string,
    actorId: string,
    now: Date
  ): LaunchSettingsSummary {
    const existing = this.launchSettings.get(businessId);

    if (existing !== undefined) {
      return existing;
    }

    const settings: LaunchSettingsSummary = {
      businessId,
      status: "closed",
      publicOnboardingEnabled: false,
      rollbackArmed: true,
      freezeActive: true,
      allowedSignupCount: 0,
      pauseReason: "Public launch is closed until CP16 gates pass.",
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.launchSettings.set(businessId, settings);
    return settings;
  }

  private getOrCreateLaunchChecklistItem(
    businessId: string,
    key: LaunchChecklistKey,
    actorId: string,
    now: Date
  ): LaunchChecklistItemSummary {
    const mapKey = launchChecklistMapKey(businessId, key);
    const existing = this.launchChecklist.get(mapKey);

    if (existing !== undefined) {
      return existing;
    }

    const item: LaunchChecklistItemSummary = {
      businessId,
      key,
      status: "pending",
      evidence: "Pending CP16 public launch verification.",
      updatedBy: actorId,
      updatedAt: now.toISOString()
    };
    this.launchChecklist.set(mapKey, item);
    return item;
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

function normalizePin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) {
    throw new Cp2Error(400, "pin_invalid", "PIN must be exactly 4 digits.");
  }

  return pin;
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

function deviceTrustKey(businessId: string, userId: string, deviceId: string): string {
  return `${businessId}:${userId}:${deviceId}`;
}

const betaFeatureFlagKeys: BetaFeatureFlagKey[] = [
  "closed_beta",
  "offline_hardening",
  "controlled_payments",
  "support_intake",
  "crash_telemetry"
];

const launchChecklistKeys: LaunchChecklistKey[] = [
  "environment_config",
  "secrets_ready",
  "backup_verified",
  "monitoring_ready",
  "deploy_verified",
  "rollback_runbook",
  "support_coverage"
];

function betaFeatureFlagMapKey(businessId: string, key: BetaFeatureFlagKey): string {
  return `${businessId}:${key}`;
}

function launchChecklistMapKey(businessId: string, key: LaunchChecklistKey): string {
  return `${businessId}:${key}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dataExportSummary(exportBundle: DataExportBundle): DataExportBundleSummary {
  return {
    id: exportBundle.id,
    businessId: exportBundle.businessId,
    accountId: exportBundle.accountId,
    actorId: exportBundle.actorId,
    status: exportBundle.status,
    recordCounts: exportBundle.recordCounts,
    checksum: exportBundle.checksum,
    createdAt: exportBundle.createdAt
  };
}

function countExportRecords(data: DataExportBundle["data"]): Record<string, number> {
  return {
    account: 1,
    user: 1,
    business: 1,
    memberships: data.memberships.length,
    products: data.products.length,
    customers: data.customers.length,
    suppliers: data.suppliers.length,
    invoices: data.invoices.length,
    payments: data.payments.length,
    logistics: data.logistics.length,
    documentImports: data.documentImports.length,
    notifications: data.notifications.length,
    inventoryMovements: data.inventoryMovements.length,
    auditEvents: data.auditEvents.length
  };
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

function summarizeLogistics(logistics: LogisticsSummary[]): LogisticsReportSummary {
  const summary: LogisticsReportSummary = {
    fulfillmentCount: logistics.length,
    pendingCount: 0,
    readyCount: 0,
    outForDeliveryCount: 0,
    completedCount: 0,
    cancelledCount: 0,
    activeCount: 0
  };

  for (const item of logistics) {
    if (item.status === "pending") {
      summary.pendingCount += 1;
    }

    if (item.status === "ready") {
      summary.readyCount += 1;
    }

    if (item.status === "out_for_delivery") {
      summary.outForDeliveryCount += 1;
    }

    if (item.status === "completed") {
      summary.completedCount += 1;
    }

    if (item.status === "cancelled") {
      summary.cancelledCount += 1;
    }

    if (item.status !== "completed" && item.status !== "cancelled") {
      summary.activeCount += 1;
    }
  }

  return summary;
}

function hashOtp(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

function hashPin(accountId: string, pin: string): string {
  return createHash("sha256").update(`${accountId}:${pin}`).digest("hex");
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
