import { pgTable, uuid, text, integer, date, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { teamTasks } from "./team_tasks";

/**
 * One item on a Team Task's checklist. One level only: a subtask has no subtasks. An item with its
 * own owner also shows in that person's column on the board.
 */
export const teamTaskSubtasks = pgTable(
  "team_task_subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => teamTasks.id, { onDelete: "cascade" }).notNull(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id").references(() => personnel.id, { onDelete: "set null" }),
    dueOn: date("due_on", { mode: "string" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    position: integer("position").default(0).notNull(),
    createdBy: uuid("created_by").references(() => personnel.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("team_task_subtasks_task_idx").on(table.taskId), index("team_task_subtasks_owner_idx").on(table.ownerId)]
);
