import { pgTable, uuid, text, integer, timestamp, index, customType } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

// Postgres bytea, read and written as a Node Buffer.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * One document an artist uploaded on My details (Aadhaar, PAN, cancelled cheque, resume, IP
 * agreement). Kept twice: in Drive (driveUrl) and as bytes here, so a Drive problem doesn't lose it.
 * Documents copied from the old onboarding form have a Drive link only.
 */
export const artistProfileFiles = pgTable(
  "artist_profile_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    // A key of ARTIST_DOCUMENT_KINDS in lib/artist-details/details-rules.ts.
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    driveUrl: text("drive_url"),
    bytes: bytea("bytes"),
    uploadedBy: uuid("uploaded_by").references(() => personnel.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("artist_profile_files_personnel_idx").on(table.personnelId)]
);
