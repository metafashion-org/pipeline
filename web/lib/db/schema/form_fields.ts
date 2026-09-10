import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { formDefinitions } from "./form_definitions";

export const formFields = pgTable("form_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  formDefinitionId: uuid("form_definition_id").references(() => formDefinitions.id, { onDelete: "cascade" }).notNull(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull(), // 'text' | 'textarea' | 'select' | 'multi_select' | 'url' | 'image' | 'file'
  // The section this field belongs to, by name. Null means the form's first, unnamed section.
  //
  // A form used to be one flat list filled top to bottom. Sections are what let someone who
  // already knows the form jump straight to the part they came to fill: the filler draws one
  // panel per section and a rail to move between them in any order, rather than a single column
  // that has to be scrolled through.
  section: text("section"),
  // Shown under the label. The only guidance a form could give before was in the label itself,
  // which made labels long and the form hard to scan.
  helpText: text("help_text"),
  placeholder: text("placeholder"),
  sortOrder: integer("sort_order").notNull(),
  isRequired: boolean("is_required").default(false).notNull(),
  options: jsonb("options").default([]), // For dropdown / radio options
  validationRules: jsonb("validation_rules").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // A field key is unique within its own form, not across all forms. Without this the
  // onboarding seed's existence check (which matched on fieldKey alone) would treat another
  // form's "email" field as proof that the artist-access form already had one, and silently
  // leave that form a field short. The seed now scopes its own lookup as well; this makes the
  // rule structural so the next seeder can't reintroduce the bug.
  unique("form_fields_definition_key_unique").on(table.formDefinitionId, table.fieldKey),
  // Rendering a form reads its fields in sort order.
  index("form_fields_definition_sort_idx").on(table.formDefinitionId, table.sortOrder),
]);
