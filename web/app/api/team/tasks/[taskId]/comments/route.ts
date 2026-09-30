import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addTeamTaskComment } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

const MAX_COMMENT_CHARS = 10_000;

const CommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
  // The people picked from the @ list. Each is emailed, pinged in the office channel and notified on the page.
  mentionedIds: z.array(z.uuid()).default([]),
});

/** Adds an update to a task and notifies everyone @mentioned in it. */
export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Unknown task" }, { status: 404 });

  const parsed = CommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write something first" }, { status: 400 });

  try {
    const id = await addTeamTaskComment(taskId, parsed.data.body, parsed.data.mentionedIds, user.personnelId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
