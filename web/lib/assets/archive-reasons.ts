// Why an asset is archived (taken off the board), as the archive dialog's dropdown offers it. Kept
// out of board-visibility.ts so client components can import it without the database.

export const ARCHIVE_REASONS = [
  "No longer needed",
  "Trend has passed",
  "Duplicate of another asset",
  "Not feasible to make",
  "Low expected demand",
  "Other",
] as const;

/** The reason stored on the asset: the dropdown's choice, plus the note when there is one. */
export function archiveReasonText(reason: string, note: string | null | undefined): string {
  const trimmed = note?.trim();
  return trimmed ? `${reason}: ${trimmed}` : reason;
}
