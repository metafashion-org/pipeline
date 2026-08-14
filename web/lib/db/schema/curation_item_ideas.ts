import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

export const curationItemIdeas = pgTable("curation_item_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  ideaTitle: text("idea_title").notNull(),
  category: text("category"),
  trendReasoning: text("trend_reasoning"),
  sourceLinks: text("source_links").array().default([]),
  moodboardUrls: text("moodboard_urls").array().default([]),
  submittedBy: uuid("submitted_by").references(() => personnel.id),
  status: text("status").notNull().default("draft"), // 'draft' | 'approved' | 'rejected' | 'converted_to_asset'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
