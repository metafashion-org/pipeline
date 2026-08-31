import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { curationItemIdeas } from "./curation_item_ideas";

// Append-only snapshot log for the parallel-drafts/version-history system.
// One row per saved version of a curation_item_ideas draft - see
// lib/curation/draft-service.ts for when a save actually creates a new
// snapshot versus just updating the live row in place (not every autosave
// tick, or this would fill with near-duplicate entries).
export const curationIdeaVersions = pgTable("curation_idea_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ideaId: uuid("idea_id").references(() => curationItemIdeas.id, { onDelete: "cascade" }).notNull(),
  version: integer("version").notNull(),
  ideaTitle: text("idea_title").notNull(),
  category: text("category"),
  trendReasoning: text("trend_reasoning"),
  sourceLinks: text("source_links").array().default([]),
  moodboardUrls: text("moodboard_urls").array().default([]),
  fieldValues: jsonb("field_values").default({}),
  savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
});
