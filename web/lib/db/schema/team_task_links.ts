import { sql } from "drizzle-orm";
import { pgTable, uuid, timestamp, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { assets } from "./assets";
import { knowledgeArtifacts } from "./knowledge_artifacts";
import { teamTasks } from "./team_tasks";

/**
 * A link from a Team Task to exactly one of: another task, an asset (SKU), or a Registry artifact
 * such as the insight the task came from. A task-to-task link is one row and shows on both tasks.
 */
export const teamTaskLinks = pgTable(
  "team_task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => teamTasks.id, { onDelete: "cascade" }).notNull(),
    linkedTaskId: uuid("linked_task_id").references((): AnyPgColumn => teamTasks.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").references(() => knowledgeArtifacts.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => personnel.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("team_task_links_one_target", sql`num_nonnulls(${table.linkedTaskId}, ${table.assetId}, ${table.artifactId}) = 1`),
    index("team_task_links_task_idx").on(table.taskId),
    index("team_task_links_linked_task_idx").on(table.linkedTaskId),
    index("team_task_links_artifact_idx").on(table.artifactId),
    uniqueIndex("team_task_links_task_task_idx").on(table.taskId, table.linkedTaskId),
    uniqueIndex("team_task_links_task_asset_idx").on(table.taskId, table.assetId),
    uniqueIndex("team_task_links_task_artifact_idx").on(table.taskId, table.artifactId),
  ]
);
