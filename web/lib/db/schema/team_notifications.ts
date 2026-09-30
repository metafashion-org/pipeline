import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { teamTasks } from "./team_tasks";

/**
 * Something a person was told about on Team Tasks: an @mention or a task given to them. The same
 * notice goes out by email and in the office Discord channel; this row is what the page's bell shows.
 */
export const teamNotifications = pgTable(
  "team_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    taskId: uuid("task_id").references(() => teamTasks.id, { onDelete: "cascade" }),
    // A key of TEAM_NOTIFICATION_KINDS in lib/team-tasks/task-rules.ts.
    kind: text("kind").notNull(),
    actorId: uuid("actor_id").references(() => personnel.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("team_notifications_recipient_idx").on(table.recipientId, table.readAt)]
);
