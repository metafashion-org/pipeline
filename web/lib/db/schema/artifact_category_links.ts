import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { knowledgeArtifacts } from "./knowledge_artifacts";

export const artifactCategoryLinks = pgTable(
  "artifact_category_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => knowledgeArtifacts.id),
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.artifactId, table.category)]
);
