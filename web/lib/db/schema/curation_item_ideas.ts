import { pgTable, uuid, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { assets } from "./assets";

export const curationItemIdeas = pgTable("curation_item_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  ideaTitle: text("idea_title").notNull(),
  category: text("category"),
  trendReasoning: text("trend_reasoning"),
  sourceLinks: text("source_links").array().default([]),
  moodboardUrls: text("moodboard_urls").array().default([]),
  // Every dynamic curation field defined in curation_field_config, keyed by
  // its fieldKey. Stored as JSONB rather than one column per field so admins
  // can add/rename/retire fields without a migration each time, per the
  // brief's §6 ("This list is not fixed") and §2's config-driven principle.
  // The columns above (ideaTitle/category/trendReasoning/sourceLinks/
  // moodboardUrls) predate this and stay as first-class columns — they're
  // the ones the SKU-creation path itself reads.
  fieldValues: jsonb("field_values").default({}),
  // Set once the SKU is created from this idea (submitCurationItemIdea).
  // This is the actual link the brief's §7 traceability language is about
  // at the curation stage: without it, getBriefFieldsForAsset had no way
  // to find an idea's dynamic field values again once the asset existed.
  assetId: uuid("asset_id").references(() => assets.id),
  submittedBy: uuid("submitted_by").references(() => personnel.id),
  // This column already had a 'draft' state documented (and defaulted to it)
  // from the original build, but nothing ever created or read a draft row -
  // submitCurationItemIdea always inserted straight to 'approved'. The
  // parallel-drafts/version-history system reuses this exact column/state
  // rather than adding a second, competing table - see lib/curation/draft-service.ts.
  // 'draft' | 'approved' | 'rejected' | 'converted_to_asset'
  status: text("status").notNull().default("draft"),
  // Bumped on each meaningful save while status is 'draft' (see
  // draft-service.ts's throttling - not every keystroke). Snapshots of each
  // version live in curation_idea_versions.
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
