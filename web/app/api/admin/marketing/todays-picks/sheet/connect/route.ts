import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, TodaysPicksError } from "@/lib/marketing/todays-picks-service";
import { connectTodaysPicksSheet } from "@/lib/marketing/todays-picks-sheet";
import { GOOGLE_SHEET_CLIENT } from "@/lib/marketing/google-sheet-access";

export const dynamic = "force-dynamic";

const ConnectSchema = z.object({ url: z.string().min(1).max(500) });

// GET: the service account's email, which Arjun shares his sheet with. POST: connects the sheet
// once it passes the privacy check.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTodaysPicksOwner(user.email)) return NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 });
  try {
    return NextResponse.json({ serviceAccountEmail: GOOGLE_SHEET_CLIENT.serviceAccountEmail() });
  } catch {
    return NextResponse.json({ serviceAccountEmail: null });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTodaysPicksOwner(user.email)) return NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 });
  const body = ConnectSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Paste the sheet's link" }, { status: 400 });
  try {
    return NextResponse.json(await connectTodaysPicksSheet(body.data.url, user.personnelId ?? null));
  } catch (error) {
    if (error instanceof TodaysPicksError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't open the sheet" }, { status: 502 });
  }
}
