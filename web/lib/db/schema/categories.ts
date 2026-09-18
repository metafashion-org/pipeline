import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

// The list an asset's Category field is picked from — admin-configurable rather than free text,
// same "statuses, brand groups, artifact types live in config tables, not code" pattern this app
// already follows (see brand_groups.ts). assets.category itself stays a plain text column: this
// table only backs the picker, so an existing value that predates this list still displays even
// if nobody has added it here yet.
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
