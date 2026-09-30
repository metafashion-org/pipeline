import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canManageKnowledge } from "@/lib/auth/rbac";
import { isConfigured, uploadRecolorKitImage, uploadRegistryFile } from "@/lib/assets/drive-upload";

export const dynamic = "force-dynamic";

// Vercel caps a function's request body under 10MB, so this gives a clearer error first. Same limit
// as the curation and board reference uploads.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const BYTES_PER_MB = 1024 * 1024;
// The form field that names a recolor kit. When present, the file goes in that kit's own folder.
const KIT_NAME_FIELD = "kitName";
const MAX_KIT_NAME_CHARS = 200;

/**
 * Uploads one file from the Registry's New Artifact form into Drive and returns its link. A file
 * sent with a kit name goes into that recolor kit's own folder, and the response also carries the
 * folder's link; anything else goes into the shared Registry folder.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageKnowledge(user.caps)) return NextResponse.json({ error: "You don't have permission to add to the Registry" }, { status: 403 });
  if (!isConfigured()) {
    return NextResponse.json({ error: "Drive upload isn't set up on this deployment. Paste a link instead." }, { status: 503 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File is too large (max ${Math.floor(MAX_UPLOAD_BYTES / BYTES_PER_MB)}MB). Paste a Drive link instead.` }, { status: 400 });
  }
  const kitNameValue = formData?.get(KIT_NAME_FIELD);
  const kitName = typeof kitNameValue === "string" ? kitNameValue.trim().slice(0, MAX_KIT_NAME_CHARS) : "";

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const name = file.name || "registry-file";
    const mimeType = file.type || "application/octet-stream";
    if (kitName) {
      const uploaded = await uploadRecolorKitImage(kitName, name, mimeType, bytes);
      return NextResponse.json({ url: uploaded.url, name, folderUrl: uploaded.folderUrl });
    }
    const uploaded = await uploadRegistryFile(name, mimeType, bytes);
    return NextResponse.json({ url: uploaded.url, name });
  } catch (error: unknown) {
    console.error("Registry upload failed:", error);
    return NextResponse.json({ error: errorMessage(error, "Upload failed") }, { status: 500 });
  }
}
