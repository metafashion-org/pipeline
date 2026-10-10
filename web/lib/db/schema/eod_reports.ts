import { pgTable, uuid, text, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

/**
 * A person's end-of-day report, written by them in their own words: what got done, what slipped,
 * what's blocking them, what they need from Arjun, and the outcome tomorrow's plan is tied to.
 * Tomorrow's tasks themselves are their plan on the board. One per person per day; it can be
 * edited until the summary goes out, and submittedAt keeps the first time it was sent.
 */
export const eodReports = pgTable(
  "eod_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    reportOn: date("report_on", { mode: "string" }).notNull(),
    done: text("done").notNull().default(""),
    slipped: text("slipped").notNull().default(""),
    blockers: text("blockers").notNull().default(""),
    needFromManager: text("need_from_manager").notNull().default(""),
    nextOutcome: text("next_outcome").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("eod_reports_person_day_idx").on(table.personnelId, table.reportOn)]
);
