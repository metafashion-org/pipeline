import { pgTable, uuid, text, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";
import { assetFinalSubmissions } from "./asset_final_submissions";
import type { FinalFileKind } from "@/lib/deliverables/final-zip";

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
    // The submission this file came in with. Null only for files recorded before submissions had a
    // row of their own (drizzle/0037 links those it can).
    submissionId: uuid("submission_id").references(() => assetFinalSubmissions.id, { onDelete: "cascade" }),
    // What the file is: "final_zip", the one .zip an artist hands in (lib/deliverables/final-zip.ts).
    // Null for files handed in before that.
    kind: text("kind").$type<FinalFileKind>(),
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
  (table) => [
    index("asset_deliverables_asset_version_idx").on(table.assetId, table.version),
    index("asset_deliverables_submission_idx").on(table.submissionId),
  ]
);
