import { pgTable, uuid, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const curationFieldConfig = pgTable("curation_field_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  fieldKey: text("field_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  includeInArtistEmail: boolean("include_in_artist_email").default(true).notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
