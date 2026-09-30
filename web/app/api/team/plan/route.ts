import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { setTeamDayPlan } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

const PlanSchema = z.object({
  personnelId: z.uuid(),
  // Today's picks, first to last.
  taskIds: z.array(z.uuid()),
});

/**
 * Sets a person's plan for today: which tasks, in what order. Anyone on the team can set anyone's,
 * so a manager can put something first for someone. Earlier days' plans are kept as they were.
 */
export async function PUT(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const parsed = PlanSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a person and their tasks for today" }, { status: 400 });

  try {
    await setTeamDayPlan(parsed.data.personnelId, teamDay(new Date()), parsed.data.taskIds, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
