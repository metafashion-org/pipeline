import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

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
  // Which item categories this field appears for. Empty or null means every category, which
  // is what every existing row means and why this is nullable rather than defaulted per row.
  //
  // The field list was one flat set applied to every kind of asset, but the production fields
  // genuinely differ by category — a rigged Hair mesh needs Mannequin/Rig and Technical Specs,
  // a flat decal needs neither, and showing all of them everywhere leaves most null most of
  // the time. Scoping is one column added once, not a migration per field change, so the
  // config-driven promise of this table is unaffected.
  appliesToCategories: text("applies_to_categories").array(),
  includeInArtistEmail: boolean("include_in_artist_email").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Every form render reads the live fields in order; the filter is on isActive, the sort on
  // sortOrder. Small table today, but this is the query behind every curation page load.
  index("curation_field_config_active_sort_idx").on(table.isActive, table.sortOrder),
]);
