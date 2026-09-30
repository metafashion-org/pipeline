import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

/**
 * One hand-in of an asset's final files, from the Submit final files page (the in-app replacement
 * for the "3D Art Submission Form" Google Form). Its files are asset_deliverables rows pointing at
 * it; the files themselves are in the Shared Drive under "<SKU>/Final Files/v<version>/".
 */
export const assetFinalSubmissions = pgTable(
  "asset_final_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    version: integer("version").notNull(),
    // The form's "Your comments": issues faced, resubmission, improvements, logo changes, patterns removed.
    comments: text("comments"),
    submittedBy: uuid("submitted_by").references(() => personnel.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // One submission per version: a second hand-in racing the first can't claim the same version.
  (table) => [uniqueIndex("asset_final_submissions_asset_version_idx").on(table.assetId, table.version)]
);
