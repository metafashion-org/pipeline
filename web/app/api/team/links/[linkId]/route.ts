import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { removeTeamTaskLink } from "@/lib/team-tasks/team-tasks-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

/** Removes a link from a task. The removal is recorded in the task's history. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const [{ linkId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(linkId).success) return NextResponse.json({ error: "Unknown link" }, { status: 404 });

  try {
    await removeTeamTaskLink(linkId, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
