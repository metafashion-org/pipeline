import { pgTable, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { knowledgeArtifacts } from "./knowledge_artifacts";
import { assets } from "./assets";

export const artifactSkuLinks = pgTable(
  "artifact_sku_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => knowledgeArtifacts.id),
    assetId: uuid("asset_id").notNull().references(() => assets.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.artifactId, table.assetId)]
);
