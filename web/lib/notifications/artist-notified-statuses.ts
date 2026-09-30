/**
 * The statuses an asset's artist is told about when their card moves into them: Approved (hand in
 * the final files) and Revisions Requested (make the changes, then send it back for review). No
 * database imports, so the asset drawer can check it too.
 */
export const ARTIST_NOTIFIED_STATUSES = ["approved", "revisions_requested"] as const;
export type ArtistNotifiedStatus = (typeof ARTIST_NOTIFIED_STATUSES)[number];

export function isArtistNotifiedStatus(status: string): status is ArtistNotifiedStatus {
  return (ARTIST_NOTIFIED_STATUSES as readonly string[]).includes(status);
}
