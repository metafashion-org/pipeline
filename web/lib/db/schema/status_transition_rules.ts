import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const statusTransitionRules = pgTable("status_transition_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  role: text("role"), // Allowed role key for manual transition, or null for automatic
  isAllowed: boolean("is_allowed").default(true).notNull(),
  isAutomatic: boolean("is_automatic").default(false).notNull(),
  triggerNote: text("trigger_note"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
