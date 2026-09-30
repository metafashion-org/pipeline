import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { createTeamTask } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;
const MAX_NOTES_CHARS = 20_000;

const NewTaskSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  area: z.string().min(1),
  ownerId: z.uuid(),
  dueOn: z.string().regex(DAY_PATTERN).nullable().optional(),
  notes: z.string().max(MAX_NOTES_CHARS).nullable().optional(),
  helperIds: z.array(z.uuid()).optional(),
  targetCount: z.number().int().positive().nullable().optional(),
  addToToday: z.boolean().optional(),
  artifactIds: z.array(z.uuid()).optional(),
  assetIds: z.array(z.uuid()).optional(),
});

/** Makes a task. Anyone on the team can make one and give it to anyone else on the team. */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const parsed = NewTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the task a title, an owner and what kind of task it is" }, { status: 400 });

  try {
    const id = await createTeamTask(parsed.data, teamDay(new Date()), user.personnelId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
