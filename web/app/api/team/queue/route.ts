import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { reorderTeamQueue } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

const QueueSchema = z.object({
  ownerId: z.uuid(),
  // The owner's open tasks, most important first.
  taskIds: z.array(z.uuid()).min(1),
});

/** Sets the order of a person's open tasks. The top of the list is what matters most. */
export async function PUT(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const parsed = QueueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a person and their tasks in order" }, { status: 400 });

  try {
    await reorderTeamQueue(parsed.data.ownerId, parsed.data.taskIds, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
