import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { errorMessage } from "@/lib/errors";
import { isConfigured, getOrCreateFinalFilesFolder, startResumableUpload } from "@/lib/assets/drive-upload";
import { FINAL_FILES_ACCEPTED_FROM_STATUS, nextFinalFilesVersion } from "@/lib/deliverables/deliverables-service";
import { canSubmitFinalFiles, findAssetForFinalFiles } from "@/lib/deliverables/final-files-access";

export const dynamic = "force-dynamic";

// The largest single final file accepted. Drive itself takes far more; this stops an accidental
// multi-gigabyte drop from sitting in the uploader's folder.
const MAX_FINAL_FILE_BYTES = 5 * 1024 * 1024 * 1024;

const SessionSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.number().int().positive(),
});

/**
 * Opens a Drive upload session for one final file and returns its upload URL, which the browser
 * sends the file to directly (see startResumableUpload for why the bytes don't come through here).
 * Also returns the version this submission is filed under, so the browser can finish it with
 * POST ../final-files.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const asset = await findAssetForFinalFiles(skuId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (!canSubmitFinalFiles(user, asset)) {
    return NextResponse.json({ error: "Only the asset's artist, or the team, can hand in its final files" }, { status: 403 });
  }
  if (asset.currentStatus !== FINAL_FILES_ACCEPTED_FROM_STATUS) {
    return NextResponse.json({ error: "Final files can only be handed in once the design is Approved" }, { status: 409 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Drive isn't set up on this deployment yet" }, { status: 503 });
  }

  const parsed = SessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Missing file details" }, { status: 400 });
  if (parsed.data.sizeBytes > MAX_FINAL_FILE_BYTES) {
    return NextResponse.json({ error: `${parsed.data.fileName} is over the 5 GB limit` }, { status: 400 });
  }

  // Drive has to answer the browser's upload with CORS headers for this exact origin.
  const origin = request.headers.get("origin") || request.nextUrl.origin;

  try {
    const version = await nextFinalFilesVersion(asset.id);
    const folderId = await getOrCreateFinalFilesFolder(asset.sku, version);
    const uploadUrl = await startResumableUpload(
      folderId,
      parsed.data.fileName,
      parsed.data.mimeType || "application/octet-stream",
      parsed.data.sizeBytes,
      origin
    );
    return NextResponse.json({ uploadUrl, version });
  } catch (error) {
    console.error("Final files upload session failed:", error);
    return NextResponse.json({ error: errorMessage(error, "Couldn't start the upload") }, { status: 502 });
  }
}
