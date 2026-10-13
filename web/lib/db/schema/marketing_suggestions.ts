import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";

/**
 * A suggestion read from the private sheet's Suggestions tab (written by Arjun's assistant). It is
 * shown next to the draft and only changes it when Arjun presses Use. row_hash makes re-reads add
 * nothing. See lib/marketing/todays-picks-sheet.ts.
 */
export const marketingSuggestions = pgTable(
  "marketing_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    listingId: uuid("listing_id"),
    field: text("field").notNull(),
    value: text("value").notNull(),
    evidence: text("evidence"),
    suggestedBy: text("suggested_by"),
    suggestedAt: text("suggested_at"),
    rowHash: text("row_hash").notNull(),
    // 'new' | 'used' | 'dismissed'
    status: text("status").default("new").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("marketing_suggestions_row_hash_idx").on(table.rowHash), index("marketing_suggestions_asset_idx").on(table.assetId)]
);
