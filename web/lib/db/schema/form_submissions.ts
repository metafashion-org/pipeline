import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
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
});
