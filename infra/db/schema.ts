import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const businessEvents = pgTable("business_events", {
  id: uuid("id").primaryKey(),
  aggregateId: text("aggregate_id").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  actorId: text("actor_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  risk: text("risk").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull()
});

export const syncQueue = pgTable("sync_queue", {
  id: uuid("id").primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => businessEvents.id),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey(),
  primaryAuthChannel: text("primary_auth_channel").notNull(),
  primaryAuthDestination: text("primary_auth_destination").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  displayName: text("display_name").notNull(),
  language: text("language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  language: text("language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const businessMemberships = pgTable("business_memberships", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id").primaryKey(),
  channel: text("channel").notNull(),
  destination: text("destination").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});
