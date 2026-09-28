import { formatFee } from "@/lib/format-money";
import { renderEmailLayout, EMAIL_TONE, type EmailDetailRow } from "./email-layout";

export interface AssignmentEmailBriefField {
  key: string;
  displayName: string;
  value: string;
}

export interface AssignmentEmailData {
  sku: string;
  itemName: string;
  category?: string | null;
  artistName: string;
  feeAmount?: string | null;
  currency?: string | null;
  /** A publicly loadable thumbnail of the asset's first reference image, or null when it has none. */
  imageUrl?: string | null;
  /** Where the artist hands in final files: their My Tasks page. */
  tasksUrl?: string;
  // Admin-toggleable via curation_field_config.includeInArtistEmail (P3-T9) -
  // rendered as extra rows in the brief, with no code change required
  // to add/remove a field from future emails.
  briefFields?: AssignmentEmailBriefField[];
}

// Brief fields shown as the large figures at the top instead of as rows. Budget is left out of the
// rows because the Fee figure already shows the same amount.
const DEADLINE_FIELD_KEY = "deadline";
const FIELD_KEYS_NOT_IN_ROWS: ReadonlySet<string> = new Set([DEADLINE_FIELD_KEY, "budget"]);

export function formatAssignmentEmailSubject(data: { sku: string; itemName: string }): string {
  // Live sheet format: "Meta Fashion Assignment | {SKU} | {Item Name}"
  return `Meta Fashion Assignment | ${data.sku} | ${data.itemName}`;
}

export function renderAssignmentEmailHtml(data: AssignmentEmailData): string {
  const briefFields = data.briefFields || [];
  // The deadline figure appears only when the Deadline brief field is switched on in Curation →
  // Brief Fields, so that switch still controls whether artists see it.
  const deadlineField = briefFields.find((field) => field.key === DEADLINE_FIELD_KEY);
  const stats: EmailDetailRow[] = [
    { label: "Fee", value: formatFee(data.feeAmount, data.currency, "As agreed") },
    ...(deadlineField ? [{ label: deadlineField.displayName, value: deadlineField.value }] : []),
  ];
  const details = briefFields
    .filter((field) => !FIELD_KEYS_NOT_IN_ROWS.has(field.key))
    .map((field) => ({ label: field.displayName, value: field.value }));

  return renderEmailLayout({
    preheader: `The full brief for ${data.itemName}. Reply to this email with questions or WIP.`,
    eyebrow: "Your brief",
    tone: EMAIL_TONE.good,
    title: data.itemName,
    meta: [data.sku, data.category || ""],
    imageUrl: data.imageUrl ?? null,
    stats,
    intro: `Hi ${data.artistName}, this one is yours. Everything you need is below. Reply to this email with questions or work-in-progress updates.`,
    details,
    note: "Please don't upload this to Roblox yourself. Hand in your final files on My Tasks and the team uploads it.",
    button: { label: "Open My Tasks", url: data.tasksUrl || "/artist" },
  });
}
