import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { teamTasks } from "./team_tasks";

/** Someone helping a Team Task's owner. The owner stays the one person responsible for it. */
export const teamTaskHelpers = pgTable(
  "team_task_helpers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => teamTasks.id, { onDelete: "cascade" }).notNull(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("team_task_helpers_task_person_idx").on(table.taskId, table.personnelId)]
);
