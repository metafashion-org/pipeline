import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { uploadCurationFile, isConfigured } from "@/lib/assets/drive-upload";

export const dynamic = "force-dynamic";

// Vercel caps a function's request body under 10MB, so this gives a clearer error first. Same limit
// as the board's reference upload (app/api/assets/reference-upload/route.ts).
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Uploads one picture for an idea on the Curation form into the shared curation folder in Drive,
 * and returns its link. The form adds the link to the idea's reference images, which become the
 * card's pictures once the idea is sent.
 *
 * Open to anyone who can curate. The board's own upload route needs canAssignArtists, which curators
 * don't have.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAccessCuratorTools && !user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "You don't have permission to upload curation pictures" }, { status: 403 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Drive upload isn't set up on this deployment. Paste a link instead." }, { status: 503 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File is too large (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)` }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadCurationFile(file.name || "curation", file.type || "application/octet-stream", bytes);
    return NextResponse.json({ url: result.url });
  } catch (error: unknown) {
    console.error("Curation upload failed:", error);
    return NextResponse.json({ error: errorMessage(error, "Upload failed") }, { status: 500 });
  }
}
