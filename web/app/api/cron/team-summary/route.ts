import { NextRequest, NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { sendDailySummary } from "@/lib/team-tasks/daily-summary";
import { teamDay } from "@/lib/team-tasks/task-rules";
import { syncTaskSheet } from "@/lib/team-tasks/sheet-intake";
import { teamMinutesNow } from "@/lib/team-tasks/eod-service";
import { getTeamRhythm, minutesOf } from "@/lib/team-tasks/team-rhythm";

export const dynamic = "force-dynamic";

// Sends the Team Tasks summary for the day (web/vercel.json runs it at 13:30 UTC, 7 pm in India):
// a post in the office Discord channel and an email to everyone on the full-time team, with each
// person's EOD. It goes out once a day, so a retried run does nothing. The cron call does nothing
// before the summary time set in Settings; /api/cron/team-rhythm then sends it at that time.
//
// Two ways in: Vercel's cron, which sends `Authorization: Bearer $CRON_SECRET`, or a signed-in admin
// sending it by hand. With CRON_SECRET unset the cron path is closed.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isCron = Boolean(ENV.CRON_SECRET) && authHeader === `Bearer ${ENV.CRON_SECRET}`;
  if (!isCron) {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  if (isCron && teamMinutesNow(now) < minutesOf((await getTeamRhythm()).summaryTime)) {
    return NextResponse.json({ sent: false, people: 0, reason: "before the summary time set in Settings" });
  }
  // Adds any rows still waiting in Instinct's task sheet, so the summary includes them.
  await syncTaskSheet({ force: true }).catch((error) => console.error("[task sheet] sync failed:", error));
  const result = await sendDailySummary(teamDay(now), now);
  return NextResponse.json(result);
}
