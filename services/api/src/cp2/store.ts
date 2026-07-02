import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { BusinessEvent } from "@soko/event-core";
import type {
  AccountSummary,
  AuthChannel,
  AuthSessionView,
  BusinessRole,
  BusinessSummary,
  MembershipSummary,
  SessionSummary,
  SupportedLanguage,
  UserSummary
} from "@soko/shared-types";
import type { BusinessPermission } from "@soko/business-core";

export const sessionCookieName = "soko_session";

const otpTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxOtpAttempts = 5;
const supportedRoles = ["owner", "manager", "sales_agent", "cashier", "view_only"] as const;

const rolePermissions: Record<BusinessRole, ReadonlySet<BusinessPermission>> = {
  owner: new Set(["business:create", "business:read", "membership:read", "membership:manage"]),
  manager: new Set(["business:read", "membership:read"]),
  sales_agent: new Set(["business:read"]),
  cashier: new Set(["business:read"]),
  view_only: new Set(["business:read"])
};

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

  snapshot(): Cp2Snapshot {
    return {
      accounts: [...this.accounts.values()],
      users: [...this.users.values()],
      businesses: [...this.businesses.values()],
      memberships: [...this.memberships.values()],
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

function isBusinessRole(value: string): value is BusinessRole {
  return supportedRoles.includes(value as BusinessRole);
}

function roleCan(role: BusinessRole, permission: BusinessPermission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
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
