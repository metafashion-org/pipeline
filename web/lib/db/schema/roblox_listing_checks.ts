import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { uploadRecords } from "./upload_records";
import { personnel } from "./personnel";

/**
 * What Roblox showed for one listing when it was checked, next to our own on-sale tick at that
 * moment. Append-only, so a difference between the two keeps the time it was seen. See
 * lib/marketing/todays-picks-service.ts.
 */
export const robloxListingChecks = pgTable(
  "roblox_listing_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadRecordId: uuid("upload_record_id").references(() => uploadRecords.id, { onDelete: "cascade" }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    checkedBy: uuid("checked_by").references(() => personnel.id, { onDelete: "set null" }),
    httpStatus: integer("http_status"),
    isForSale: boolean("is_for_sale"),
    priceRobux: integer("price_robux"),
    robloxName: text("roblox_name"),
    assetTypeId: integer("asset_type_id"),
    creatorName: text("creator_name"),
    ourOnSale: boolean("our_on_sale").notNull(),
    error: text("error"),
  },
  (table) => [index("roblox_listing_checks_listing_time_idx").on(table.uploadRecordId, table.checkedAt)]
);
