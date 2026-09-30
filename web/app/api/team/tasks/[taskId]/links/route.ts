import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addTeamTaskLink } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

const LinkSchema = z.object({
  kind: z.enum(["task", "asset", "artifact"]),
  id: z.uuid(),
});

/** Links a task to another task, an asset, or a Registry artifact. */
export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "Unknown task" }, { status: 404 });

  const parsed = LinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick something to link" }, { status: 400 });

  try {
    await addTeamTaskLink(taskId, parsed.data, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
