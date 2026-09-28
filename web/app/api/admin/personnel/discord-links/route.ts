import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { linkMissingArtistChannels } from "@/lib/discord/artist-channel";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

/**
 * Finds and saves the Discord channel of every Active artist who has none saved.
 * Output: { linked: [{ name, channelId }], missing: [{ name, reason }] }.
 */
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManagePersonnel) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const report = await linkMissingArtistChannels();
  if (report.linked.length > 0) revalidateViews(CACHE_TAGS.personnel);
  return NextResponse.json(report);
}
