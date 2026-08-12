import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const marketingStatusConfig = pgTable("marketing_status_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  statusKey: text("status_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
