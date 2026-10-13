import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, TodaysPicksError } from "@/lib/marketing/todays-picks-service";
import { syncTodaysPicksSheet } from "@/lib/marketing/todays-picks-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Writes the preview into Arjun's connected sheet, after checking it's still private.
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTodaysPicksOwner(user.email)) return NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 });
  try {
    return NextResponse.json(await syncTodaysPicksSheet(user.personnelId ?? null));
  } catch (error) {
    if (error instanceof TodaysPicksError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheet sync failed" }, { status: 502 });
  }
}
