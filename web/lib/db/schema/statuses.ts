import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const statuses = pgTable("statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  description: text("description"),
  whoCanMoveIn: text("who_can_move_in").array().default([]), // Roles allowed to move cards into this status
  nextActionHint: text("next_action_hint"),
  automationNote: text("automation_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
