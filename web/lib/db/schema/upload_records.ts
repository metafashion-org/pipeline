import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assets } from "./assets";
import { personnel } from "./personnel";

export const uploadRecords = pgTable("upload_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  publisherId: uuid("publisher_id").references(() => personnel.id),
  robloxAssetId: text("roblox_asset_id"),
  robloxItemUrl: text("roblox_item_url").notNull(),
  uploadNotes: text("upload_notes"),
  // Which recolour this link is, e.g. "Red". Optional; the drawer shows "Link 1" etc. without it.
  variantLabel: text("variant_label"),
  // When and by whom Arjun put this recolour on sale. Null while it isn't on sale: an uploaded
  // recolour isn't always put on sale.
  onSaleAt: timestamp("on_sale_at", { withTimezone: true }),
  onSaleBy: uuid("on_sale_by").references(() => personnel.id, { onDelete: "set null" }),
  // Set when Arjun picks this listing as the asset's main one: the link a Today's Picks nomination
  // uses, with the other on-sale listings as its recolours. At most one per asset (index below).
  mainAt: timestamp("main_at", { withTimezone: true }),
  mainBy: uuid("main_by").references(() => personnel.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("upload_records_one_main_per_asset_idx").on(table.assetId).where(sql`${table.mainAt} IS NOT NULL`),
]);
