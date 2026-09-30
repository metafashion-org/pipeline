import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addTeamSubtask } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;

const SubtaskSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  ownerId: z.uuid().nullable().optional(),
  dueOn: z.string().regex(DAY_PATTERN).nullable().optional(),
});

/** Adds an item to a task's checklist, optionally with its own owner and due day. */
export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Unknown task" }, { status: 404 });

  const parsed = SubtaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the subtask a title" }, { status: 400 });

  try {
    const id = await addTeamSubtask(taskId, parsed.data, user.personnelId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
