import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { setTeamDayPlan } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay } from "@/lib/team-tasks/task-rules";
import { getTeamRhythm, planDays } from "@/lib/team-tasks/team-rhythm";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PlanSchema = z.object({
  // z.guid() rather than z.uuid(), which rejects ids without an RFC version digit, like the e2e
  // fixtures' 11111111-... people.
  personnelId: z.guid(),
  // The day's picks, first to last.
  taskIds: z.array(z.uuid()),
  // The day being planned. Today when left out.
  planOn: z.string().regex(DAY_PATTERN).optional(),
});

/**
 * Sets a person's plan for a day, today or one of the plan-ahead days set in Settings: which tasks,
 * in what order. Anyone on the team can set anyone's, so a manager can put something first for
 * someone. Earlier days' plans are kept as they were.
 */
export async function PUT(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const parsed = PlanSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a person and their tasks for the day" }, { status: 400 });

  const today = teamDay(new Date());
  const planOn = parsed.data.planOn ?? today;
  if (!planDays(today, await getTeamRhythm()).includes(planOn)) {
    return NextResponse.json({ error: "That day can't be planned yet. Settings sets how far ahead people plan." }, { status: 400 });
  }

  try {
    await setTeamDayPlan(parsed.data.personnelId, planOn, parsed.data.taskIds, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
