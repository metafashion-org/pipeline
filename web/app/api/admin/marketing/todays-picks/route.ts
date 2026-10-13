import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, listTodaysPicksPreview } from "@/lib/marketing/todays-picks-service";
import { getTodaysPicksSheet } from "@/lib/marketing/todays-picks-sheet";
import { nominationSummaries } from "@/lib/marketing/nomination-service";

export const dynamic = "force-dynamic";

// The Today's Picks preview: live SKUs, their listings with thumbnails and Roblox checks, and the
// private sheet's link. Arjun's own workflow: his account only, not every admin.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTodaysPicksOwner(user.email)) return NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 });
  const [items, sheet, nominations] = await Promise.all([listTodaysPicksPreview(), getTodaysPicksSheet(), nominationSummaries()]);
  return NextResponse.json({ items, sheetUrl: sheet?.url ?? null, nominations: Object.fromEntries(nominations) });
}
