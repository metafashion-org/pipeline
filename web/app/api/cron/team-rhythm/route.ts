import { NextResponse } from "next/server";
import { sendDailySummary } from "@/lib/team-tasks/daily-summary";
import { sendEodReminderIfDue, teamMinutesNow } from "@/lib/team-tasks/eod-service";
import { syncTaskSheet } from "@/lib/team-tasks/sheet-intake";
import { teamDay } from "@/lib/team-tasks/task-rules";
import { getTeamRhythm, minutesOf } from "@/lib/team-tasks/team-rhythm";

export const dynamic = "force-dynamic";

// Called every 15 minutes in the evening by .github/workflows/team-rhythm.yml. Sends the EOD
// reminder and then the evening summary once each is due, at the times set in Settings.
//
// Like /api/cron/artist-nudges, it needs no sign-in or secret, by Arjun's choice. An anonymous call
// can only do what the schedule does: each step goes out once a day and only after its time, and
// the response holds nothing but names already posted to #office.
export async function GET() {
  const now = new Date();
  const rhythm = await getTeamRhythm();
  const reminder = await sendEodReminderIfDue(now);

  let summary: { sent: boolean; people: number } = { sent: false, people: 0 };
  if (teamMinutesNow(now) >= minutesOf(rhythm.summaryTime)) {
    // Adds any rows still waiting in Instinct's task sheet, so the summary includes them.
    await syncTaskSheet({ force: true }).catch((error) => console.error("[task sheet] sync failed:", error));
    summary = await sendDailySummary(teamDay(now), now);
  }
  return NextResponse.json({ reminder: { sent: reminder.sent, reminded: reminder.reminded.length }, summary });
}
