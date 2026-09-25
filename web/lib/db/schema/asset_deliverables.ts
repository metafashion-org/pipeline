import { pgTable, uuid, text, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

/**
 * One final file an artist handed in for an asset. The bytes live in the Shared Drive, in
 * "Meta Fashion Pipeline — <SKU>/Final Files/v<version>/"; this row is what the app reads to know
 * the file exists and where. Every submission is a new version with its own folder, so a
 * resubmission never overwrites the previous files.
 */
export const assetDeliverables = pgTable(
  "asset_deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    // bigint in mode "number": final 3D files can pass 2 GB, which an integer column can't hold.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    driveFileId: text("drive_file_id").notNull(),
    driveUrl: text("drive_url").notNull(),
    // The v<version> folder, so the uploader can open the whole submission at once.
    driveFolderId: text("drive_folder_id").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => personnel.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("asset_deliverables_asset_version_idx").on(table.assetId, table.version)]
);
