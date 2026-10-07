import { NextResponse } from "next/server";
import { sendArtistStartNudges } from "@/lib/notifications/start-nudges";

export const dynamic = "force-dynamic";

// Emails each artist one check-in on their assets waiting between Assigned and In Production. Called
// at 09:00 and 21:00 India time by .github/workflows/artist-nudges.yml, because Vercel's Hobby plan
// only runs crons once a day.
//
// Like /api/cron/signoff-digest, the scheduled call needs no sign-in or secret, by Arjun's choice.
// That's safe because an anonymous call can only do what the schedule does: sendArtistStartNudges
// sends nothing when it last ran under 10 hours ago, and only to the artists of waiting assets. It
// returns nothing about them.
export async function GET() {
  await sendArtistStartNudges(new Date());
  return NextResponse.json({ ok: true });
}
