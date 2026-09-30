import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { teamTasks } from "./team_tasks";

/** An update or a question on a Team Task. Everyone @mentioned in it is notified. */
export const teamTaskComments = pgTable(
  "team_task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => teamTasks.id, { onDelete: "cascade" }).notNull(),
    authorId: uuid("author_id").references(() => personnel.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    mentionedIds: uuid("mentioned_ids").array().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("team_task_comments_task_idx").on(table.taskId, table.createdAt)]
);
