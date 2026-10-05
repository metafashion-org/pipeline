import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listSignoffs } from "@/lib/signoff/signoff-service";
import { signsOff } from "@/lib/signoff/signoff-rules";
import { canAddAssets } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

/** The Sign-off page's list: assets waiting for Arjun and assets sent back. For anyone who can add assets. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAddAssets(user.caps)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({
    items: await listSignoffs(),
    viewerSignsOff: signsOff(user.roles),
    // The team edits any asset; a curator only their own (app/api/assets/[skuId]/route.ts).
    viewerEditsAll: user.caps.canAssignArtists,
    viewerId: user.personnelId ?? null,
  });
}
