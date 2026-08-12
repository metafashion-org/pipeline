import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const guidelines = pgTable("guidelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  category: text("category"),
  guidelineType: text("guideline_type").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  linkedAssetCategory: text("linked_asset_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
