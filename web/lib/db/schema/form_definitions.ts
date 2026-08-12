import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const formDefinitions = pgTable("form_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  targetRoles: text("target_roles").array().default([]), // Roles allowed to fill, empty means public / onboarding
  onSubmissionBehavior: text("on_submission_behavior").notNull().default("record_only"), // 'record_only' | 'trigger_personnel_onboarding'
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
