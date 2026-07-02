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
