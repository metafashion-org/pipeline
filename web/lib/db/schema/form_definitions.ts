import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

// Who is allowed to open and fill a form.
//
// `targetRoles` alone could only say "public" (empty) or "these roles" (non-empty), which left no
// way to send a form to a named list of people — the common case when this replaced Google Forms,
// where a form was shared with specific addresses. Making the audience an explicit column means
// "public" is a stated choice rather than the absence of one, so an empty role list can no longer
// be mistaken for a deliberate decision to publish.
export const FORM_AUDIENCES = ["public", "roles", "emails"] as const;
export type FormAudience = (typeof FORM_AUDIENCES)[number];

export const formDefinitions = pgTable("form_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  // 'public' | 'roles' | 'emails'. See FORM_AUDIENCES above.
  audience: text("audience").notNull().default("public"),
  targetRoles: text("target_roles").array().default([]), // Read when audience is 'roles'.
  // Addresses allowed to fill the form when audience is 'emails'. Stored lowercase; the caller
  // must be signed in as one of them, because an address someone types about themselves proves
  // nothing.
  allowedEmails: text("allowed_emails").array().default([]),
  onSubmissionBehavior: text("on_submission_behavior").notNull().default("record_only"), // 'record_only' | 'trigger_personnel_onboarding' | 'trigger_artifact_creation'
  isActive: boolean("is_active").default(true).notNull(),
  // Who built the form. Nullable because every form that existed before this column was added was
  // written by a seeder with no person behind it.
  createdBy: uuid("created_by").references(() => personnel.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // The form list is read newest-first on every visit to the builder.
  index("form_definitions_created_idx").on(table.createdAt),
]);
