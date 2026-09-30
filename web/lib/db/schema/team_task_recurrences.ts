import { pgTable, uuid, text, integer, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

/**
 * A Team Task that repeats on set weekdays, such as a daily "Curate 45 assets" for a curator. Each
 * day it applies to, lib/team-tasks/recurring-service.ts makes that day's task and puts it in the
 * owner's plan. The focus (e.g. "Christmas") says what kind of work it is for a season, until
 * focusUntil.
 */
export const teamTaskRecurrences = pgTable("team_task_recurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  notes: text("notes"),
  // A key of TEAM_TASK_AREAS in lib/team-tasks/task-rules.ts.
  area: text("area").notNull(),
  ownerId: uuid("owner_id").references(() => personnel.id).notNull(),
  // 0 = Sunday ... 6 = Saturday, as Date.getDay() numbers them.
  weekdays: integer("weekdays").array().default([]).notNull(),
  // How many of something the day's task is for, e.g. 45 assets. Null for a plain task.
  targetCount: integer("target_count"),
  focus: text("focus"),
  focusUntil: date("focus_until", { mode: "string" }),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: uuid("created_by").references(() => personnel.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
