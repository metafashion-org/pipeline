import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale } from "@/lib/publisher/on-sale-service";
import { syncTodaysPicksSheet } from "@/lib/marketing/todays-picks-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Writes the preview into the private Today's Picks sheet, making it on the first run.
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun syncs the Today's Picks sheet" }, { status: 403 });
  try {
    return NextResponse.json(await syncTodaysPicksSheet(user.personnelId ?? null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheet sync failed" }, { status: 502 });
  }
}
