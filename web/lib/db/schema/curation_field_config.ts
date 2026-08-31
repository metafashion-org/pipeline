import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// Per the brief's §6: "Each field should have a type (text, image, dropdown,
// multi-select, URL, etc.), a display name, an internal key, and a flag for
// whether it is included in artist briefs." fieldType was missing entirely
// until now — the sibling form_fields table already had one, so the pattern
// existed, it just wasn't applied here (see HANDOFF.md).
//
// isActive covers the brief's "add, rename, or retire fields at any time
// without breaking existing records": retiring sets isActive=false rather
// than deleting the row, so historical curation_item_ideas.fieldValues
// entries keyed by this fieldKey stay readable instead of orphaning.
export const curationFieldConfig = pgTable("curation_field_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  fieldKey: text("field_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  fieldType: text("field_type").notNull().default("text"), // 'text' | 'textarea' | 'select' | 'multi_select' | 'url' | 'image' | 'number'
  options: jsonb("options").default([]), // choices for select / multi_select
  includeInArtistEmail: boolean("include_in_artist_email").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
