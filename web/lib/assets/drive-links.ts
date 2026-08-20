/**
 * Parses the `assets.reference_images` / `assets.recolor_reference_images` JSONB columns into links the UI can render.
 *
 * Those columns hold `[{ provider, externalId }]`, but `externalId` is not a clean single value: the Google Sheet import (lib/db/import-sheet-data.ts) copied whole spreadsheet cells verbatim, so in the live database one `externalId` can be a single Drive URL, several Drive URLs joined by commas, or free text that is not a link at all ("Will share as we work!").
 *
 * Input: the raw JSONB value, of unknown shape.
 * Output: one DriveRef per usable URL found, in order, deduplicated by URL. `fileId` is set when a Drive file id could be extracted, meaning the file can be shown as an image; it is null for anything else (a Drive folder, a non-Drive link), which the UI should render as a plain link instead. Free text yields no refs at all.
 */
export interface DriveRef {
  url: string;
  fileId: string | null;
}

// Drive file ids appear in three link shapes: ?id=<id> / &id=<id> (the "open?id=" and "uc?id=" forms), and /file/d/<id>/view.
// Folder links (/drive/folders/<id>) deliberately match none of these, so they fall through as link-only refs.
const FILE_ID_PATTERNS = [
  /[?&]id=([A-Za-z0-9_-]{10,})/,
  /\/file\/d\/([A-Za-z0-9_-]{10,})/,
];

export function extractDriveFileId(url: string): string | null {
  for (const pattern of FILE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function parseDriveRefs(rawValue: unknown): DriveRef[] {
  if (!Array.isArray(rawValue)) return [];

  const refs: DriveRef[] = [];
  const seen = new Set<string>();

  for (const entry of rawValue) {
    const externalId =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { externalId?: unknown }).externalId === "string"
          ? (entry as { externalId: string }).externalId
          : null;

    if (!externalId) continue;

    // Split on commas and whitespace so a multi-link cell becomes one ref per link, then keep only the tokens that are actually URLs.
    for (const token of externalId.split(/[\s,]+/)) {
      const url = token.trim().replace(/[.,)]+$/, "");
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      refs.push({ url, fileId: extractDriveFileId(url) });
    }
  }

  return refs;
}

/**
 * Builds a thumbnail URL for a Drive file.
 * The pipeline's reference files are link-shared, so this endpoint serves them without any credentials - no service account, no OAuth scope, no server-side proxying.
 * Input: a Drive file id and the desired width in pixels. Output: a URL usable directly as an <img> src.
 */
export function driveThumbnailUrl(fileId: string, width = 640): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
}
