import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { deleteTeamSubtask, updateTeamSubtask } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;

const SubtaskPatchSchema = z.object({
  title: z.string().max(MAX_TITLE_CHARS).optional(),
  ownerId: z.uuid().nullable().optional(),
  dueOn: z.string().regex(DAY_PATTERN).nullable().optional(),
  done: z.boolean().optional(),
});

/** Ticks, renames, reassigns or re-dates a checklist item. */
export async function PATCH(request: Request, { params }: { params: Promise<{ subtaskId: string }> }) {
  const [{ subtaskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(subtaskId).success) return NextResponse.json({ error: "Unknown subtask" }, { status: 404 });

  const parsed = SubtaskPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That change isn't valid" }, { status: 400 });

  try {
    await updateTeamSubtask(subtaskId, parsed.data, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}

/** Removes a checklist item. The removal is recorded in the task's history. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ subtaskId: string }> }) {
  const [{ subtaskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(subtaskId).success) return NextResponse.json({ error: "Unknown subtask" }, { status: 404 });

  try {
    await deleteTeamSubtask(subtaskId, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
