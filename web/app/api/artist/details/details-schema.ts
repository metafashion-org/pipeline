import { z } from "zod";

const MAX_FIELD_CHARS = 500;
const text = z.string().max(MAX_FIELD_CHARS).nullable();
const fileId = z.uuid().nullable();

/** The My details body: every field, null when empty. Formats are checked in lib/artist-details/details-rules.ts. */
export const ArtistDetailsSchema = z.object({
  mobile: text,
  upiId: text,
  accountHolderName: text,
  bankAccountNumber: text,
  ifsc: text,
  bankName: text,
  panNumber: text,
  portfolioLinks: text,
  aadhaarFileId: fileId,
  panFileId: fileId,
  chequeFileId: fileId,
  resumeFileId: fileId,
  ipAgreementFileId: fileId,
  ndaUrl: text,
  ndaFileId: fileId,
});
