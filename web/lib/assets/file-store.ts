/**
 * Converts between the pasted-links form fields and the shape the reference columns store.
 *
 * `assets.reference_images` holds `[{ provider, externalId }]` where externalId is a URL. Both the create and edit forms take a pasted block of links, so the parsing lives here rather than being written twice.
 */
export interface FileStoreEntry {
  provider: string;
  externalId: string;
}

/**
 * Input: text containing zero or more URLs separated by commas, newlines, or spaces.
 * Output: one entry per URL, in order, deduplicated, so parseDriveRefs reads them back the same way it reads sheet-imported rows.
 */
export function toFileStoreEntries(raw: string | null | undefined): FileStoreEntry[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const entries: FileStoreEntry[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const url = token.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    entries.push({ provider: url.includes("drive.google.com") ? "drive" : "filestore", externalId: url });
  }
  return entries;
}

/**
 * Turns a stored reference column back into the newline-separated text an edit form shows.
 * Input: the raw JSONB value. Output: one URL per line, or an empty string when there is nothing usable to edit.
 */
export function toLinkText(rawValue: unknown): string {
  if (!Array.isArray(rawValue)) return "";
  const urls: string[] = [];
  for (const entry of rawValue) {
    const externalId =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { externalId?: unknown }).externalId === "string"
          ? (entry as { externalId: string }).externalId
          : null;
    if (!externalId) continue;
    // A single stored cell can hold several comma-joined URLs, a leftover from the spreadsheet import.
    for (const token of externalId.split(/[\s,]+/)) {
      const url = token.trim();
      if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
    }
  }
  return urls.join("\n");
}
