import { pgTable, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { knowledgeArtifacts } from "./knowledge_artifacts";
import { guidelines } from "./guidelines";

export const artifactGuidelineLinks = pgTable(
  "artifact_guideline_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => knowledgeArtifacts.id),
    guidelineId: uuid("guideline_id").notNull().references(() => guidelines.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.artifactId, table.guidelineId)]
);
