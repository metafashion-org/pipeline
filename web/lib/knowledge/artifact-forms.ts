import { z } from "zod";

// Which fields the Registry's New Artifact form shows for each artifact type, and where each value
// is stored. The form, the artifact's detail sheet and the server's validation
// (parseArtifactSubmission below) all read this, so a type asks for, shows and accepts the same
// fields everywhere. Imported by client components, so nothing here touches the database.

/** The Trend Brief type's prefix: the only type a moodboard or recolor kit can name as its trend. */
export const TREND_BRIEF_PREFIX = "TR";

/** How a field is entered and shown. */
export type ArtifactFieldKind =
  | "text"
  | "textarea"
  | "link"
  | "date"
  | "category"
  | "trend"
  | "tags"
  | "files"
  | "recolorFolder";

/** The artifact column a field's value is saved in, or "details" for the per-type jsonb. */
export type ArtifactFieldColumn =
  | "title"
  | "description"
  | "source"
  | "fileUrl"
  | "usageNotes"
  | "tags"
  | "category"
  | "trendArtifactId"
  | "details";

export interface ArtifactFormField {
  /** Unique within the type. For a "details" field it is also the key inside details. */
  key: string;
  column: ArtifactFieldColumn;
  kind: ArtifactFieldKind;
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** "link" only: a file can be uploaded instead of pasting a link. */
  uploadable?: boolean;
  /** "files" only: each file gets a note saying what it is. */
  withNotes?: boolean;
}

export interface ArtifactForm {
  /** artifact_type_config.prefix */
  prefix: string;
  /** One line under the type's name in the type picker. */
  summary: string;
  fields: ArtifactFormField[];
}

/** One uploaded or linked file inside details, e.g. an insight's screenshot or a prompt's input image. */
export interface ArtifactFile {
  url: string;
  name: string;
  note?: string;
}

// Shared field definitions, so the same field reads the same way on every type that has it.
const TITLE_FIELD: ArtifactFormField = { key: "title", column: "title", kind: "text", label: "Title", required: true };
const DOC_LINK_FIELD: ArtifactFormField = {
  key: "fileUrl",
  column: "fileUrl",
  kind: "link",
  label: "Doc link",
  required: true,
  placeholder: "https://docs.google.com/...",
};

/** The forms, in the order the type picker lists them. */
export const ARTIFACT_FORMS: ArtifactForm[] = [
  {
    prefix: "INS",
    summary: "Something we noticed, with proof: a platform change, a buyer pattern, a competitor move.",
    fields: [
      { ...TITLE_FIELD, label: "Headline", placeholder: "e.g. Emissive items can now be sold" },
      { key: "description", column: "description", kind: "textarea", label: "The insight", required: true, help: "What happened, in your own words." },
      { key: "seenOn", column: "details", kind: "date", label: "Date seen" },
      { key: "fileUrl", column: "fileUrl", kind: "link", label: "Proof link", placeholder: "Announcement, post, sheet or screenshot link" },
      { key: "attachments", column: "details", kind: "files", label: "Images or files", help: "Screenshots or anything that explains it." },
      { key: "usageNotes", column: "usageNotes", kind: "textarea", label: "What we should do", placeholder: "e.g. Test glow accents on two items first" },
    ],
  },
  {
    prefix: TREND_BRIEF_PREFIX,
    summary: "A trend we make assets for, like Christmas.",
    fields: [
      { ...TITLE_FIELD, label: "Trend name", placeholder: "e.g. Christmas 2026" },
      { key: "season", column: "details", kind: "text", label: "Season or drop", placeholder: "e.g. November to December" },
      { key: "description", column: "description", kind: "textarea", label: "What the trend is" },
      { key: "fileUrl", column: "fileUrl", kind: "link", label: "Brief link", uploadable: true, placeholder: "Doc, sheet or deck" },
    ],
  },
  {
    prefix: "MBD",
    summary: "A Pinterest board, tied to the trend it came from.",
    fields: [
      { ...TITLE_FIELD, label: "Board name" },
      { key: "fileUrl", column: "fileUrl", kind: "link", label: "Pinterest link", required: true, placeholder: "https://pinterest.com/..." },
      { key: "trendArtifactId", column: "trendArtifactId", kind: "trend", label: "Trend it came from" },
    ],
  },
  {
    prefix: "RK",
    summary: "A Drive folder of recolour images.",
    fields: [
      { ...TITLE_FIELD, label: "Kit name", help: "Uploaded images go in a Drive folder with this name." },
      {
        key: "fileUrl",
        column: "fileUrl",
        kind: "recolorFolder",
        label: "Folder",
        required: true,
        help: "Paste the Drive folder link, or drop the images here and the folder is made for you.",
      },
      { key: "trendArtifactId", column: "trendArtifactId", kind: "trend", label: "Trend" },
    ],
  },
  {
    prefix: "PRM",
    summary: "A prompt that worked: the text, the chat, what went in and what came out.",
    fields: [
      { ...TITLE_FIELD, label: "Prompt name" },
      { key: "description", column: "description", kind: "textarea", label: "Prompt text", required: true },
      { key: "chatLink", column: "details", kind: "link", label: "Chat link", placeholder: "ChatGPT or Claude conversation link" },
      {
        key: "inputs",
        column: "details",
        kind: "files",
        label: "Files that went in",
        withNotes: true,
        help: "Each image or file you gave it, with a note on what it is.",
      },
      { key: "fileUrl", column: "fileUrl", kind: "link", label: "Output link", uploadable: true },
    ],
  },
  {
    prefix: "ANA",
    summary: "Findings from a sheet, doc, PDF or AI chat, and when to use them.",
    fields: [
      TITLE_FIELD,
      { key: "fileUrl", column: "fileUrl", kind: "link", label: "Link or file", required: true, uploadable: true, placeholder: "Sheet, doc, PDF or chat link" },
      { key: "description", column: "description", kind: "textarea", label: "Key findings" },
      { key: "usageNotes", column: "usageNotes", kind: "textarea", label: "When to use it" },
    ],
  },
  {
    prefix: "TG",
    summary: "A Google Doc of rules artists follow for a category.",
    fields: [
      TITLE_FIELD,
      DOC_LINK_FIELD,
      { key: "category", column: "category", kind: "category", label: "Applies to", help: "Artists see it in the checklist for this category." },
      { key: "usageNotes", column: "usageNotes", kind: "textarea", label: "Usage notes" },
    ],
  },
  {
    prefix: "CD",
    summary: "A doc: its title and link.",
    fields: [TITLE_FIELD, DOC_LINK_FIELD],
  },
];

// For a type added in Settings that has no form above.
const FALLBACK_FIELDS: ArtifactFormField[] = [
  TITLE_FIELD,
  { key: "description", column: "description", kind: "textarea", label: "Description" },
  { key: "fileUrl", column: "fileUrl", kind: "link", label: "Link", uploadable: true },
  { key: "usageNotes", column: "usageNotes", kind: "textarea", label: "Usage notes" },
  { key: "tags", column: "tags", kind: "tags", label: "Tags", placeholder: "comma, separated" },
];

/** The form for a type prefix, or a short general one for a type with no form of its own. */
export function formForPrefix(prefix: string): ArtifactForm {
  return ARTIFACT_FORMS.find((form) => form.prefix === prefix) ?? { prefix, summary: "", fields: FALLBACK_FIELDS };
}

// Upper bounds on what one submission can carry, so a pasted file or a runaway list is refused
// with a message instead of stored.
const MAX_SHORT_TEXT_CHARS = 300;
const MAX_LONG_TEXT_CHARS = 20_000;
const MAX_URL_CHARS = 2_000;
const MAX_FILES_PER_FIELD = 30;
const MAX_TAGS = 30;

const httpUrl = z
  .string()
  .trim()
  .max(MAX_URL_CHARS)
  .refine((value) => /^https?:\/\/\S+$/i.test(value), "must be a link starting with http:// or https://");

const fileEntry = z.object({
  url: httpUrl,
  name: z.string().trim().min(1).max(MAX_SHORT_TEXT_CHARS),
  note: z.string().trim().max(MAX_LONG_TEXT_CHARS).optional(),
});

// The validator for one field's value, by kind.
function valueSchema(field: ArtifactFormField): z.ZodType<unknown> {
  switch (field.kind) {
    case "text":
    case "category":
      return z.string().trim().max(MAX_SHORT_TEXT_CHARS);
    case "textarea":
      return z.string().trim().max(MAX_LONG_TEXT_CHARS);
    case "link":
    case "recolorFolder":
      return httpUrl;
    case "date":
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date");
    case "trend":
      return z.uuid("must be a trend brief from the list");
    case "tags":
      return z.array(z.string().trim().min(1).max(MAX_SHORT_TEXT_CHARS)).max(MAX_TAGS);
    case "files":
      return z.array(fileEntry).max(MAX_FILES_PER_FIELD);
  }
}

// Empty strings and empty lists count as "not filled in".
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** A validated submission, split into the artifact's columns and its details. */
export interface ParsedArtifactSubmission {
  title: string;
  description?: string;
  source?: string;
  fileUrl?: string;
  usageNotes?: string;
  tags?: string[];
  category?: string;
  trendArtifactId?: string;
  details: Record<string, unknown>;
}

export type ArtifactSubmissionResult = { ok: true; submission: ParsedArtifactSubmission } | { ok: false; error: string };

/**
 * Checks a New Artifact submission against its type's form and sorts each value into its column
 * or into details. Fields the type doesn't have are dropped.
 *
 * Input: the type's form and the submitted values keyed by field key. Output: the parsed
 * submission, or an error naming the first field that is missing or invalid.
 */
export function parseArtifactSubmission(form: ArtifactForm, values: Record<string, unknown>): ArtifactSubmissionResult {
  const submission: ParsedArtifactSubmission = { title: "", details: {} };
  for (const field of form.fields) {
    const raw = values[field.key];
    if (isEmpty(raw)) {
      if (field.required) return { ok: false, error: `${field.label} is required` };
      continue;
    }
    const parsed = valueSchema(field).safeParse(raw);
    if (!parsed.success) return { ok: false, error: `${field.label} ${parsed.error.issues[0]?.message ?? "is not valid"}` };
    if (field.column === "details") submission.details[field.key] = parsed.data;
    else Object.assign(submission, { [field.column]: parsed.data });
  }
  if (!submission.title) return { ok: false, error: "Title is required" };
  return { ok: true, submission };
}
