import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canHandleArtistPayDetails } from "@/lib/auth/rbac";
import { listArtistDetailsForTeam } from "@/lib/artist-details/details-service";

export const dynamic = "force-dynamic";

/** Every Active artist and where their details stand, with numbers masked. For the people who pay artists. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canHandleArtistPayDetails(user.caps)) return NextResponse.json({ error: "Only the people who pay artists can see this" }, { status: 403 });
  return NextResponse.json({ artists: await listArtistDetailsForTeam() });
}
