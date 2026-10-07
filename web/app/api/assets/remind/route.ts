import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { sendReminders } from "@/lib/notifications/reminders";

const MAX_SKUS_PER_REMINDER = 50;
const RemindSchema = z.object({ skus: z.array(z.string().min(1)).min(1).max(MAX_SKUS_PER_REMINDER) });

// Sends the waiting person a reminder for each card: the artist on Discord and email for an Approved
// card, the uploaders for a Ready for Upload card. The team only, same as assigning artists.
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Only the team sends reminders" }, { status: 403 });
  const body = RemindSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Pick the cards to remind about" }, { status: 400 });
  return NextResponse.json({ results: await sendReminders(body.data.skus) });
}
