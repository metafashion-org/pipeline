import { pgTable, uuid, text, integer, date, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { teamTaskRecurrences } from "./team_task_recurrences";

/**
 * One Team Task: day-to-day work for the full-time team, separate from the asset board. It has one
 * owner; its place in the owner's list (position) is its priority. See lib/team-tasks/.
 */
export const teamTasks = pgTable(
  "team_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    // A key of TEAM_TASK_AREAS in lib/team-tasks/task-rules.ts: what kind of work it is.
    area: text("area").notNull(),
    // A key of TEAM_TASK_STATUSES in lib/team-tasks/task-rules.ts.
    status: text("status").default("todo").notNull(),
    // What or who a blocked task is waiting on.
    waitingOn: text("waiting_on"),
    ownerId: uuid("owner_id").references(() => personnel.id).notNull(),
    dueOn: date("due_on", { mode: "string" }),
    // Order within the owner's list, lowest first. The top of the list is what matters most.
    position: integer("position").default(0).notNull(),
    // For counted work: how many are due (e.g. 45 assets curated) and how many are done.
    targetCount: integer("target_count"),
    doneCount: integer("done_count").default(0).notNull(),
    // What kind of items, for a season, copied from the recurrence (e.g. "Christmas").
    focus: text("focus"),
    recurrenceId: uuid("recurrence_id").references(() => teamTaskRecurrences.id, { onDelete: "set null" }),
    // The day a recurring task is for.
    occurrenceOn: date("occurrence_on", { mode: "string" }),
    createdBy: uuid("created_by").references(() => personnel.id, { onDelete: "set null" }),
    // Seen only by its owner, its creator and its helpers (lib/team-tasks/team-board.ts visibleTo).
    isPrivate: boolean("is_private").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Bumped by any change, subtask tick or comment. A task not touched for STALE_AFTER_DAYS is flagged.
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("team_tasks_recurrence_day_idx").on(table.recurrenceId, table.occurrenceOn),
    index("team_tasks_owner_status_idx").on(table.ownerId, table.status),
    index("team_tasks_completed_at_idx").on(table.completedAt),
  ]
);
