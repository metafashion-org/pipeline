import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

// Which Roblox creator group/brand an asset gets uploaded under. Admin-configurable rather than
// hardcoded (same "statuses, categories, artifact types live in config tables, not code"
// principle this app already follows elsewhere) — the uploader is who actually needs this to be
// reliable, and a hardcoded list would need a code deploy every time a new brand/group exists.
export const brandGroups = pgTable("brand_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  robloxGroupUrl: text("roblox_group_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
