import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { updateTeamTask } from "@/lib/team-tasks/team-tasks-service";
import { getTeamTaskDetail } from "@/lib/team-tasks/team-board";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;
const MAX_TEXT_CHARS = 20_000;
const TaskIdSchema = z.uuid();

const TaskPatchSchema = z.object({
  title: z.string().max(MAX_TITLE_CHARS).optional(),
  notes: z.string().max(MAX_TEXT_CHARS).nullable().optional(),
  area: z.string().optional(),
  status: z.string().optional(),
  waitingOn: z.string().max(MAX_TITLE_CHARS).nullable().optional(),
  ownerId: z.uuid().optional(),
  dueOn: z.string().regex(DAY_PATTERN).nullable().optional(),
  targetCount: z.number().int().positive().nullable().optional(),
  doneCount: z.number().int().min(0).optional(),
  helperIds: z.array(z.uuid()).optional(),
  isPrivate: z.boolean().optional(),
});

/** One task in full: checklist, links, comments, history, and who planned it for today. */
export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!TaskIdSchema.safeParse(taskId).success) return NextResponse.json({ error: "Unknown task" }, { status: 404 });

  try {
    return NextResponse.json(await getTeamTaskDetail(taskId, teamDay(new Date()), user.personnelId ?? null));
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}

/** Changes a task: its text, status, owner, helpers, due day, area, or count. */
export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!TaskIdSchema.safeParse(taskId).success) return NextResponse.json({ error: "Unknown task" }, { status: 404 });

  const parsed = TaskPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That change isn't valid" }, { status: 400 });

  try {
    await updateTeamTask(taskId, parsed.data, teamDay(new Date()), user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
