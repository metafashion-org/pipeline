import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canHandleArtistPayDetails } from "@/lib/auth/rbac";
import { readArtistFile } from "@/lib/artist-details/details-service";

export const dynamic = "force-dynamic";

/**
 * Shows one of an artist's documents from the app's own copy. Only the artist and the people who pay
 * artists can open it. A document copied from the old form has no copy here and redirects to Drive.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const [{ fileId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!z.uuid().safeParse(fileId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await readArtistFile(fileId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (file.personnelId !== user.personnelId && !canHandleArtistPayDetails(user.caps)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!file.bytes) {
    if (file.driveUrl) return NextResponse.redirect(file.driveUrl);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
      // Identity documents: never cached by a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
