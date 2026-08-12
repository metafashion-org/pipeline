import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

export const uploadRecords = pgTable("upload_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  publisherId: uuid("publisher_id").references(() => personnel.id),
  robloxAssetId: text("roblox_asset_id"),
  robloxItemUrl: text("roblox_item_url").notNull(),
  uploadNotes: text("upload_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
