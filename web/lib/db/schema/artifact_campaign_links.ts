import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { knowledgeArtifacts } from "./knowledge_artifacts";

// "Marketing campaigns" is one of the brief's §7 "attachable to" surfaces.
// marketing_updates.campaign is a free-text label, not a normalized
// entity (confirmed directly - no campaigns table exists), so this links
// to a campaign NAME the same way artifact_category_links already links to
// a free-text category, rather than inventing a new normalized Campaign
// table that the real Marketing feature doesn't itself use.
export const artifactCampaignLinks = pgTable(
  "artifact_campaign_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => knowledgeArtifacts.id),
    campaignName: text("campaign_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.artifactId, table.campaignName)]
);
