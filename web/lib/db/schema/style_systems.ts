import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// One of the brief's §7 "attachable to" surfaces ("Style systems") that had
// no real entity anywhere - a curated, named aesthetic/style definition
// (e.g. "Kawaii Aesthetic Pack", "Y2K Collection Guide"), the same
// structured shape as `guidelines` rather than a freeform tag, since the
// brief lists it alongside the other named entities (SKUs, categories,
// guideline libraries), not alongside the artifact's own free-text tags.
export const styleSystems = pgTable("style_systems", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
