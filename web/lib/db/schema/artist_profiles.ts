import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { artistProfileFiles } from "./artist_profile_files";

/**
 * An artist's payment and identity details, filled in once on My details. After the first save,
 * changes go through artist_profile_change_requests and need approval.
 */
export const artistProfiles = pgTable(
  "artist_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    mobile: text("mobile"),
    upiId: text("upi_id"),
    accountHolderName: text("account_holder_name"),
    bankAccountNumber: text("bank_account_number"),
    ifsc: text("ifsc"),
    bankName: text("bank_name"),
    panNumber: text("pan_number"),
    portfolioLinks: text("portfolio_links"),
    aadhaarFileId: uuid("aadhaar_file_id").references(() => artistProfileFiles.id),
    panFileId: uuid("pan_file_id").references(() => artistProfileFiles.id),
    chequeFileId: uuid("cheque_file_id").references(() => artistProfileFiles.id),
    resumeFileId: uuid("resume_file_id").references(() => artistProfileFiles.id),
    ipAgreementFileId: uuid("ip_agreement_file_id").references(() => artistProfileFiles.id),
    // The signed NDA: a link to it, an uploaded PDF, or both. Optional.
    ndaUrl: text("nda_url"),
    ndaFileId: uuid("nda_file_id").references(() => artistProfileFiles.id),
    // Set on the artist's first save. Null while the profile only holds what was copied from the old form.
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // When documents were copied in from the Team Onboarding Google Form, for the artist to check.
    importedFromFormAt: timestamp("imported_from_form_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("artist_profiles_personnel_idx").on(table.personnelId)]
);
