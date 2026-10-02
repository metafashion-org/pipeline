// The fields on an artist's My details page, how each is checked, and how bank numbers are masked.
// Imported by client components too, so nothing here touches the database.

/** The documents an artist uploads, and the profile column each is saved in. */
export const ARTIST_DOCUMENT_KINDS = [
  { key: "aadhaar", column: "aadhaarFileId", label: "Aadhaar (front and back)", required: true },
  { key: "pan", column: "panFileId", label: "PAN card", required: true },
  { key: "cheque", column: "chequeFileId", label: "Cancelled cheque, or a bank app screenshot of your account details", required: true },
  { key: "resume", column: "resumeFileId", label: "Resume", required: false },
  { key: "ip_agreement", column: "ipAgreementFileId", label: "Signed IP assignment agreement", required: false },
  { key: "nda", column: "ndaFileId", label: "Signed NDA (PDF)", required: false },
] as const;
export type ArtistDocumentKind = (typeof ARTIST_DOCUMENT_KINDS)[number]["key"];

export function isArtistDocumentKind(value: string): value is ArtistDocumentKind {
  return ARTIST_DOCUMENT_KINDS.some((d) => d.key === value);
}

export const CHANGE_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];
export const PENDING_STATUS: ChangeRequestStatus = "pending";

/** Everything My details saves. Documents are the ids of artist_profile_files rows. */
export interface ArtistDetailsInput {
  mobile: string | null;
  upiId: string | null;
  accountHolderName: string | null;
  bankAccountNumber: string | null;
  ifsc: string | null;
  bankName: string | null;
  panNumber: string | null;
  portfolioLinks: string | null;
  aadhaarFileId: string | null;
  panFileId: string | null;
  chequeFileId: string | null;
  resumeFileId: string | null;
  ipAgreementFileId: string | null;
  ndaUrl: string | null;
  ndaFileId: string | null;
}

export const ARTIST_DETAIL_KEYS: (keyof ArtistDetailsInput)[] = [
  "mobile",
  "upiId",
  "accountHolderName",
  "bankAccountNumber",
  "ifsc",
  "bankName",
  "panNumber",
  "portfolioLinks",
  "aadhaarFileId",
  "panFileId",
  "chequeFileId",
  "resumeFileId",
  "ipAgreementFileId",
  "ndaUrl",
  "ndaFileId",
];

/** Labels for the text fields, also used to say what a change request changes. */
export const ARTIST_FIELD_LABELS: Record<keyof ArtistDetailsInput, string> = {
  mobile: "Mobile",
  upiId: "UPI ID",
  accountHolderName: "Account holder name",
  bankAccountNumber: "Bank account number",
  ifsc: "IFSC",
  bankName: "Bank name",
  panNumber: "PAN number",
  portfolioLinks: "Portfolio links",
  aadhaarFileId: "Aadhaar",
  panFileId: "PAN card image",
  chequeFileId: "Cancelled cheque",
  resumeFileId: "Resume",
  ipAgreementFileId: "IP agreement",
  ndaUrl: "NDA link",
  ndaFileId: "Signed NDA",
};

// Formats of Indian payment and identity details.
const MOBILE_PATTERN = /^[6-9]\d{9}$/;
const UPI_PATTERN = /^[\w.-]{2,}@[a-zA-Z][\w.-]{1,}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
const LINK_PATTERN = /^https?:\/\/\S+$/i;
const COUNTRY_CODE = "91";
const MOBILE_DIGITS = 10;
const VISIBLE_DIGITS = 4;
// The mask never shows more dots than this, so a long account number stays short on screen.
const MAX_MASK_DOTS = 8;

// Spaces and dashes people type inside numbers, and a +91 or 91 in front of a mobile number.
function digitsOnly(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** The details with each value tidied: trimmed, upper-cased where the format is upper case, numbers without spaces. */
export function normaliseDetails(input: ArtistDetailsInput): ArtistDetailsInput {
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  let mobile = clean(input.mobile);
  if (mobile) {
    mobile = digitsOnly(mobile).replace(/^\+/, "");
    if (mobile.length === MOBILE_DIGITS + COUNTRY_CODE.length && mobile.startsWith(COUNTRY_CODE)) mobile = mobile.slice(COUNTRY_CODE.length);
  }
  return {
    ...input,
    mobile,
    upiId: clean(input.upiId)?.toLowerCase() ?? null,
    accountHolderName: clean(input.accountHolderName),
    bankAccountNumber: clean(input.bankAccountNumber) ? digitsOnly(input.bankAccountNumber as string) : null,
    ifsc: clean(input.ifsc)?.toUpperCase() ?? null,
    bankName: clean(input.bankName),
    panNumber: clean(input.panNumber)?.toUpperCase() ?? null,
    portfolioLinks: clean(input.portfolioLinks),
    ndaUrl: clean(input.ndaUrl),
  };
}

/**
 * Checks the details an artist saves. Everything needed to pay them is required: mobile, UPI ID,
 * account holder, account number, IFSC, bank, PAN, and the Aadhaar, PAN and cheque documents.
 *
 * Input: normalised details. Output: null when they're complete and well formed, or the first problem.
 */
export function checkDetails(details: ArtistDetailsInput): string | null {
  const required: [keyof ArtistDetailsInput, string][] = [
    ["mobile", "your mobile number"],
    ["upiId", "your UPI ID"],
    ["accountHolderName", "the account holder's name"],
    ["bankAccountNumber", "your bank account number"],
    ["ifsc", "your bank's IFSC"],
    ["bankName", "your bank's name"],
    ["panNumber", "your PAN number"],
  ];
  for (const [key, what] of required) if (!details[key]) return `Add ${what}`;
  for (const doc of ARTIST_DOCUMENT_KINDS) {
    if (doc.required && !details[doc.column]) return `Upload your ${doc.label.split(",")[0]}`;
  }
  if (!MOBILE_PATTERN.test(details.mobile as string)) return "The mobile number should be 10 digits";
  if (!UPI_PATTERN.test(details.upiId as string)) return "That UPI ID doesn't look right (it looks like name@bank)";
  if (!ACCOUNT_NUMBER_PATTERN.test(details.bankAccountNumber as string)) return "The account number should be 9 to 18 digits";
  if (!IFSC_PATTERN.test(details.ifsc as string)) return "The IFSC should look like SBIN0001234";
  if (!PAN_PATTERN.test(details.panNumber as string)) return "The PAN should look like ABCDE1234F";
  // The NDA is optional; a link alone, a PDF alone, or both are accepted.
  if (details.ndaUrl && !LINK_PATTERN.test(details.ndaUrl)) return "The NDA link should start with https://";
  return null;
}

/** A number shown with all but its last 4 characters hidden, e.g. ••••••4321. */
export function maskNumber(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= VISIBLE_DIGITS) return "••••";
  return `${"•".repeat(Math.min(value.length - VISIBLE_DIGITS, MAX_MASK_DOTS))}${value.slice(-VISIBLE_DIGITS)}`;
}

/** The fields whose value differs between the saved details and the new ones. */
export function changedFields(saved: ArtistDetailsInput, next: ArtistDetailsInput): Partial<ArtistDetailsInput> {
  const changes: Partial<ArtistDetailsInput> = {};
  for (const key of ARTIST_DETAIL_KEYS) {
    if ((saved[key] ?? null) !== (next[key] ?? null)) changes[key] = next[key];
  }
  return changes;
}
