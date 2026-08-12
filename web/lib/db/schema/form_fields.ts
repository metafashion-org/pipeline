import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { formDefinitions } from "./form_definitions";

export const formFields = pgTable("form_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  formDefinitionId: uuid("form_definition_id").references(() => formDefinitions.id, { onDelete: "cascade" }).notNull(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull(), // 'text' | 'textarea' | 'select' | 'multi_select' | 'url' | 'image' | 'file'
  sortOrder: integer("sort_order").notNull(),
  isRequired: boolean("is_required").default(false).notNull(),
  options: jsonb("options").default([]), // For dropdown / radio options
  validationRules: jsonb("validation_rules").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
