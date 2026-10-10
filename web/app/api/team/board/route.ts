import { NextResponse, after } from "next/server";
import { syncTaskSheet } from "@/lib/team-tasks/sheet-intake";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getTeamBoard } from "@/lib/team-tasks/team-board";
import { makeRecurringTasksOnce } from "@/lib/team-tasks/recurring-service";
import { listTeamNotifications } from "@/lib/team-tasks/team-notifications";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay } from "@/lib/team-tasks/task-rules";
import { getTeamRhythm, planDays } from "@/lib/team-tasks/team-rhythm";
import { listEods } from "@/lib/team-tasks/eod-service";

export const dynamic = "force-dynamic";

/**
 * The Team Tasks board: the full-time team, open tasks, today's finished ones and the plans for one
 * day (?planDay=YYYY-MM-DD, today by default, up to the plan-ahead days set in Settings), plus the
 * days that can be planned, who has sent today's EOD, and the caller's unread notification count.
 * Makes today's repeating tasks first, in case the morning cron hasn't run yet; that is a no-op
 * once they exist.
 */
export async function GET(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const today = teamDay(new Date());
  await makeRecurringTasksOnce(today);
  const rhythm = await getTeamRhythm();
  const days = planDays(today, rhythm);
  const requested = new URL(request.url).searchParams.get("planDay");
  // A day outside the plan-ahead window falls back to today rather than erroring.
  const planDay = requested && days.includes(requested) ? requested : today;
  const [board, notifications, eods] = await Promise.all([
    getTeamBoard(today, user.personnelId ?? null, planDay),
    user.personnelId ? listTeamNotifications(user.personnelId) : Promise.resolve({ unread: 0 }),
    listEods(today),
  ]);
  // Picks up rows Instinct wrote in the task sheet after this response is sent, at most once a
  // minute; Vercel's plan only runs scheduled jobs daily, so board loads are what keep it current.
  after(() => syncTaskSheet().catch((error) => console.error("[task sheet] sync failed:", error)));
  return NextResponse.json({
    ...board,
    planDays: days,
    eodSentIds: [...eods.keys()],
    eodDueTime: rhythm.eodDueTime,
    viewerId: user.personnelId ?? null,
    unread: notifications.unread,
  });
}
