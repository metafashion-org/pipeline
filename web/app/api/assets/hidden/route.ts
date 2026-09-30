import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listHiddenAssets } from "@/lib/assets/board-visibility";

export const dynamic = "force-dynamic";

/** The cards the team took off the board, for the board's Hidden cards list. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Only the team can see hidden cards" }, { status: 403 });

  return NextResponse.json({ hidden: await listHiddenAssets() });
}
