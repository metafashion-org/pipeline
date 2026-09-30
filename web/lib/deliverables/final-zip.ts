/**
 * What an artist hands in with an asset's final files: one .zip holding everything, meaning the
 * images, the FBX, the texture maps and whatever else the asset's brief or linked guidelines ask
 * for. The Submit final files page lists what goes in it for the chosen asset.
 *
 * No database imports: the page checks the file the moment it's added, and the upload routes
 * check it again on the server.
 */

// asset_deliverables.kind for the one .zip. The column stays so a second kind of file can be added
// later without a migration.
export const FINAL_ZIP_KIND = "final_zip";
export type FinalFileKind = typeof FINAL_ZIP_KIND;

const BYTES_PER_MB = 1024 * 1024;
// The Google Form allowed 100 MB for the 3D files alone. The .zip now carries the images as well,
// so it gets more room.
export const MAX_FINAL_ZIP_BYTES = 500 * BYTES_PER_MB;

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

/**
 * Why this file can't be handed in, or null when it can.
 *
 * Input: the file's name and size. Output: a sentence naming the file and the problem.
 */
export function checkFinalZip(fileName: string, sizeBytes: number): string | null {
  if (!fileName.toLowerCase().endsWith(".zip")) {
    return `${fileName} isn't a .zip. Put everything in one .zip file (not .rar) and upload that.`;
  }
  if (sizeBytes > MAX_FINAL_ZIP_BYTES) {
    return `${fileName} is over the ${formatMegabytes(MAX_FINAL_ZIP_BYTES)} limit.`;
  }
  return null;
}
