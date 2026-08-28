import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

// The configurable prefix list from the brief's §7 — admin-editable, not
// hardcoded. Seeded with the brief's own 10 examples (TR/INS/ANA/RK/REF/
// MBD/TG/MKT/CD/PRM) as real starting data, but new types can be added at
// any time without touching code. nextSequence is the counter for THIS
// type only — every type counts up independently, per the spec.
export const artifactTypeConfig = pgTable("artifact_type_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  prefix: text("prefix").notNull().unique(), // e.g. "TR"
  label: text("label").notNull(), // e.g. "Trend Brief"
  nextSequence: integer("next_sequence").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
