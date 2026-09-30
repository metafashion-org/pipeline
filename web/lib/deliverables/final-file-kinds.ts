/**
 * The kinds of file an artist hands in with an asset's final files, and the rules for each. They
 * follow the "3D Art Submission Form" Google Form this replaces, so artists' habits carry over.
 *
 * No database imports: the Submit final files page checks a file the moment it's added, and the
 * upload routes check the same rules again on the server.
 */
export const FINAL_FILE_KINDS = ["images", "model_zip", "motion_pack"] as const;
export type FinalFileKind = (typeof FINAL_FILE_KINDS)[number];

const BYTES_PER_MB = 1024 * 1024;
// The Google Form's limits.
const MAX_IMAGE_BYTES = 10 * BYTES_PER_MB;
const MAX_ZIP_BYTES = 100 * BYTES_PER_MB;
const MAX_IMAGES = 5;

export interface FinalFileRule {
  label: string;
  maxFiles: number;
  maxBytes: number;
  /** Allowed extensions, lowercase, with the dot. */
  extensions: string[];
  /** The file picker's accept attribute. */
  accept: string;
}

export const FINAL_FILE_RULES: Record<FinalFileKind, FinalFileRule> = {
  images: {
    label: "Asset images",
    maxFiles: MAX_IMAGES,
    maxBytes: MAX_IMAGE_BYTES,
    extensions: [".jpg", ".jpeg", ".png"],
    accept: "image/jpeg,image/png,.jpg,.jpeg,.png",
  },
  model_zip: {
    label: "3D files (.zip)",
    maxFiles: 1,
    maxBytes: MAX_ZIP_BYTES,
    extensions: [".zip"],
    accept: ".zip,application/zip",
  },
  motion_pack: {
    label: "Motion pack (.zip)",
    maxFiles: 1,
    maxBytes: MAX_ZIP_BYTES,
    extensions: [".zip"],
    accept: ".zip,application/zip",
  },
};

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

/**
 * Why one file can't go in this slot, or null when it can.
 *
 * Input: the slot, the file's name and size. Output: a sentence naming the file and the problem.
 */
export function checkFinalFile(kind: FinalFileKind, fileName: string, sizeBytes: number): string | null {
  const rule = FINAL_FILE_RULES[kind];
  const lowerName = fileName.toLowerCase();
  if (!rule.extensions.some((ext) => lowerName.endsWith(ext))) {
    return `${fileName} can't go in ${rule.label}: it has to be ${rule.extensions.join(", ")}.`;
  }
  if (sizeBytes > rule.maxBytes) {
    return `${fileName} is over the ${formatMegabytes(rule.maxBytes)} limit for ${rule.label}.`;
  }
  return null;
}

/**
 * Why a whole submission can't be handed in, or null when it can: at least one image, the 3D files
 * .zip or a motion pack .zip, and no more files in a slot than it takes.
 */
export function checkSubmission(files: { kind: FinalFileKind }[]): string | null {
  for (const kind of FINAL_FILE_KINDS) {
    const count = files.filter((f) => f.kind === kind).length;
    const { maxFiles, label } = FINAL_FILE_RULES[kind];
    if (count > maxFiles) return `${label} takes ${maxFiles === 1 ? "one file" : `up to ${maxFiles} files`}.`;
  }
  if (!files.some((f) => f.kind === "images")) return "Add at least one image of the asset.";
  if (!files.some((f) => f.kind === "model_zip" || f.kind === "motion_pack")) {
    return "Add the 3D files .zip, or a motion pack .zip.";
  }
  return null;
}
