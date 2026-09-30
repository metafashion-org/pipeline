import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getTeamBoard } from "@/lib/team-tasks/team-board";
import { makeRecurringTasksFor } from "@/lib/team-tasks/recurring-service";
import { listTeamNotifications } from "@/lib/team-tasks/team-notifications";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

/**
 * The Team Tasks board: the full-time team, open tasks, today's finished ones and today's plans,
 * plus the caller's unread notification count. Makes today's repeating tasks first, in case the
 * morning cron hasn't run yet; that is a no-op once they exist.
 */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const today = teamDay(new Date());
  await makeRecurringTasksFor(today);
  const [board, notifications] = await Promise.all([
    getTeamBoard(today),
    user.personnelId ? listTeamNotifications(user.personnelId) : Promise.resolve({ unread: 0 }),
  ]);
  return NextResponse.json({ ...board, viewerId: user.personnelId ?? null, unread: notifications.unread });
}
