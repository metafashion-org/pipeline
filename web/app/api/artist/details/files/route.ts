import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isConfigured as isDriveConfigured, uploadArtistDocument } from "@/lib/assets/drive-upload";
import { recordArtistFile } from "@/lib/artist-details/details-service";
import { isArtistDocumentKind } from "@/lib/artist-details/details-rules";
import { personName } from "@/lib/team-tasks/team-members";

export const dynamic = "force-dynamic";

// Vercel caps a request body under 10MB, so this gives a clearer error first.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Uploads one of the caller's documents (Aadhaar, PAN, cheque, resume, agreement). It is kept in
 * their Drive folder, shared with the company only, and as a copy in the database. The response is
 * the stored file, whose id My details saves.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.personnelId) return NextResponse.json({ error: "Your account isn't set up yet" }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || typeof kind !== "string" || !isArtistDocumentKind(kind)) {
    return NextResponse.json({ error: "Choose a file" }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `File is too large (max ${MAX_UPLOAD_BYTES / BYTES_PER_MB}MB)` }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = file.name || `${kind}`;
  const mimeType = file.type || "application/octet-stream";
  let driveUrl: string | null = null;
  if (isDriveConfigured()) {
    try {
      const name = (await personName(user.personnelId)) ?? user.email;
      driveUrl = (await uploadArtistDocument(name, fileName, mimeType, bytes)).url;
    } catch (error) {
      // The database copy is still kept, so a Drive outage doesn't lose the document.
      console.error("[artist details] Drive upload failed:", error);
    }
  }
  const stored = await recordArtistFile({ personnelId: user.personnelId, kind, fileName, mimeType, bytes, driveUrl, uploadedBy: user.personnelId });
  return NextResponse.json({ file: stored });
}
