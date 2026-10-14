import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";

/**
 * One piece of naming evidence for a Today's Picks SKU: a report line, workbook row, image
 * correspondence or live Roblox metadata, with its exact location and text, the name words it
 * supports, a confidence, its limits and any conflict. Separate from artifact_sku_links (design
 * origin): it never claims where a design came from. Retired, never deleted. See
 * lib/marketing/name-evidence.ts.
 */
export const nameEvidence = pgTable(
  "name_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    kind: text("kind").notNull(),
    sourceRef: text("source_ref").notNull(),
    location: text("location").notNull(),
    quote: text("quote").notNull(),
    supports: text("supports").array().default([]).notNull(),
    confidence: text("confidence").notNull(),
    limits: text("limits"),
    conflict: text("conflict"),
    enteredBy: text("entered_by"),
    rowHash: text("row_hash").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredReason: text("retired_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("name_evidence_row_hash_idx").on(table.rowHash), index("name_evidence_asset_idx").on(table.assetId)]
);
