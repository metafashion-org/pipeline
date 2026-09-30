import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { errorMessage } from "@/lib/errors";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { getOrCreateFinalFilesFolder, listFilesInFolder, shareFinalFile } from "@/lib/assets/drive-upload";
import {
  getFinalFilesForAsset,
  nextFinalFilesVersion,
  submitFinalFiles,
  type FinalFileInput,
} from "@/lib/deliverables/deliverables-service";
import { canSubmitFinalFiles, canViewFinalFiles, findAssetForFinalFiles } from "@/lib/deliverables/final-files-access";
import { FINAL_FILE_KINDS, checkFinalFile, checkSubmission } from "@/lib/deliverables/final-file-kinds";

export const dynamic = "force-dynamic";

// An asset's final-files submissions, newest first, for its drawer and the uploader.
export async function GET(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const asset = await findAssetForFinalFiles(skuId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (!canViewFinalFiles(user, asset)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ submissions: await getFinalFilesForAsset(asset.id) });
}

// Long enough for the form's "Your comments": issues faced, resubmission, improvements, logo changes.
const MAX_COMMENT_CHARS = 2000;

const SubmitSchema = z.object({
  version: z.number().int().positive(),
  // The files the browser uploaded, each with the form slot it was uploaded in. Only these are
  // recorded, so a file left behind by an earlier upload abandoned halfway isn't handed in by mistake.
  files: z.array(z.object({ name: z.string().trim().min(1), kind: z.enum(FINAL_FILE_KINDS) })).min(1),
  comments: z.string().trim().max(MAX_COMMENT_CHARS).optional(),
});

/**
 * Hands in a final-files submission once the browser has uploaded its files to Drive.
 *
 * The files are read back from the submission's own Drive folder rather than trusted from the
 * browser, so what is recorded is what actually arrived. Each is shared like a reference (domain
 * can edit, anyone with the link can view), recorded, and the asset moves to Ready for Upload.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const asset = await findAssetForFinalFiles(skuId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (!canSubmitFinalFiles(user, asset)) {
    return NextResponse.json({ error: "Only the asset's artist, or the team, can hand in its final files" }, { status: 403 });
  }

  const parsed = SubmitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nothing to hand in" }, { status: 400 });
  const { version, files: requested, comments } = parsed.data;
  const shapeProblem = checkSubmission(requested);
  if (shapeProblem) return NextResponse.json({ error: shapeProblem }, { status: 400 });

  // The version has to be the one this submission was started under, or a second submission
  // racing this one could claim the same folder.
  if (version !== (await nextFinalFilesVersion(asset.id))) {
    return NextResponse.json({ error: "This submission is out of date. Upload the files again." }, { status: 409 });
  }

  try {
    const folderId = await getOrCreateFinalFilesFolder(asset.sku, version);
    const inFolder = await listFilesInFolder(folderId);

    // Newest first, so a file uploaded twice under one name records the later copy.
    const files: FinalFileInput[] = [];
    const missing: string[] = [];
    const kindByName = new Map(requested.map((f) => [f.name, f.kind]));
    for (const [name, kind] of kindByName) {
      const match = inFolder.find((f) => f.name === name);
      if (!match) {
        missing.push(name);
        continue;
      }
      // Checked again against what actually reached Drive, not only what the browser said.
      const fileProblem = checkFinalFile(kind, match.name, match.sizeBytes ?? 0);
      if (fileProblem) return NextResponse.json({ error: fileProblem }, { status: 400 });
      files.push({
        kind,
        fileName: match.name,
        mimeType: match.mimeType,
        sizeBytes: match.sizeBytes,
        driveFileId: match.id,
        driveUrl: match.url,
        driveFolderId: folderId,
      });
    }
    if (missing.length > 0) {
      return NextResponse.json({ error: `These didn't finish uploading: ${missing.join(", ")}` }, { status: 409 });
    }

    await Promise.all(files.map((f) => shareFinalFile(f.driveFileId)));
    const result = await submitFinalFiles(asset.sku, version, files, user.personnelId, comments);
    revalidateViews(CACHE_TAGS.publisherQueue);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Final files submission failed:", error);
    return NextResponse.json({ error: errorMessage(error, "Failed to hand in the final files") }, { status: 400 });
  }
}
