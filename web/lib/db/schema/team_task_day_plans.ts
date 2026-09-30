import { pgTable, uuid, integer, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { teamTasks } from "./team_tasks";

/**
 * One task in one person's plan for one day, in the order they'll do it. Rows are kept per date, so
 * what someone put first on any past day can be looked up. The board's Today row reads today's.
 */
export const teamTaskDayPlans = pgTable(
  "team_task_day_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planOn: date("plan_on", { mode: "string" }).notNull(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    taskId: uuid("task_id").references(() => teamTasks.id, { onDelete: "cascade" }).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("team_task_day_plans_day_person_task_idx").on(table.planOn, table.personnelId, table.taskId)]
);
