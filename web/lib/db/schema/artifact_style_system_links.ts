import { pgTable, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { knowledgeArtifacts } from "./knowledge_artifacts";
import { styleSystems } from "./style_systems";

export const artifactStyleSystemLinks = pgTable(
  "artifact_style_system_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => knowledgeArtifacts.id),
    styleSystemId: uuid("style_system_id").notNull().references(() => styleSystems.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.artifactId, table.styleSystemId)]
);
