import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { formDefinitions } from "./form_definitions";
import { personnel } from "./personnel";

export const formSubmissions = pgTable("form_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  formDefinitionId: uuid("form_definition_id").references(() => formDefinitions.id, { onDelete: "cascade" }).notNull(),
  submitterEmail: text("submitter_email"),
  submitterId: uuid("submitter_id").references(() => personnel.id),
  values: jsonb("values").notNull().default({}),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  reviewedBy: uuid("reviewed_by").references(() => personnel.id),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // The review queue reads one form's pending submissions, newest first.
  index("form_submissions_form_status_idx").on(table.formDefinitionId, table.status, table.createdAt),
  // Same reasoning as curation_item_ideas.field_values: this holds the answers people typed,
  // so it is the column a query would search by key or value.
  index("form_submissions_values_gin").using("gin", table.values),
]);
