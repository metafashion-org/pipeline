import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getTeamWeek } from "@/lib/team-tasks/team-board";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay, weekStartOf } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A week of the team's work (?start=YYYY-MM-DD, any day in the week; this week when absent): what
 * each person planned, finished and counted each day.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const requested = request.nextUrl.searchParams.get("start");
  const day = requested && DAY_PATTERN.test(requested) ? requested : teamDay(new Date());
  return NextResponse.json(await getTeamWeek(weekStartOf(day), user.personnelId ?? null));
}
